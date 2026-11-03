use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::{ErrorCode, PROTOCOL_VERSION, ProtocolVersion};

/// Messages larger than this are rejected in both directions. Chrome's own limits are higher
/// (1 MB host → extension, 64 MiB extension → host).
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;

/// Why a message could not be encoded or decoded.
///
/// Errors never quote message content: a JSON error can contain participant names, so only its
/// position is kept.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProtocolError {
    #[error("message is {size} bytes; the limit is {MAX_MESSAGE_BYTES}")]
    TooLarge { size: usize },
    #[error("message has no protocol version")]
    MissingVersion,
    #[error("unsupported protocol version {0} (expected {PROTOCOL_VERSION})")]
    UnsupportedVersion(u64),
    #[error("malformed message at line {line}, column {column}")]
    Malformed { line: usize, column: usize },
}

impl ProtocolError {
    /// The code the native host reports to the extension for this error.
    pub fn code(&self) -> ErrorCode {
        match self {
            Self::TooLarge { .. } => ErrorCode::MessageTooLarge,
            Self::MissingVersion | Self::UnsupportedVersion(_) => ErrorCode::UnsupportedVersion,
            Self::Malformed { .. } => ErrorCode::InvalidMessage,
        }
    }

    fn malformed(error: &serde_json::Error) -> Self {
        Self::Malformed {
            line: error.line(),
            column: error.column(),
        }
    }
}

#[derive(Serialize)]
struct EnvelopeRef<'a, M> {
    v: ProtocolVersion,
    #[serde(flatten)]
    message: &'a M,
}

/// Reads only `v`, so a version mismatch is reported as such and not as a confusing parse error.
#[derive(Deserialize)]
struct VersionProbe {
    v: Option<u64>,
}

pub(crate) fn encode<M: Serialize>(message: &M) -> Result<Vec<u8>, ProtocolError> {
    let envelope = EnvelopeRef {
        v: ProtocolVersion,
        message,
    };
    // Protocol types have string keys and infallible `Serialize` impls.
    let bytes = serde_json::to_vec(&envelope).expect("protocol messages always serialize");
    check_size(bytes.len())?;
    Ok(bytes)
}

pub(crate) fn decode<E: DeserializeOwned>(bytes: &[u8]) -> Result<E, ProtocolError> {
    check_size(bytes.len())?;
    let probe: VersionProbe =
        serde_json::from_slice(bytes).map_err(|e| ProtocolError::malformed(&e))?;
    match probe.v {
        None => return Err(ProtocolError::MissingVersion),
        Some(PROTOCOL_VERSION) => {}
        Some(other) => return Err(ProtocolError::UnsupportedVersion(other)),
    }
    serde_json::from_slice(bytes).map_err(|e| ProtocolError::malformed(&e))
}

