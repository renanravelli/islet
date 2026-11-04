//! The menu bar icon and its menu. The icon is a template image, so macOS tints it; until the
//! onboarding is completed it carries a dot, and the menu offers "Concluir configuração…".

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

use crate::model::UpdateState;
use crate::state::{AppState, lock};
use crate::strings::t;
use crate::windows;

const TRAY: &str = "main";

fn icon(app: &AppHandle) -> tauri::Result<Image<'static>> {
    let onboarded = lock(&app.state::<AppState>().settings)
        .onboarding_completed_at
        .is_some();
    if onboarded {
        Image::from_bytes(include_bytes!("../icons/tray@2x.png"))
    } else {
        Image::from_bytes(include_bytes!("../icons/tray-setup@2x.png"))
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    TrayIconBuilder::with_id(TRAY)
        .icon(icon(app)?)
        .icon_as_template(true)
        .show_menu_on_left_click(true)
        .menu(&menu(app)?)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "finish_setup" | "onboarding" => windows::open(app, windows::ONBOARDING),
            "settings" => windows::open(app, windows::SETTINGS),
            "demo" => {
                let state = app.state::<AppState>();
                state.demo.set(!state.demo.is_on());
                refresh(app);
                crate::commands::emit_info(app);
            }
            "update" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move { crate::updates::install(&app).await });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// Rebuilds the menu and the icon: language, connection status, demo, updates, shortcut
/// warnings and finishing the onboarding change them.
pub fn refresh(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY) else {
        return;
    };
    match icon(app) {
        Ok(icon) => {
            let _ = tray.set_icon(Some(icon));
            let _ = tray.set_icon_as_template(true);
        }
        Err(error) => tracing::warn!(%error, "cannot load the tray icon"),
    }
    match menu(app) {
        Ok(menu) => {
            let _ = tray.set_menu(Some(menu));
        }
        Err(error) => tracing::warn!(%error, "cannot rebuild the tray menu"),
    }
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let state = app.state::<AppState>();
    let locale = state.locale();
    let connected = state
        .sessions
        .snapshot()
        .borrow()
        .providers
        .iter()
        .any(|p| p.id == islet_provider_meet::MEET && p.connected);
    let shortcuts = *lock(&state.shortcuts);
    let onboarded = lock(&state.settings).onboarding_completed_at.is_some();

    let status_key = if connected {
        "tray.connected"
    } else {
        "tray.disconnected"
    };
    let status = MenuItem::with_id(app, "status", t(locale, status_key), false, None::<&str>)?;
    let menu = Menu::with_items(app, &[&status])?;
    for (ok, keys) in [
        (shortcuts.toggle_island, "⌃⌥I"),
        (shortcuts.toggle_mic, "⌃⌥M"),
    ] {
        if !ok {
            let text = format!("{keys} · {}", t(locale, "shortcut.unavailable"));
            menu.append(&MenuItem::with_id(
                app,
                "shortcut",
                text,
                false,
                None::<&str>,
            )?)?;
        }
    }
    match &*lock(&state.update) {
        UpdateState::Available { version } => {
            let text = t(locale, "tray.update_available").replace("{version}", version);
            menu.append(&MenuItem::with_id(app, "update", text, true, None::<&str>)?)?;
        }
        UpdateState::Installing => {
            let text = t(locale, "tray.updating");
            menu.append(&MenuItem::with_id(
                app,
                "updating",
                text,
                false,
                None::<&str>,
            )?)?;
        }
        _ => {}
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if !onboarded {
        menu.append(&MenuItem::with_id(
            app,
            "finish_setup",
            t(locale, "tray.finish_setup"),
            true,
            None::<&str>,
        )?)?;
    }
    // Development builds only (see `run`).
    if cfg!(debug_assertions) {
        menu.append(&CheckMenuItem::with_id(
            app,
            "demo",
            t(locale, "tray.demo"),
            true,
            state.demo.is_on(),
            None::<&str>,
        )?)?;
    }
    menu.append(&MenuItem::with_id(
        app,
        "settings",
        t(locale, "tray.settings"),
        true,
        Some("CmdOrCtrl+,"),
    )?)?;
    // Before the onboarding is completed, "Concluir configuração…" opens the same guide.
    if onboarded {
        menu.append(&MenuItem::with_id(
            app,
            "onboarding",
            t(locale, "tray.onboarding"),
            true,
            None::<&str>,
        )?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        "quit",
        t(locale, "tray.quit"),
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}
