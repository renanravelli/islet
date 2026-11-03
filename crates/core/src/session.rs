use std::borrow::Cow;
use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::CapabilitySet;

/// A media or hand state. `Unknown` means the provider could not tell, and it is never shown as
/// "on" (`docs/adr/0003`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "ui-types/src/generated/ui.ts")]
pub enum Toggle {
    On,
    Off,
    #[default]
    Unknown,
}

impl Toggle {
    pub fn is_on(self) -> bool {
        self == Self::On
    }
}

/// Identifies a provider, such as `meet` or `demo`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(transparent)]
#[ts(export, export_to = "ui-types/src/generated/ui.ts", type = "string")]
pub struct ProviderId(Cow<'static, str>);

impl ProviderId {
    pub const fn from_static(id: &'static str) -> Self {
        Self(Cow::Borrowed(id))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ProviderId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Identifies a session across providers. `id` is the provider's own id, such as a tab id.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ui-types/src/generated/ui.ts")]
pub struct SessionKey {
    pub provider: ProviderId,
    pub id: String,
}

impl SessionKey {
    pub fn new(provider: ProviderId, id: impl Into<String>) -> Self {
        Self {
            provider,
            id: id.into(),
        }
    }
}

/// Everything a provider reports about one session. Providers always send it whole.
///
/// `Debug` redacts the title and participant names so they cannot reach logs.
#[derive(Clone, Default, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "ui-types/src/generated/ui.ts")]
pub struct SessionState {
    pub title: Option<String>,
    /// When the user joined, in milliseconds since the Unix epoch. The UI derives the call
    /// duration from it.
    #[ts(type = "number")]
    pub started_at: u64,
    pub mic: Toggle,
    pub cam: Toggle,
    pub hand: Toggle,
    /// Experimental.
    pub active_speaker: Option<Speaker>,
    pub participant_count: Option<u32>,
    /// Up to [`MAX_PARTICIPANTS`] people in the call, for the avatar row.
    pub participants: Vec<Speaker>,
    /// The user, when the provider can tell; the island shows them before anyone speaks.
    pub self_participant: Option<Speaker>,
    pub signals: Signals,
    /// Commands this session supports right now. The UI renders only these.
    pub capabilities: CapabilitySet,
    pub health: Health,
}

impl fmt::Debug for SessionState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SessionState")
            .field("title", &self.title.as_ref().map(|_| Redacted))
            .field("started_at", &self.started_at)
            .field("mic", &self.mic)
            .field("cam", &self.cam)
            .field("hand", &self.hand)
            .field("active_speaker", &self.active_speaker)
            .field("participant_count", &self.participant_count)
            .field("participants", &self.participants)
            .field("self_participant", &self.self_participant)
            .field("signals", &self.signals)
            .field("capabilities", &self.capabilities)
            .field("health", &self.health)
            .finish()
    }
}

/// How many participants the island's avatar row shows; a provider's extra ones are dropped.
pub const MAX_PARTICIPANTS: usize = 3;

/// A participant. `display_name` is `None` when names are hidden
/// ([`Settings::show_participant_names`](crate::Settings)); `Debug` redacts it.
#[derive(Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "ui-types/src/generated/ui.ts")]
pub struct Speaker {
    pub display_name: Option<String>,
}

impl Speaker {
    pub fn new(display_name: impl Into<String>) -> Self {
        Self {
            display_name: Some(display_name.into()),
        }
    }

    /// Someone is speaking; who is not shown.
    pub fn anonymous() -> Self {
        Self { display_name: None }
    }
}

impl fmt::Debug for Speaker {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Speaker")
            .field(
                "display_name",
                &self.display_name.as_ref().map(|_| Redacted),
            )
            .finish()
    }
}

/// Experimental signals. A signal is `true` only when the provider observed it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "ui-types/src/generated/ui.ts")]
pub struct Signals {
    pub speaking_while_muted: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "status", rename_all = "snake_case")]
