use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::ProtocolVersion;
use crate::codec::{self, ProtocolError};

/// A message from the extension to the app, as it appears on the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub struct ExtensionEnvelope {
    pub v: ProtocolVersion,
    #[serde(flatten)]
    pub message: ExtensionMessage,
}

/// A message from the app (or the native host speaking for it) to the extension, as it appears
/// on the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub struct AppEnvelope {
    pub v: ProtocolVersion,
    #[serde(flatten)]
    pub message: AppMessage,
}

/// Extension → app.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type")]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub enum ExtensionMessage {
    /// Sent when the extension connects to the native host.
    #[serde(rename = "hello")]
    Hello(Hello),
    /// The full state of one meeting tab. Sent when something changes and, unchanged, as the
    /// heartbeat every 5 s.
    #[serde(rename = "session.update")]
    SessionUpdate(SessionUpdate),
    #[serde(rename = "session.ended")]
    SessionEnded(SessionEnded),
    #[serde(rename = "command.result")]
    CommandResult(CommandResult),
    /// Reply to `ping`.
    #[serde(rename = "pong")]
    Pong,
}

/// App → extension.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type")]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub enum AppMessage {
    #[serde(rename = "command")]
    Command(Command),
    #[serde(rename = "ping")]
    Ping,
    /// Sent by the native host, for example when the app is not running.
    #[serde(rename = "error")]
    Error(BridgeError),
}

impl ExtensionMessage {
    /// Every `type` this version sends from the extension.
    pub const TYPES: [&str; 5] = [
        "hello",
        "session.update",
        "session.ended",
        "command.result",
        "pong",
    ];

    /// Serializes the message with `v: 1`.
    pub fn encode(&self) -> Result<Vec<u8>, ProtocolError> {
        codec::encode(self)
    }

    /// Parses a message, checking the size limit and the protocol version.
    pub fn decode(bytes: &[u8]) -> Result<Self, ProtocolError> {
        codec::decode::<ExtensionEnvelope>(bytes, &Self::TYPES).map(|envelope| envelope.message)
    }
}

impl AppMessage {
    /// Every `type` this version sends to the extension.
    pub const TYPES: [&str; 3] = ["command", "ping", "error"];

    /// Serializes the message with `v: 1`.
    pub fn encode(&self) -> Result<Vec<u8>, ProtocolError> {
        codec::encode(self)
    }

    /// Parses a message, checking the size limit and the protocol version.
    pub fn decode(bytes: &[u8]) -> Result<Self, ProtocolError> {
        codec::decode::<AppEnvelope>(bytes, &Self::TYPES).map(|envelope| envelope.message)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub struct Hello {
    pub extension_version: String,
    /// Free-form browser name and version, for diagnostics only.
    pub browser: String,
}

/// State of one meeting, keyed by the browser tab it lives in.
// `Debug` redacts the meeting code, the title and participant names so they cannot reach logs.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(
    export,
    export_to = "protocol-ts/src/generated/protocol.ts",
    optional_fields
)]
pub struct SessionUpdate {
    pub tab_id: u32,
    pub meeting_code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// When the user joined the call, in milliseconds since the Unix epoch.
    #[ts(type = "number")]
    pub started_at: u64,
    /// The user's own media state.
    #[serde(rename = "self")]
    pub self_state: SelfState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_speaker: Option<ActiveSpeaker>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub participant_count: Option<u32>,
    /// A few people in the call (the extension sends up to 3), in the order Meet shows their
    /// tiles, for the island's avatar row. Fewer than `participant_count` is normal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub participants: Option<Vec<Participant>>,
    pub signals: Signals,
    /// Actions this tab can perform right now.
    pub capabilities: Vec<Action>,
    pub health: Health,
    /// What the adapter could not resolve. Present only when `health` is `degraded`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub degraded_reasons: Option<Vec<DegradedReason>>,
}

impl fmt::Debug for SessionUpdate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SessionUpdate")
            .field("tab_id", &self.tab_id)
            .field("meeting_code", &Redacted)
            .field("title", &self.title.as_ref().map(|_| Redacted))
            .field("started_at", &self.started_at)
            .field("self_state", &self.self_state)
            .field("active_speaker", &self.active_speaker)
            .field("participant_count", &self.participant_count)
            .field("participants", &self.participants)
            .field("signals", &self.signals)
            .field("capabilities", &self.capabilities)
            .field("health", &self.health)
            .field("degraded_reasons", &self.degraded_reasons)
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub struct SelfState {
    pub mic: Toggle,
    pub cam: Toggle,
    pub hand: Toggle,
}

/// A media or hand state. `unknown` means the adapter could not tell; it is never shown as `on`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub enum Toggle {
    On,
    Off,
    Unknown,
}

// `Debug` redacts the name.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub struct ActiveSpeaker {
    pub display_name: String,
}

impl fmt::Debug for ActiveSpeaker {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ActiveSpeaker")
            .field("display_name", &Redacted)
            .finish()
    }
}

// `Debug` redacts the name.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub struct Participant {
    pub display_name: String,
}

impl fmt::Debug for Participant {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Participant")
            .field("display_name", &Redacted)
            .finish()
    }
}

/// Experimental signals. A missing field means the adapter could not read it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(
    export,
    export_to = "protocol-ts/src/generated/protocol.ts",
    optional_fields
)]
pub struct Signals {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaking_while_muted: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub enum Action {
    ToggleMic,
    ToggleCam,
    ToggleHand,
    Leave,
    FocusTab,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub enum Health {
    Ok,
    Degraded,
}

/// A `selectors.json` key the adapter could not resolve or read (see `docs/adr/0004`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub enum DegradedReason {
    LeaveButton,
    MicButton,
    CamButton,
    HandButton,
    ActiveSpeaker,
    ParticipantCount,
    MutedSpeakingNotice,
    MeetingTitle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub struct SessionEnded {
    pub tab_id: u32,
    pub reason: EndReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub enum EndReason {
    /// The tab is still open but the user is no longer in the call.
    CallEnded,
    TabClosed,
    /// The tab navigated away from the meeting.
    Navigated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub struct Command {
    /// Chosen by the app; echoed back in `command.result`.
    pub id: u32,
    pub tab_id: u32,
    pub action: Action,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(
    export,
    export_to = "protocol-ts/src/generated/protocol.ts",
    optional_fields
)]
pub struct CommandResult {
    pub id: u32,
    pub ok: bool,
    /// Present when `ok` is `false`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<CommandErrorCode>,
}

impl CommandResult {
    pub fn success(id: u32) -> Self {
        Self {
            id,
            ok: true,
            error: None,
        }
    }

    pub fn failure(id: u32, error: CommandErrorCode) -> Self {
        Self {
            id,
            ok: false,
            error: Some(error),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub enum CommandErrorCode {
    /// No meeting tab with this id.
    TabNotFound,
    /// The control for this action could not be found in the page.
    ControlNotFound,
    /// The control was clicked but the state change was not observed within 1.5 s.
    NotConfirmed,
    /// The tab cannot perform this action.
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub struct BridgeError {
    pub code: ErrorCode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol-ts/src/generated/protocol.ts")]
pub enum ErrorCode {
    /// The native host cannot reach the app. It keeps retrying.
    AppNotRunning,
    MessageTooLarge,
    UnsupportedVersion,
    InvalidMessage,
}

struct Redacted;

impl fmt::Debug for Redacted {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<redacted>")
    }
}
