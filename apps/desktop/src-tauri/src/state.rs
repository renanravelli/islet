//! What every command and event handler shares.

use std::sync::{Mutex, MutexGuard, OnceLock};

use islet_core::SessionHandle;
use islet_provider_demo::DemoSwitch;

use crate::geometry::Anchor;
use crate::model::{AppSettings, BridgeState, IslandLayout, ShortcutStatus, UpdateState};
use crate::settings::SettingsFile;

pub struct AppState {
    pub sessions: SessionHandle,
    pub demo: DemoSwitch,
    /// The onboarding preview's own demo, started on first use.
    pub preview: OnceLock<SessionHandle>,
    pub settings_file: SettingsFile,
    pub settings: Mutex<AppSettings>,
    pub shortcuts: Mutex<ShortcutStatus>,
    pub bridge: Mutex<BridgeState>,
    pub system_language: String,
    pub anchor: Mutex<Option<Anchor>>,
    pub layout: Mutex<Option<IslandLayout>>,
    pub update: Mutex<UpdateState>,
}

/// Locks, recovering from a poisoned lock: the data is plain values.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl AppState {
    pub fn locale(&self) -> &'static str {
        crate::strings::locale(lock(&self.settings).language, &self.system_language)
    }
}
