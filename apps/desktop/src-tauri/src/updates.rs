//! In-app updates (ADR 0006), the app's only network access. It asks GitHub for the update
//! manifest when the person allows it (`check_for_updates`: at start and once a day) or clicks
//! "Check now", and installs only when they click "Atualizar" in the update balloon or "Install
//! and restart": never by itself, so it never restarts the island during a call.
//!
//! Development builds only: `ISLET_FAKE_UPDATE=<version>` makes every check find that version
//! without the network, even with automatic checks off, and installing it fail after a few
//! seconds, so the balloon and the settings can be tried without a release or a settings change.

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt as _;

use crate::model::UpdateState;
use crate::state::{AppState, lock};
use crate::{prompt, tray};

/// The first automatic check waits for the app to settle.
const FIRST_CHECK: Duration = Duration::from_secs(10);
const CHECK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);
/// How long a fake install takes before it fails.
const FAKE_INSTALL: Duration = Duration::from_secs(3);

/// Whether `ISLET_FAKE_UPDATE` is set (development builds only).
pub fn faking() -> bool {
    fake_version().is_some()
}

/// `ISLET_FAKE_UPDATE`, in development builds only.
fn fake_version() -> Option<String> {
    cfg!(debug_assertions)
        .then(|| std::env::var("ISLET_FAKE_UPDATE").ok())
        .flatten()
        .filter(|version| !version.is_empty())
}

/// Checks at start and once a day while `check_for_updates` is on (or a fake update is set).
pub fn schedule(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            let allowed = lock(&app.state::<AppState>().settings).check_for_updates;
            if allowed || fake_version().is_some() {
                check(&app, true).await;
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

/// Asks for the manifest and publishes the result. Does nothing while installing. A version
/// found by an `automatic` check is also offered in the update balloon; one found by "Check
/// now" shows only where the person asked.
pub async fn check(app: &AppHandle, automatic: bool) -> UpdateState {
    if !set(app, UpdateState::Checking, |s| {
        *s != UpdateState::Installing
    }) {
        return current(app);
    }
    let state = if let Some(version) = fake_version() {
        UpdateState::Available { version }
    } else {
        let result = match app.updater() {
            Ok(updater) => updater.check().await,
            Err(error) => Err(error),
        };
        match result {
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
        }
    };
    if automatic && matches!(state, UpdateState::Available { .. }) {
        lock(&app.state::<AppState>().prompt).pending = true;
    }
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
    if fake_version().is_some() {
        tokio::time::sleep(FAKE_INSTALL).await;
        tracing::info!("fake update: the install fails, as configured");
        set(app, UpdateState::InstallFailed, |_| true);
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

/// Replaces the state if `allow` accepts the current one, and tells the windows, the tray and
/// the update balloon.
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
    prompt::refresh(app);
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
