//! The island panel's placement, and the onboarding and settings windows.
//!
//! Regular windows follow the macOS appearance live. To avoid a white flash in dark mode they
//! are created hidden with the current theme's background, and shown once the page says it is
//! ready (`window_ready`), or after [`SHOW_ANYWAY_AFTER`] if it never does.

use std::time::Duration;

use tauri::window::Color;
use tauri::{
    AppHandle, Manager, Theme, TitleBarStyle, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

use crate::geometry;
use crate::model::IslandLayout;
use crate::platform;
use crate::state::{AppState, lock};

pub const ISLAND: &str = "island";
pub const ONBOARDING: &str = "onboarding";
pub const SETTINGS: &str = "settings";

/// A window whose page has not said it is ready by then is shown anyway: a flash is better than
/// a click that seems to do nothing.
const SHOW_ANYWAY_AFTER: Duration = Duration::from_secs(2);

/// Re-reads the screen geometry and moves the island if it changed. Main thread only.
pub fn refresh_geometry(app: &AppHandle) {
    let Some(screen) = platform::screen_info() else {
        return;
    };
    let anchor = geometry::anchor(&screen);
    let state = app.state::<AppState>();
    let changed = lock(&state.anchor).replace(anchor) != Some(anchor);
    if changed {
        let layout = *lock(&state.layout);
        if let Some(layout) = layout {
            place(app, layout);
        }
    }
}

/// Applies the island UI's latest layout. Main thread only.
pub fn place(app: &AppHandle, layout: IslandLayout) {
    let state = app.state::<AppState>();
    *lock(&state.layout) = Some(layout);
    let anchor = *lock(&state.anchor);
    let place = match anchor {
        Some(anchor) if layout.visible && layout.width >= 1.0 && layout.height >= 1.0 => Some((
            geometry::origin(&anchor, layout.width),
            (layout.width, layout.height),
        )),
        _ => None,
    };
    tracing::debug!(?place, focused = layout.focused, "island layout");
    platform::place_island(app, ISLAND, place, layout.focused, layout.shadow);
}

fn background(theme: Theme) -> Color {
    match theme {
        Theme::Dark => Color(0x1C, 0x1C, 0x1E, 0xFF),
        _ => Color(0xFF, 0xFF, 0xFF, 0xFF),
    }
}

/// Opens (or brings to the front) the onboarding or the settings window.
pub fn open(app: &AppHandle, label: &str) {
    platform::activate();
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let (url, size) = match label {
        ONBOARDING => ("onboarding.html", (720.0, 520.0)),
        _ => ("settings.html", (760.0, 540.0)),
    };
    let built = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title("")
        .inner_size(size.0, size.1)
        .resizable(false)
        .maximizable(false)
        .minimizable(true)
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .visible(false)
        .center()
        .build();
    let window = match built {
        Ok(window) => window,
        Err(error) => {
            tracing::error!(%error, label, "cannot open a window");
            return;
        }
    };
    let theme = window.theme().unwrap_or(Theme::Light);
    let _ = window.set_background_color(Some(background(theme)));
    let follower = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::ThemeChanged(theme) = event {
            let _ = follower.set_background_color(Some(background(*theme)));
        }
    });
    let app = app.clone();
    let label = label.to_owned();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SHOW_ANYWAY_AFTER).await;
        let Some(window) = app.get_webview_window(&label) else {
            return;
        };
        if !window.is_visible().unwrap_or(true) {
            tracing::warn!(
                label,
                "the window did not say it was ready; showing it anyway"
            );
            let _ = window.show();
            let _ = window.set_focus();
        }
    });
}
