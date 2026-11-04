//! Commands the UI invokes, and the events the shell emits to every window:
//! `snapshot` (UiSnapshot), `preview` (the onboarding's demo UiSnapshot), `settings`
//! (AppSettings), `app-info` (AppInfo) and `update` (UpdateState).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use islet_core::{
    Command, CommandError, SessionKey, SessionManager, Settings, Timings, UiSnapshot,
};
use islet_provider_demo::{DemoProvider, Script};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_autostart::ManagerExt as _;

use crate::bridge;
use crate::model::{
    AppInfo, AppSettings, BridgeState, Geometry, IslandLayout, Link, Requirements, UpdateState,
};
use crate::platform;
use crate::state::{AppState, lock};
use crate::{tray, updates, windows};

pub fn info(app: &AppHandle) -> AppInfo {
    let state = app.state::<AppState>();
    let anchor = *lock(&state.anchor);
    AppInfo {
        version: app.package_info().version.to_string(),
        system_language: state.system_language.clone(),
        geometry: Geometry {
            has_notch: anchor.is_some_and(|a| a.has_notch),
            notch_width: anchor.map_or(0.0, |a| a.notch_width),
            top_inset: anchor.map_or(32.0, |a| a.top_inset),
        },
        shortcuts: *lock(&state.shortcuts),
        bridge: lock(&state.bridge).clone(),
        demo: state.demo.is_on(),
    }
}

pub fn emit_info(app: &AppHandle) {
    let _ = app.emit("app-info", info(app));
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    info(&app)
}

#[tauri::command]
pub fn snapshot(state: State<'_, AppState>) -> UiSnapshot {
    state.sessions.snapshot().borrow().clone()
}

/// The onboarding's live preview: its own demo, independent of real calls.
#[tauri::command]
pub fn preview_snapshot(app: AppHandle) -> UiSnapshot {
    let state = app.state::<AppState>();
    let handle = state.preview.get_or_init(|| {
        let handle = tauri::async_runtime::block_on(async {
            SessionManager::new(Timings::default())
                .with_provider(Arc::new(DemoProvider::new(Script::tour())))
                .spawn()
        });
        let mut updates = handle.snapshot();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            while updates.changed().await.is_ok() {
                let snapshot = updates.borrow_and_update().clone();
                let _ = app.emit_to(windows::ONBOARDING, "preview", snapshot);
            }
        });
        handle
    });
    handle.snapshot().borrow().clone()
}

#[tauri::command]
pub async fn execute(
    state: State<'_, AppState>,
    key: SessionKey,
    command: Command,
) -> Result<(), CommandError> {
    let sessions = state.sessions.clone();
    sessions.execute(key, command).await
}

#[tauri::command]
pub fn settings(state: State<'_, AppState>) -> AppSettings {
    lock(&state.settings).clone()
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: AppSettings) -> AppSettings {
    let state = app.state::<AppState>();
    let was_checking =
        std::mem::replace(&mut *lock(&state.settings), settings.clone()).check_for_updates;
    // Turning automatic checks on checks right away, instead of up to a day later.
    if settings.check_for_updates && !was_checking {
        let app = app.clone();
        tauri::async_runtime::spawn(async move { updates::check(&app).await });
    }
    if let Err(error) = state.settings_file.save(&settings) {
        tracing::warn!(%error, "cannot save the settings");
    }
    state.sessions.set_settings(Settings {
        show_participant_names: settings.show_participant_names,
    });
    let _ = app.emit("settings", &settings);
    tray::refresh(&app);
    settings
}

#[tauri::command]
pub fn finish_onboarding(app: AppHandle) {
    let mut settings = lock(&app.state::<AppState>().settings).clone();
    settings.onboarding_completed_at = Some(now_iso8601());
    set_settings(app.clone(), settings);
    if let Some(window) = app.get_webview_window(windows::ONBOARDING) {
        let _ = window.close();
    }
}

#[tauri::command]
pub fn island_layout(app: AppHandle, layout: IslandLayout) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || windows::place(&handle, layout));
}

/// A window's page has painted: show it (see `windows`).
#[tauri::command]
pub fn window_ready(window: WebviewWindow) {
    if window.label() != windows::ISLAND {
        windows::reveal(&window);
    }
}

#[tauri::command]
pub fn open_window(app: AppHandle, label: String) {
    if label == windows::ONBOARDING || label == windows::SETTINGS {
        windows::open(&app, &label);
    }
}

#[tauri::command]
pub fn repair_bridge(app: AppHandle) -> BridgeState {
    let result = bridge::repair_manifest();
    *lock(&app.state::<AppState>().bridge) = result.clone();
    emit_info(&app);
    result
}

/// Onboarding step 2: what is missing for the extension to reach Islet. Cheap enough to poll.
#[tauri::command]
pub fn requirements() -> Requirements {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    Requirements {
        chrome: platform::chrome_installed(),
        // A development build runs from target/, never from a bundle.
        in_applications: cfg!(debug_assertions)
            || std::env::current_exe().is_ok_and(|exe| in_applications(&exe, home.as_deref())),
    }
}

