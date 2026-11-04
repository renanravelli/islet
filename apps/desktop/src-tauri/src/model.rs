//! Types shared with the UI. ts-rs exports them to packages/ui-types (app.ts).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

const EXPORT: &str = "ui-types/src/generated/app.ts";

/// The UI language: the system's, or a fixed one.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = EXPORT)]
pub enum Language {
    #[default]
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "pt-BR")]
    PtBr,
    #[serde(rename = "en")]
    En,
}

/// Everything the app persists, in `<app data>/settings.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export, export_to = EXPORT)]
pub struct AppSettings {
    pub language: Language,
    pub expand_on_hover: bool,
    /// Applied by islet-core: when off, names and titles never reach the UI.
    pub show_participant_names: bool,
    /// Experimental and off by default.
    pub muted_speaking_alert: bool,
    /// ISO 8601; `None` until the onboarding is completed.
    pub onboarding_completed_at: Option<String>,
    /// Only keeps the onboarding tip from repeating; Meet's setting cannot be read.
    pub meet_pip_tip_ack: bool,
    /// Ask GitHub for a new version at start and once a day (ADR 0006). Off until the person
    /// turns it on, in the onboarding or in Settings.
    pub check_for_updates: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: Language::Auto,
            expand_on_hover: false,
            show_participant_names: true,
            muted_speaking_alert: false,
            onboarding_completed_at: None,
            meet_pip_tip_ack: false,
            check_for_updates: false,
        }
    }
}

/// The screen the island sits on, in the UI's points.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[ts(export, export_to = EXPORT)]
pub struct Geometry {
    pub has_notch: bool,
    /// The notch's width, or 0 without a notch.
    pub notch_width: f64,
    /// The notch's height (the menu bar's height on that screen), or the menu bar's height.
    pub top_inset: f64,
}

/// Whether each fixed shortcut was registered. One already taken by another app is not.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = EXPORT)]
pub struct ShortcutStatus {
    pub toggle_island: bool,
    pub toggle_mic: bool,
}

/// The Chrome bridge (native host manifest) as of the last check or repair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "state", rename_all = "snake_case")]
#[ts(export, export_to = EXPORT)]
pub enum BridgeState {
    Unknown,
    Ready,
    /// The summary is a fixed, non-personal message.
    Error {
        summary: String,
    },
}

/// What Islet needs on this Mac before the extension can reach it (onboarding step 2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = EXPORT)]
pub struct Requirements {
    /// Google Chrome is installed: the stable channel, the only one the bridge is registered
    /// for.
    pub chrome: bool,
    /// Islet runs from an Applications folder. Opened from the disk image, or from where it was
    /// downloaded, macOS runs a temporary copy, and the bridge would point at it.
    pub in_applications: bool,
}

/// What the island tells the shell after each render: the size of its contour.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, TS)]
#[ts(export, export_to = EXPORT)]
pub struct IslandLayout {
    pub visible: bool,
    pub width: f64,
    pub height: f64,
    /// Expanded: the panel takes keyboard focus (Esc) and collapses when it loses it.
    pub focused: bool,
    /// Expanded, the alert and the no-notch pill cast the system window shadow, drawn by macOS
    /// outside the panel, so the panel stays the island's exact size.
    pub shadow: bool,
}

/// Static facts the windows need.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = EXPORT)]
pub struct AppInfo {
    pub version: String,
    /// The system's preferred language, for "Automatic (system)".
    pub system_language: String,
    pub geometry: Geometry,
    pub shortcuts: ShortcutStatus,
    pub bridge: BridgeState,
    pub demo: bool,
}

/// The in-app updater (ADR 0006). Failures carry no details: the logs have them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "state", rename_all = "snake_case")]
#[ts(export, export_to = EXPORT)]
pub enum UpdateState {
    /// Not checked since the app started.
    #[default]
    Idle,
    Checking,
    UpToDate,
    Available {
        version: String,
    },
    /// Downloading and installing; the app restarts when it is done.
    Installing,
    CheckFailed,
    InstallFailed,
}

/// The extension's Chrome Web Store page (unlisted), which "Install extension" opens. The
/// manual "Load unpacked" guide stays in docs/install-extension.md.
pub const EXTENSION_STORE_URL: &str =
    "https://chromewebstore.google.com/detail/lbhmocnfnfmbiplpkllkacnbcjfcmlop";

/// Links the UI may open. Arbitrary URLs are never opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = EXPORT)]
pub enum Link {
    InstallExtension,
    /// Meet's home page: loading it connects an installed extension (onboarding step 3).
    OpenMeet,
    /// Chrome's download page, in the default browser (onboarding step 2, without Chrome).
    DownloadChrome,
    Troubleshooting,
    Source,
    License,
}

impl Link {
    pub fn url(self) -> &'static str {
        const REPO: &str = "https://github.com/renanravelli/islet";
        match self {
            Self::InstallExtension => EXTENSION_STORE_URL,
            Self::OpenMeet => "https://meet.google.com/",
            Self::DownloadChrome => "https://www.google.com/chrome/",
            Self::Troubleshooting => concat!(
                "https://github.com/renanravelli/islet",
                "/blob/main/docs/install-extension.md#troubleshooting"
            ),
            Self::Source => REPO,
            Self::License => concat!(
                "https://github.com/renanravelli/islet",
                "/blob/main/LICENSE-MIT"
            ),
        }
    }

    /// The extension works only in Chrome, so its store page and Meet open there, whatever the
    /// default browser is.
    pub fn needs_chrome(self) -> bool {
        matches!(self, Self::InstallExtension | Self::OpenMeet)
    }
}
