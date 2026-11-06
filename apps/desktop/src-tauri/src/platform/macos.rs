//! macOS: screen geometry, the menu bar icon's place, system language, app activation, finding
//! Chrome and opening files and links, and the island and update balloon panels.
//!
//! The crate denies `unsafe` everywhere but here (CLAUDE.md, "Unsafe code"). Every `unsafe`
//! block carries a `// SAFETY:` comment.
#![allow(unsafe_code)]

use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSScreen, NSWindow, NSWorkspace};
use objc2_foundation::{NSLocale, NSRect, NSString};
use tauri::AppHandle;

use crate::geometry::{Rect, ScreenInfo};
use crate::prompt::TrayItem;

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
    Some(screen_of(&screen, primary_height))
}

fn screen_of(screen: &NSScreen, primary_height: f64) -> ScreenInfo {
    ScreenInfo {
        frame: rect(screen.frame()),
        visible_frame: rect(screen.visibleFrame()),
        safe_top: screen.safeAreaInsets().top,
        left_area: rect(screen.auxiliaryTopLeftArea()),
        right_area: rect(screen.auxiliaryTopRightArea()),
        primary_height,
    }
}

/// Where the menu bar icon is, from its status item's window, and whether macOS draws it. Main
/// thread only: `None` elsewhere.
pub fn tray_item(app: &AppHandle) -> Option<TrayItem> {
    MainThreadMarker::new()?;
    let tray = app.tray_by_id(crate::tray::TRAY)?;
    tray.with_inner_tray_icon(|icon| {
        let mtm = MainThreadMarker::new()?;
        let item = icon.ns_status_item()?;
        let window = item.button(mtm)?.window()?;
        let screen = window.screen()?;
        let primary_height = NSScreen::screens(mtm).firstObject()?.frame().size.height;
        Some(TrayItem {
            frame: rect(window.frame()),
            screen: screen_of(&screen, primary_height),
            // Not `occlusionState`: a status item drawn in the menu bar reported no `Visible` bit
            // (macOS 15, 2026-11-06). Where macOS puts an icon it has no room for is checked
            // from the frame instead (`prompt::placement`).
            visible: item.isVisible() && window.isVisible(),
        })
    })
    .ok()
    .flatten()
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

/// Shows a window, activates Islet and puts the window in front of every app's. macOS 14+ may
/// refuse the activation when it does not come from a click (the first launch, from Finder or
/// System Settings), so the window is also ordered front on its own. Main thread only.
pub fn bring_to_front(window: &tauri::WebviewWindow) {
    activate();
    let _ = window.show();
    let _ = window.set_focus();
    let Some(_mtm) = MainThreadMarker::new() else {
        return;
    };
    let Ok(pointer) = window.ns_window() else {
        return;
    };
    // SAFETY: `ns_window` is the window's own NSWindow, which Tauri keeps alive while the window
    // exists; it is used only during this call, on the main thread (checked above).
    let ns_window = unsafe { &*pointer.cast::<NSWindow>() };
    ns_window.orderFrontRegardless();
}

/// Whether Google Chrome (the stable channel, whose bridge Islet registers) is installed,
/// wherever it is: Launch Services knows the apps on the Mac.
pub fn chrome_installed() -> bool {
    let id = NSString::from_str("com.google.Chrome");
    NSWorkspace::sharedWorkspace()
        .URLForApplicationWithBundleIdentifier(&id)
        .is_some()
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

// --- The island and update balloon panels ----------------------------------------------------

pub use island::{create_island, create_prompt, place_island, place_prompt};

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

        // The update balloon: clickable without activating Islet, never key on its own.
        panel!(PromptPanel {
            config: {
                can_become_key_window: true,
                can_become_main_window: false,
                is_floating_panel: true
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

    /// Creates the update balloon's panel once, hidden: borderless, transparent, non-activating,
    /// on every Space and over full-screen apps. macOS draws its shadow from the page's pixels.
    pub fn create_prompt(app: &AppHandle, label: &str, url: &str) -> tauri::Result<()> {
        if app.get_webview_panel(label).is_ok() {
            return Ok(());
        }
        PanelBuilder::<Wry, PromptPanel>::new(app, label)
            .url(WebviewUrl::App(url.into()))
            .level(PanelLevel::Status)
            .transparent(true)
            .has_shadow(true)
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
                    .transparent(true)
                    .decorations(false)
                    .resizable(false)
                    .visible(false)
                    .skip_taskbar(true)
                    .inner_size(1.0, 1.0)
            })
            .build()
            .map(drop)
    }

    /// Shows the update balloon at `origin` with `size`, or hides it. Main thread only.
    pub fn place_prompt(app: &AppHandle, label: &str, place: Option<((f64, f64), (f64, f64))>) {
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
                panel.show();
                refresh_shadow(app, label);
            }
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