/// Whether the app bundle holding `exe` sits in /Applications or ~/Applications, at any depth.
/// A copy macOS runs from elsewhere (App Translocation) or from the disk image is not.
fn in_applications(exe: &Path, home: Option<&Path>) -> bool {
    let Some(bundle) = exe
        .ancestors()
        .find(|p| p.extension().is_some_and(|ext| ext == "app"))
    else {
        return false;
    };
    let folders = [
        Some(PathBuf::from("/Applications")),
        home.map(|h| h.join("Applications")),
    ];
    folders
        .into_iter()
        .flatten()
        .any(|folder| bundle.starts_with(folder))
}

#[tauri::command]
pub fn autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Turns launch at login on or off and returns the real state afterwards.
#[tauri::command]
pub fn set_autostart(app: AppHandle, on: bool) -> Result<bool, String> {
    let launcher = app.autolaunch();
    let result = if on {
        launcher.enable()
    } else {
        launcher.disable()
    };
    result.map_err(|error| {
        tracing::warn!(%error, "cannot change launch at login");
        "launch at login could not be changed".to_owned()
    })?;
    Ok(launcher.is_enabled().unwrap_or(on))
}

/// The redacted diagnostics for "Copy diagnostics": no names, titles or meeting codes.
#[tauri::command]
pub async fn diagnostics(app: AppHandle) -> String {
    let state = app.state::<AppState>();
    let core = state.sessions.diagnostics().await;
    let info = info(&app);
    let bridge = match &info.bridge {
        BridgeState::Unknown => "unknown".to_owned(),
        BridgeState::Ready => "ready".to_owned(),
        BridgeState::Error { summary } => format!("error: {summary}"),
    };
    let mut text = format!(
        "Islet {} ({} {})\nnotch: {}\nbridge manifest: {bridge}\nshortcuts: ⌃⌥I {}, ⌃⌥M {}\ndemo: {}\n",
        info.version,
        std::env::consts::OS,
        std::env::consts::ARCH,
        if info.geometry.has_notch { "yes" } else { "no" },
        if info.shortcuts.toggle_island {
            "ok"
        } else {
            "unavailable"
        },
        if info.shortcuts.toggle_mic {
            "ok"
        } else {
            "unavailable"
        },
        if info.demo { "on" } else { "off" },
    );
    match core {
        Some(core) => text.push_str(&core.to_string()),
        None => text.push_str("session manager: stopped\n"),
    }
    text
}

#[tauri::command]
pub fn open_link(link: Link) {
    let opened = if link.needs_chrome() {
        platform::open_in_chrome(link.url())
    } else {
        platform::open(link.url())
    };
    if let Err(error) = opened {
        tracing::warn!(%error, "cannot open a link");
    }
}

#[tauri::command]
pub fn open_logs() {
    if let Some(dir) = islet_bridge::path::log_dir() {
        let _ = std::fs::create_dir_all(&dir);
        if let Err(error) = platform::open(&dir.to_string_lossy()) {
            tracing::warn!(%error, "cannot open the logs folder");
        }
    }
}

#[tauri::command]
pub fn update_state(app: AppHandle) -> UpdateState {
    updates::current(&app)
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> UpdateState {
    updates::check(&app).await
}

/// Starts the download and returns at once; `update` events report progress, and the app
/// restarts when it is installed.
#[tauri::command]
pub fn install_update(app: AppHandle) {
    tauri::async_runtime::spawn(async move { updates::install(&app).await });
}

/// UTC, to the second, without a date library.
fn now_iso8601() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let (days, rem) = (secs / 86_400, secs % 86_400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn formats_utc_timestamps() {
        let stamp = super::now_iso8601();
        assert_eq!(stamp.len(), 20, "{stamp}");
        assert!(stamp.starts_with("20") && stamp.ends_with('Z'), "{stamp}");
    }

    #[test]
    fn knows_an_app_run_from_applications() {
        use std::path::Path;
        let home = Some(Path::new("/Users/someone"));
        let ok = [
            "/Applications/Islet.app/Contents/MacOS/islet",
            "/Applications/Tools/Islet.app/Contents/MacOS/islet",
            "/Users/someone/Applications/Islet.app/Contents/MacOS/islet",
        ];
        for exe in ok {
            assert!(super::in_applications(Path::new(exe), home), "{exe}");
        }
        let elsewhere = [
            "/private/var/folders/x1/abc/T/AppTranslocation/5F0E/d/Islet.app/Contents/MacOS/islet",
            "/Volumes/Islet/Islet.app/Contents/MacOS/islet",
            "/Users/someone/Downloads/Islet.app/Contents/MacOS/islet",
            "/Applications.backup/Islet.app/Contents/MacOS/islet",
            "/Users/other/Applications/Islet.app/Contents/MacOS/islet",
            "/Applications/islet",
        ];
        for exe in elsewhere {
            assert!(!super::in_applications(Path::new(exe), home), "{exe}");
        }
    }
}