#[ts(export, export_to = "ui-types/src/generated/ui.ts")]
pub enum Health {
    #[default]
    Ok,
    /// Part of the state could not be read; the island shows a discreet indicator.
    Degraded {
        /// Provider-agnostic reasons, which the UI explains.
        reasons: Vec<DegradedReason>,
        /// The provider's own identifiers for what failed (for Meet, `selectors.json` keys). The
        /// core never interprets them; the UI only displays them.
        provider_details: Vec<ProviderDetail>,
    },
}

impl Health {
    pub fn degraded(reasons: impl IntoIterator<Item = DegradedReason>) -> Self {
        Self::Degraded {
            reasons: reasons.into_iter().collect(),
            provider_details: Vec::new(),
        }
    }

    /// Adds provider details. Has no effect on [`Health::Ok`].
    #[must_use]
    pub fn with_details(self, details: impl IntoIterator<Item = ProviderDetail>) -> Self {
        match self {
            Self::Ok => Self::Ok,
            Self::Degraded {
                reasons,
                mut provider_details,
            } => {
                provider_details.extend(details);
                Self::Degraded {
                    reasons,
                    provider_details,
                }
            }
        }
    }

    pub fn is_ok(&self) -> bool {
        matches!(self, Self::Ok)
    }

    pub(crate) fn with_reason(self, reason: DegradedReason) -> Self {
        let (mut reasons, provider_details) = match self {
            Self::Ok => (Vec::new(), Vec::new()),
            Self::Degraded {
                reasons,
                provider_details,
            } => (reasons, provider_details),
        };
        if !reasons.contains(&reason) {
            reasons.push(reason);
        }
        Self::Degraded {
            reasons,
            provider_details,
        }
    }
}

/// An opaque identifier a provider attaches to a degraded session, such as a `selectors.json`
/// key.
///
/// It must never hold a name, a title or page text. Providers only pass identifiers from a fixed
/// set they define; as a second line of defense, [`ProviderDetail::new`] accepts only short
/// identifier-shaped strings (ASCII letters, digits, `.`, `_`, `-`; 1 to 64 bytes), so free text
/// with spaces or punctuation is refused.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, TS)]
#[serde(transparent)]
#[ts(export, export_to = "ui-types/src/generated/ui.ts", type = "string")]
pub struct ProviderDetail(String);

impl ProviderDetail {
    pub const MAX_LEN: usize = 64;

    pub fn new(id: impl Into<String>) -> Option<Self> {
        let id = id.into();
        let shaped = (1..=Self::MAX_LEN).contains(&id.len())
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
        shaped.then_some(Self(id))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Why a session is degraded, in provider-agnostic terms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "ui-types/src/generated/ui.ts")]
pub enum DegradedReason {
    /// No update from the provider within the stale timeout.
    Stale,
    /// The provider could not read this part of the state.
    Unreadable(Field),
    /// The provider could not find the control for this command.
    ControlMissing(crate::Command),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "ui-types/src/generated/ui.ts")]
pub enum Field {
    Title,
    Mic,
    Cam,
    Hand,
    ActiveSpeaker,
    ParticipantCount,
    SpeakingWhileMuted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "ui-types/src/generated/ui.ts")]
pub enum EndReason {
    /// The user left or the meeting ended.
    CallEnded,
    /// The meeting's window or tab closed, or navigated away.
    Closed,
    /// The provider lost its connection to the meeting app.
    Disconnected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "phase", rename_all = "snake_case")]
#[ts(export, export_to = "ui-types/src/generated/ui.ts")]
pub enum SessionStatus {
    Active,
    Ended { reason: EndReason },
}

/// A session as the UI sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "ui-types/src/generated/ui.ts")]
pub struct MeetingSession {
    pub key: SessionKey,
    pub status: SessionStatus,
    #[serde(flatten)]
    pub state: SessionState,
}

struct Redacted;

impl fmt::Debug for Redacted {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<redacted>")
    }
}
