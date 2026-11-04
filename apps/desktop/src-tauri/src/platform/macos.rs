//! macOS: screen geometry, system language, app activation and opening files and links.
//!
//! The crate denies `unsafe` everywhere but here (CLAUDE.md, "Unsafe code"). The AppKit and
//! Foundation calls used so far are safe in objc2 0.6, so this module needs none yet; any
//! `unsafe` block added later must carry a `// SAFETY:` comment.
#![allow(unsafe_code)]

use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSScreen};
use objc2_foundation::{NSLocale, NSRect};

use crate::geometry::{Rect, ScreenInfo};

fn rect(r: NSRect) -> Rect {
    Rect {
        x: r.origin.x,
        y: r.origin.y,
        width: r.size.width,
        height: r.size.height,
    }
}

/// The screen with a notch if there is one, else the main screen. Main thread only: `None`
/// elsewhere.
pub fn screen_info() -> Option<ScreenInfo> {
    let mtm = MainThreadMarker::new()?;
    let screens = NSScreen::screens(mtm);
    let primary_height = screens.firstObject()?.frame().size.height;
    let notched = screens.iter().find(|s| s.safeAreaInsets().top > 0.0);
    let screen = match notched {
        Some(screen) => screen,
        None => NSScreen::mainScreen(mtm)?,
    };
    Some(ScreenInfo {
        frame: rect(screen.frame()),
        visible_frame: rect(screen.visibleFrame()),
        safe_top: screen.safeAreaInsets().top,
        left_area: rect(screen.auxiliaryTopLeftArea()),
        right_area: rect(screen.auxiliaryTopRightArea()),
        primary_height,
    })
}

/// The first of the user's preferred languages, as a BCP 47 tag ("pt-BR", "en-US").
pub fn preferred_language() -> String {
    NSLocale::preferredLanguages()
        .firstObject()
        .map_or_else(|| "en".to_owned(), |lang| lang.to_string())
}

/// Makes Islet the active app, so the next window it shows comes to the front. Islet is a menu
/// bar app and is never active on its own; call this while handling the person's click, since
/// macOS 14+ may refuse an activation that comes later. Main thread only: a no-op elsewhere.
pub fn activate() {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    // `activate` exists only from macOS 14 on; this one works on 13 too.
    #[allow(deprecated)]
    NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
}

/// Opens a file, folder or URL with the default app (`/usr/bin/open`).
pub fn open(target: &str) -> std::io::Result<()> {
    std::process::Command::new("/usr/bin/open")
        .arg(target)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(drop)
}

/// Opens a URL in Google Chrome, or with the default browser when Chrome is not installed.
pub fn open_in_chrome(url: &str) -> std::io::Result<()> {
    let url = url.to_owned();
    // `open` takes a moment to answer; never on the main thread.
    std::thread::spawn(move || {
        let chrome = std::process::Command::new("/usr/bin/open")
            .args(["-b", "com.google.Chrome", &url])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        if !chrome.is_ok_and(|status| status.success()) {
            tracing::info!("Chrome not found; opening the link with the default browser");
            if let Err(error) = open(&url) {
                tracing::warn!(%error, "cannot open a link");
            }
        }
    });
    Ok(())
}

// --- The island panel -------------------------------------------------------------------------

pub use island::{create_island, place_island};

/// In its own module: `tauri_panel!` brings its own imports into scope. Its `panel_event!`
/// syntax requires `-> ()`.
#[allow(clippy::unused_unit)]
mod island {
    use std::time::Duration;

