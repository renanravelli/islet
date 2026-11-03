//! macOS: screen geometry, system language and opening files and links.
//!
//! The crate denies `unsafe` everywhere but here (CLAUDE.md, "Unsafe code"). The AppKit and
//! Foundation calls used so far are safe in objc2 0.6, so this module needs none yet; any
//! `unsafe` block added later must carry a `// SAFETY:` comment.
#![allow(unsafe_code)]

use objc2::MainThreadMarker;
use objc2_app_kit::NSScreen;
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

// --- The island panel -------------------------------------------------------------------------

pub use island::{create_island, place_island};

/// In its own module: `tauri_panel!` brings its own imports into scope. Its `panel_event!`
/// syntax requires `-> ()`.
#[allow(clippy::unused_unit)]
mod island {
    use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, Wry};
    use tauri_nspanel::{
        CollectionBehavior, ManagerExt, PanelBuilder, PanelLevel, StyleMask, tauri_panel,
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
        panel.set_event_handler(Some(handler.as_ref()));
        // The handler must outlive the panel; the app keeps both for its whole life.
        std::mem::forget(handler);
        Ok(())
    }

    /// Shows the island at `origin` with `size`, or hides it. Main thread only.
    pub fn place_island(
        app: &AppHandle,
        label: &str,
        place: Option<((f64, f64), (f64, f64))>,
        focus: bool,
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
                panel.show();
                if focus {
                    panel.make_key_window();
                } else if panel.as_panel().isKeyWindow() {
                    panel.resign_key_window();
                }
            }
        }
    }
}
