//! The Islet desktop app (Tauri 2). This crate is the shell (CLAUDE.md): windows, tray,
//! shortcuts, the bridge server and platform code. The session model lives in islet-core and the
//! Meet integration in islet-provider-meet.

mod bridge;
mod commands;
pub mod geometry;
mod logging;
pub mod model;
mod platform;
mod settings;
mod shortcuts;
mod state;
mod strings;
mod tray;
mod updates;
mod windows;

use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use islet_core::{SessionManager, Settings, Timings};
use islet_provider_demo::{DemoProvider, Script};
use islet_provider_meet::MeetProvider;
use tauri::{AppHandle, Emitter, Manager};

use crate::model::BridgeState;
use crate::settings::SettingsFile;
use crate::state::{AppState, lock};

/// How often the island re-reads the screen geometry (displays plugged in or out, resolution).
const GEOMETRY_POLL: Duration = Duration::from_secs(2);

/// Development only: `ISLET_ISOLATED=1` runs a second instance next to an installed Islet, with
/// no single-instance check, no manifest repair and no global shortcuts. Use it with
/// `ISLET_BRIDGE_SOCKET` pointing at another socket.
fn isolated() -> bool {
    cfg!(debug_assertions) && std::env::var_os("ISLET_ISOLATED").is_some()
}

pub fn run() {
    logging::init();
    // Demo mode is a development tool: release builds ignore `--demo` and leave it out of the
    // tray, so a published app shows only what works for real.
    let demo_at_start = cfg!(debug_assertions) && std::env::args().any(|arg| arg == "--demo");

    let mut app = tauri::Builder::default();
    if !isolated() {
        // Must be the first plugin.
        app = app.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let onboarded = lock(&app.state::<AppState>().settings)
                .onboarding_completed_at
                .is_some();
            windows::open(
                app,
                if onboarded {
                    windows::SETTINGS
                } else {
                    windows::ONBOARDING
                },
            );
        }));
    }
    let app = app
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(target_os = "macos")]
    let app = app.plugin(tauri_nspanel::init());

    let result = app
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::snapshot,
            commands::preview_snapshot,
            commands::execute,
            commands::settings,
            commands::set_settings,
            commands::finish_onboarding,
            commands::island_layout,
            commands::window_ready,
            commands::open_window,
            commands::repair_bridge,
            commands::requirements,
            commands::autostart,
            commands::set_autostart,
            commands::diagnostics,
            commands::open_link,
            commands::open_logs,
            commands::update_state,
            commands::check_for_updates,
            commands::install_update,
        ])
        .setup(move |app| {
            setup(app.handle(), demo_at_start)?;
            Ok(())
        })
        .run(tauri::generate_context!());
    if let Err(error) = result {
        tracing::error!(%error, "the app stopped with an error");
    }
}

fn setup(app: &AppHandle, demo_at_start: bool) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    if let Err(error) = app.set_activation_policy(tauri::ActivationPolicy::Accessory) {
        tracing::warn!(%error, "cannot hide the Dock icon");
    }

    let data_dir = app.path().app_data_dir()?;
    let settings_file = SettingsFile::new(&data_dir);
    let settings = settings_file.load();

    let (meet, bridge_events) = MeetProvider::new();
    let (demo, demo_switch) = DemoProvider::switchable(Script::tour(), demo_at_start);
    let sessions = tauri::async_runtime::block_on(async {
        SessionManager::new(Timings::default())
            .with_settings(Settings {
                show_participant_names: settings.show_participant_names,
            })
            .with_provider(Arc::new(meet))
            .with_provider(Arc::new(demo))
            .spawn()
    });
    tauri::async_runtime::spawn(bridge::serve(bridge_events));

    let onboarded = settings.onboarding_completed_at.is_some();
    app.manage(AppState {
        sessions: sessions.clone(),
        demo: demo_switch,
        preview: OnceLock::new(),
        settings_file,
        settings: Mutex::new(settings),
        shortcuts: Mutex::new(Default::default()),
        bridge: Mutex::new(BridgeState::Unknown),
        system_language: platform::preferred_language(),
        anchor: Mutex::new(None),
        layout: Mutex::new(None),
        update: Mutex::new(Default::default()),
    });

    if isolated() {
        tracing::warn!("isolated development instance: no manifest repair, no shortcuts");
    } else {
        *lock(&app.state::<AppState>().bridge) = bridge::repair_manifest();
    }
    windows::refresh_geometry(app);
    platform::create_island(app, windows::ISLAND, "island.html")?;
    if !isolated() {
        shortcuts::register(app);
    }
    tray::create(app)?;
    if !isolated() {
        updates::schedule(app);
    }

    // Every snapshot goes to every window; connection changes also update the tray.
    let mut updates = sessions.snapshot();
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut connected = None;
        while updates.changed().await.is_ok() {
            let snapshot = updates.borrow_and_update().clone();
            let now = snapshot
                .providers
                .iter()
                .any(|p| p.id == islet_provider_meet::MEET && p.connected);
            // Media states and counts only: never names or titles.
            if let Some(s) = &snapshot.primary {
                tracing::debug!(
                    mic = ?s.state.mic,
                    cam = ?s.state.cam,
                    hand = ?s.state.hand,
                    speaker = s.state.active_speaker.is_some(),
                    participants = ?s.state.participant_count,
                    status = ?s.status,
                    "snapshot emitted"
                );
            }
            let _ = handle.emit("snapshot", &snapshot);
            if connected != Some(now) {
                connected = Some(now);
                tray::refresh(&handle);
            }
        }
    });

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(GEOMETRY_POLL).await;
            let inner = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                windows::refresh_geometry(&inner);
            });
        }
    });

    if !onboarded {
        windows::open(app, windows::ONBOARDING);
    }
    Ok(())
}