    use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, Wry};
    use tauri_nspanel::{
        CollectionBehavior, ManagerExt, PanelBuilder, PanelLevel, StyleMask, TrackingAreaOptions,
        tauri_panel,
    };

    // `tauri_panel!` expands to `unsafe` Objective-C calls written by tauri-nspanel; this module is
    // the only place the crate allows them.
    tauri_panel! {
        panel!(IslandPanel {
            config: {
                can_become_key_window: true,
                can_become_main_window: false,
                is_floating_panel: true
            }
            // Always active: the app is never frontmost, and WebKit only tracks the pointer
            // for the active app. The panel reports enter/exit to the UI instead.
            with: {
                tracking_area: {
                    options: TrackingAreaOptions::new()
                        .active_always()
                        .mouse_entered_and_exited(),
                    auto_resize: true
                }
            }
        })

        panel_event!(IslandPanelEvents {
            window_did_resign_key(notification: &NSNotification) -> ()
        })
    }

    /// Creates the island: a borderless, transparent, non-activating `NSPanel` above the menu bar,
    /// on every Space and over full-screen apps. Hidden until the UI asks to show it.
    pub fn create_island(app: &AppHandle, label: &str, url: &str) -> tauri::Result<()> {
        let panel = PanelBuilder::<Wry, IslandPanel>::new(app, label)
            .url(WebviewUrl::App(url.into()))
            .level(PanelLevel::Status)
            .transparent(true)
            .has_shadow(false)
            .opaque(false)
            .hides_on_deactivate(false)
            .becomes_key_only_if_needed(true)
            .no_activate(true)
            .style_mask(StyleMask::empty().borderless().nonactivating_panel())
            .collection_behavior(
                CollectionBehavior::new()
                    .can_join_all_spaces()
                    .stationary()
                    .full_screen_auxiliary()
                    .ignores_cycle(),
            )
            .with_window(|window| {
                window
                    // Also clears the WKWebView's own background (drawsBackground), so only the
                    // island's contour is drawn.
                    .transparent(true)
                    .decorations(false)
                    .resizable(false)
                    .visible(false)
                    .skip_taskbar(true)
                    .shadow(false)
                    .inner_size(1.0, 1.0)
            })
            .build()?;

        // Clicking elsewhere takes the key status away: the UI collapses the expanded island.
        let handler = IslandPanelEvents::new();
        let app_for_events = app.clone();
        handler.window_did_resign_key(move |_| {
            let _ = app_for_events.emit_to("island", "island-blur", ());
        });
        let app_for_enter = app.clone();
        handler.on_mouse_entered(move |_| {
            let _ = app_for_enter.emit_to("island", "island-hover", true);
        });
        let app_for_exit = app.clone();
        handler.on_mouse_exited(move |_| {
            let _ = app_for_exit.emit_to("island", "island-hover", false);
        });
        panel.set_event_handler(Some(handler.as_ref()));
        // The handler must outlive the panel; the app keeps both for its whole life.
        std::mem::forget(handler);
        Ok(())
    }

    /// Shows the island at `origin` with `size`, or hides it. Main thread only.
    /// macOS draws a transparent window's shadow from its painted pixels, and caches it. The
    /// island repaints during its resize transition (260 ms), so the shadow is recomputed once
    /// the page has painted the new size and again after the transition.
    fn refresh_shadow(app: &AppHandle, label: &str) {
        for delay in [Duration::from_millis(60), Duration::from_millis(320)] {
            let app = app.clone();
            let label = label.to_owned();
            std::thread::spawn(move || {
                std::thread::sleep(delay);
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if let Ok(panel) = handle.get_webview_panel(&label) {
                        panel.as_panel().invalidateShadow();
                    }
                });
            });
        }
    }

    pub fn place_island(
        app: &AppHandle,
        label: &str,
        place: Option<((f64, f64), (f64, f64))>,
        focus: bool,
        shadow: bool,
    ) {
        let Ok(panel) = app.get_webview_panel(label) else {
            return;
        };
        let Some(window) = app.get_webview_window(label) else {
            return;
        };
        match place {
            None => panel.hide(),
            Some(((x, y), (width, height))) => {
                let _ = window.set_size(LogicalSize::new(width, height));
                let _ = window.set_position(LogicalPosition::new(x, y));
                panel.set_has_shadow(shadow);
                panel.show();
                if shadow {
                    refresh_shadow(app, label);
                }
                if focus {
                    panel.make_key_window();
                } else if panel.as_panel().isKeyWindow() {
                    panel.resign_key_window();
                }
            }
        }
    }
}
