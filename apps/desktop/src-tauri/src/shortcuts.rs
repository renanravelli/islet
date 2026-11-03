//! The fixed global shortcuts: ⌃⌥I expands or collapses the island, ⌃⌥M toggles the mic of the
//! session the island shows. A shortcut another app already owns is reported, not hidden.

use islet_core::{Command, SessionStatus};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::model::ShortcutStatus;
use crate::state::{AppState, lock};
use crate::windows::ISLAND;

fn toggle_island() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyI)
}

fn toggle_mic() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyM)
}

pub fn register(app: &AppHandle) {
    let shortcuts = app.global_shortcut();
    let island = shortcuts
        .on_shortcut(toggle_island(), |app, _, event| {
            if event.state == ShortcutState::Pressed {
                let _ = app.emit_to(ISLAND, "island-toggle", ());
            }
        })
        .inspect_err(|error| tracing::warn!(%error, "⌃⌥I is unavailable"))
        .is_ok();
    let mic = shortcuts
        .on_shortcut(toggle_mic(), |app, _, event| {
            if event.state == ShortcutState::Pressed {
                toggle_primary_mic(app);
            }
        })
        .inspect_err(|error| tracing::warn!(%error, "⌃⌥M is unavailable"))
        .is_ok();
    *lock(&app.state::<AppState>().shortcuts) = ShortcutStatus {
        toggle_island: island,
        toggle_mic: mic,
    };
}

fn toggle_primary_mic(app: &AppHandle) {
    let state = app.state::<AppState>();
    let primary = state.sessions.snapshot().borrow().primary.clone();
    let Some(session) = primary else {
        return;
    };
    if session.status != SessionStatus::Active
        || !session.state.capabilities.contains(Command::ToggleMic)
    {
        return;
    }
    let sessions = state.sessions.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = sessions.execute(session.key, Command::ToggleMic).await {
            tracing::info!(%error, "⌃⌥M: the mic did not toggle");
        }
    });
}
