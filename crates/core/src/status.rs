//! Provider status, user settings the core applies, and diagnostics without personal data.

use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{DegradedReason, Field, Health, ProviderId};

/// What a provider reports about itself through [`EventSink::set_status`](crate::EventSink).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ProviderStatus {
    /// Its client is connected (for Meet: the browser extension, through the native host).
    pub connected: bool,
    /// The client's version, for diagnostics.
    pub client_version: Option<String>,
}

/// A provider as the UI sees it: the tray, the onboarding and the settings use it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "ui-types/src/generated/ui.ts")]
pub struct ProviderView {
    pub id: ProviderId,
    pub connected: bool,
    pub client_version: Option<String>,
    /// The health of its most recent session, kept after the session ends. `None` before the
    /// first session.
    pub last_health: Option<Health>,
}

/// Settings the core enforces, so no shell can get them wrong.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ui-types/src/generated/ui.ts")]
pub struct Settings {
    /// When off, the published snapshot carries no participant names and no meeting titles at
    /// all: the UI never receives them.
    pub show_participant_names: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            show_participant_names: true,
        }
    }
}

/// Everything "Copy diagnostics" shares: no names, titles, meeting codes or session ids.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Diagnostics {
    pub providers: Vec<ProviderDiagnostics>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProviderDiagnostics {
    pub provider: ProviderId,
    pub connected: bool,
    pub client_version: Option<String>,
    /// Sessions it has right now, active or just ended.
    pub sessions: usize,
    /// The health of its most recent session.
    pub health: Option<Health>,
    /// Its most recent degraded health, if any, and how long ago it was reported.
    pub last_degraded: Option<Health>,
    pub last_degraded_secs_ago: Option<u64>,
    /// How long ago it last reported a session update.
    pub last_update_secs_ago: Option<u64>,
}

impl fmt::Display for Diagnostics {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.providers.is_empty() {
            return writeln!(f, "providers: none");
        }
        for p in &self.providers {
            writeln!(f, "provider: {}", p.provider)?;
            let version = p.client_version.as_deref().unwrap_or("unknown");
            if p.connected {
                writeln!(f, "  connection: connected (client {version})")?;
            } else {
                writeln!(f, "  connection: not connected")?;
            }
            writeln!(f, "  sessions: {}", p.sessions)?;
            writeln!(f, "  health: {}", health_line(p.health.as_ref()))?;
            match (&p.last_degraded, p.last_degraded_secs_ago) {
                (Some(health), Some(ago)) => {
                    writeln!(
                        f,
                        "  last degraded: {} ({ago} s ago)",
                        health_line(Some(health))
                    )?;
                }
                _ => writeln!(f, "  last degraded: never")?,
            }
            match p.last_update_secs_ago {
                Some(ago) => writeln!(f, "  last update: {ago} s ago")?,
                None => writeln!(f, "  last update: never")?,
            }
        }
        Ok(())
    }
}

fn health_line(health: Option<&Health>) -> String {
    match health {
        None => "no data".to_owned(),
        Some(Health::Ok) => "ok".to_owned(),
        Some(Health::Degraded {
            reasons,
            provider_details,
        }) => {
            let reasons: Vec<String> = reasons.iter().map(reason_text).collect();
            let details: Vec<&str> = provider_details.iter().map(|d| d.as_str()).collect();
            format!(
                "degraded [{}] details [{}]",
                reasons.join(", "),
                details.join(", ")
            )
        }
    }
}

fn reason_text(reason: &DegradedReason) -> String {
    match reason {
        DegradedReason::Stale => "stale".to_owned(),
        DegradedReason::Unreadable(field) => format!("unreadable {}", field_text(*field)),
        DegradedReason::ControlMissing(command) => format!("control missing {command:?}"),
    }
}

fn field_text(field: Field) -> &'static str {
    match field {
        Field::Title => "title",
        Field::Mic => "mic",
        Field::Cam => "cam",
        Field::Hand => "hand",
        Field::ActiveSpeaker => "active speaker",
        Field::ParticipantCount => "participant count",
        Field::SpeakingWhileMuted => "speaking while muted",
    }
}
