//! Stubs for the platforms v0.1 does not support yet (Windows, Linux).

use crate::geometry::ScreenInfo;

pub fn screen_info() -> Option<ScreenInfo> {
    None
}

pub fn preferred_language() -> String {
    "en".to_owned()
}

pub fn activate() {}

pub fn bring_to_front(window: &tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

/// Chrome is looked for only on macOS.
pub fn chrome_installed() -> bool {
    false
}

pub fn open_in_chrome(target: &str) -> std::io::Result<()> {
    open(target)
}

pub fn open(_target: &str) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "opening files and links is only implemented on macOS",
    ))
}

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

/// A plain always-on-top window stands in for the macOS panel.
pub fn create_island(app: &AppHandle, label: &str, url: &str) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .inner_size(1.0, 1.0)
        .build()
        .map(drop)
}

pub fn place_island(
    app: &AppHandle,
    label: &str,
    place: Option<((f64, f64), (f64, f64))>,
    _focus: bool,
    _shadow: bool,
) {
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    match place {
        None => {
            let _ = window.hide();
        }
        Some(((x, y), (width, height))) => {
            let _ = window.set_size(LogicalSize::new(width, height));
            let _ = window.set_position(LogicalPosition::new(x, y));
            let _ = window.show();
        }
    }
}