fn check_size(size: usize) -> Result<(), ProtocolError> {
    if size > MAX_MESSAGE_BYTES {
        Err(ProtocolError::TooLarge { size })
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Action, ActiveSpeaker, AppMessage, Command, ExtensionMessage, Health, SelfState,
        SessionUpdate, Signals, Toggle,
    };

    fn update() -> SessionUpdate {
        SessionUpdate {
            tab_id: 1,
            meeting_code: "abc-defg-hij".into(),
            title: Some("Synthetic title".into()),
            started_at: 1_793_700_000_000,
            self_state: SelfState {
                mic: Toggle::Off,
                cam: Toggle::Unknown,
                hand: Toggle::Off,
            },
            active_speaker: Some(ActiveSpeaker {
                display_name: "Alex Example".into(),
            }),
            participant_count: None,
            signals: Signals::default(),
            capabilities: vec![Action::ToggleMic, Action::Leave],
            health: Health::Ok,
            degraded_reasons: None,
        }
    }

    #[test]
    fn round_trips_every_direction() {
        let message = ExtensionMessage::SessionUpdate(update());
        let bytes = message.encode().unwrap();
        assert_eq!(ExtensionMessage::decode(&bytes).unwrap(), message);

        let command = AppMessage::Command(Command {
            id: 3,
            tab_id: 1,
            action: Action::FocusTab,
        });
        assert_eq!(
            AppMessage::decode(&command.encode().unwrap()).unwrap(),
            command
        );
    }

    #[test]
    fn encoding_adds_the_version_and_omits_absent_fields() {
        let json: serde_json::Value =
            serde_json::from_slice(&ExtensionMessage::SessionUpdate(update()).encode().unwrap())
                .unwrap();
        assert_eq!(json["v"], 1);
        assert_eq!(json["type"], "session.update");
        assert_eq!(json["self"]["cam"], "unknown");
        assert!(json.get("participant_count").is_none());
        assert!(json.get("degraded_reasons").is_none());
        assert_eq!(json["signals"], serde_json::json!({}));
    }

    #[test]
    fn rejects_missing_or_other_versions() {
        assert_eq!(
            ExtensionMessage::decode(br#"{"type":"pong"}"#),
            Err(ProtocolError::MissingVersion)
        );
        assert_eq!(
            ExtensionMessage::decode(br#"{"v":2,"type":"pong"}"#),
            Err(ProtocolError::UnsupportedVersion(2))
        );
        // A future version may use a type this version does not know; the version error wins.
        assert_eq!(
            AppMessage::decode(br#"{"type":"teleport","v":2}"#),
            Err(ProtocolError::UnsupportedVersion(2))
        );
        assert!(matches!(
            ExtensionMessage::decode(br#"{"v":"1","type":"pong"}"#),
            Err(ProtocolError::Malformed { .. })
        ));
    }

    #[test]
    fn rejects_unknown_types_and_bad_json() {
        assert!(matches!(
            ExtensionMessage::decode(br#"{"v":1,"type":"teleport"}"#),
            Err(ProtocolError::Malformed { .. })
        ));
        assert!(matches!(
            ExtensionMessage::decode(b"[1,2]"),
            Err(ProtocolError::Malformed { .. })
        ));
        assert!(matches!(
            AppMessage::decode(b"{\"v\":1,"),
            Err(ProtocolError::Malformed { .. })
        ));
        // A known type sent in the wrong direction is not accepted either.
        assert!(matches!(
            AppMessage::decode(br#"{"v":1,"type":"pong"}"#),
            Err(ProtocolError::Malformed { .. })
        ));
    }

    #[test]
    fn ignores_unknown_fields_for_forward_compatibility() {
        assert_eq!(
            ExtensionMessage::decode(br#"{"v":1,"type":"pong","added_later":true}"#),
            Ok(ExtensionMessage::Pong)
        );
        let mut json: serde_json::Value =
            serde_json::from_slice(&ExtensionMessage::SessionUpdate(update()).encode().unwrap())
                .unwrap();
        json["self"]["screen"] = "on".into();
        json["added_later"] = 42.into();
        let decoded = ExtensionMessage::decode(json.to_string().as_bytes()).unwrap();
        assert_eq!(decoded, ExtensionMessage::SessionUpdate(update()));
    }

    #[test]
    fn enforces_the_size_limit_both_ways() {
        let mut big = update();
        big.title = Some("x".repeat(MAX_MESSAGE_BYTES));
        let error = ExtensionMessage::SessionUpdate(big).encode().unwrap_err();
        assert!(matches!(error, ProtocolError::TooLarge { .. }));
        assert_eq!(error.code(), ErrorCode::MessageTooLarge);

        let padded = format!(
            r#"{{"v":1,"type":"ping","pad":"{}"}}"#,
            " ".repeat(MAX_MESSAGE_BYTES)
        );
        assert!(matches!(
            AppMessage::decode(padded.as_bytes()),
            Err(ProtocolError::TooLarge { .. })
        ));

        let exact = r#"{"v":1,"type":"ping","pad":""}"#;
        let fill = MAX_MESSAGE_BYTES - exact.len();
        let at_limit = format!(r#"{{"v":1,"type":"ping","pad":"{}"}}"#, " ".repeat(fill));
        assert_eq!(at_limit.len(), MAX_MESSAGE_BYTES);
        assert_eq!(
            AppMessage::decode(at_limit.as_bytes()),
            Ok(AppMessage::Ping)
        );
    }

    #[test]
    fn debug_output_and_errors_never_contain_personal_data() {
        let debug = format!("{:?}", ExtensionMessage::SessionUpdate(update()));
        for secret in ["Alex Example", "Synthetic title", "abc-defg-hij"] {
            assert!(!debug.contains(secret), "{secret} leaked into {debug}");
        }

        // serde_json would quote the offending value ("invalid type: string \"Alex Example\"").
        let mut json: serde_json::Value =
            serde_json::from_slice(&ExtensionMessage::SessionUpdate(update()).encode().unwrap())
                .unwrap();
        json["participant_count"] = "Alex Example".into();
        let error = ExtensionMessage::decode(json.to_string().as_bytes()).unwrap_err();
        assert!(!format!("{error} {error:?}").contains("Alex"));
    }

    #[test]
    fn error_codes() {
        assert_eq!(
            ProtocolError::MissingVersion.code(),
            ErrorCode::UnsupportedVersion
        );
        assert_eq!(
            ProtocolError::Malformed { line: 1, column: 1 }.code(),
            ErrorCode::InvalidMessage
        );
    }
}
