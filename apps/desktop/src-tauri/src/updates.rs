//! In-app updates (ADR 0006), the app's only network access. It asks GitHub for the update
//! manifest when the person allows it (`check_for_updates`: at start and once a day) or clicks
//! "Check now", and installs only when they click "Install and restart": never by itself, so it
//! never restarts the island during a call.

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt as _;

use crate::model::UpdateState;
use crate::state::{AppState, lock};
use crate::tray;

/// The first automatic check waits for the app to settle.
const FIRST_CHECK: Duration = Duration::from_secs(10);
const CHECK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);

/// Checks at start and once a day while `check_for_updates` is on.
pub fn schedule(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            if lock(&app.state::<AppState>().settings).check_for_updates {
                check(&app).await;
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

/// Asks for the manifest and publishes the result. Does nothing while installing.
pub async fn check(app: &AppHandle) -> UpdateState {
    if !set(app, UpdateState::Checking, |s| {
        *s != UpdateState::Installing
    }) {
        return current(app);
    }
    let result = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(error) => Err(error),
    };
    let state = match result {
        Ok(Some(update)) => {
            tracing::info!(version = %update.version, "an update is available");
            UpdateState::Available {
                version: update.version,
            }
        }
        Ok(None) => UpdateState::UpToDate,
        Err(error) => {
            tracing::warn!(%error, "cannot check for updates");
            UpdateState::CheckFailed
        }
    };
    set(app, state.clone(), |_| true);
    state
}

/// Downloads, verifies and installs the latest version, then restarts the app.
pub async fn install(app: &AppHandle) {
    if !set(app, UpdateState::Installing, |s| {
        *s != UpdateState::Installing
    }) {
        return;
    }
    let result = async {
        let update = app.updater()?.check().await?;
        match update {
            // The signature is checked against the public key in tauri.conf.json.
            Some(update) => update
                .download_and_install(|_, _| {}, || {})
                .await
                .map(|()| true),
            None => Ok(false),
        }
    }
    .await;
    match result {
        Ok(true) => {
            tracing::info!("update installed; restarting");
            app.restart();
        }
        Ok(false) => {
            set(app, UpdateState::UpToDate, |_| true);
        }
        Err(error) => {
            tracing::warn!(%error, "cannot install the update");
            set(app, UpdateState::InstallFailed, |_| true);
        }
    }
}

pub fn current(app: &AppHandle) -> UpdateState {
    lock(&app.state::<AppState>().update).clone()
}

/// Replaces the state if `allow` accepts the current one, and tells the windows and the tray.
fn set(app: &AppHandle, state: UpdateState, allow: impl FnOnce(&UpdateState) -> bool) -> bool {
    {
        let app_state = app.state::<AppState>();
        let mut current = lock(&app_state.update);
        if !allow(&current) {
            return false;
        }
        *current = state.clone();
    }
    let _ = app.emit("update", &state);
    tray::refresh(app);
    true
}

#[cfg(test)]
mod tests {
    /// The updater reads only this repository's update manifest, over HTTPS, and verifies each
    /// download with the public key.
    #[test]
    fn the_updater_reads_only_this_repository() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = &conf["plugins"]["updater"];
        let endpoints = updater["endpoints"].as_array().unwrap();
        assert!(!endpoints.is_empty());
        for endpoint in endpoints {
            let url = endpoint.as_str().unwrap();
            assert!(
                url.starts_with("https://raw.githubusercontent.com/renanravelli/islet/updater/"),
                "{url}"
            );
        }
        assert!(
            updater["pubkey"]
                .as_str()
                .is_some_and(|key| !key.is_empty())
        );
        assert!(updater.get("dangerousInsecureTransportProtocol").is_none());
        // Update artifacts need the private key, so only the release build makes them
        // (tauri.updater.json).
        assert!(conf["bundle"].get("createUpdaterArtifacts").is_none());
    }
}
