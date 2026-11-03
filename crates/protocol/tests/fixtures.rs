//! Compatibility tests: every fixture decodes, and re-encoding it gives back the same JSON.

use islet_protocol::{
    Action, AppMessage, CommandErrorCode, DegradedReason, EndReason, ExtensionMessage, Health,
    Toggle,
};
use serde_json::Value;

fn fixture(path: &str) -> String {
    let full = format!("{}/fixtures/{path}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&full).unwrap_or_else(|e| panic!("cannot read {full}: {e}"))
}

fn assert_same_json(encoded: &[u8], original: &str) {
    let encoded: Value = serde_json::from_slice(encoded).unwrap();
    let original: Value = serde_json::from_str(original).unwrap();
    assert_eq!(encoded, original);
}

fn extension(path: &str) -> ExtensionMessage {
    let json = fixture(&format!("extension/{path}"));
    let message = ExtensionMessage::decode(json.as_bytes()).unwrap();
    assert_same_json(&message.encode().unwrap(), &json);
    message
}

fn app(path: &str) -> AppMessage {
    let json = fixture(&format!("app/{path}"));
    let message = AppMessage::decode(json.as_bytes()).unwrap();
    assert_same_json(&message.encode().unwrap(), &json);
    message
}

#[test]
fn hello() {
    let ExtensionMessage::Hello(hello) = extension("hello.json") else {
        panic!("expected hello");
    };
    assert_eq!(hello.extension_version, "0.1.0");
}

#[test]
fn session_update_full() {
    let ExtensionMessage::SessionUpdate(update) = extension("session-update-full.json") else {
        panic!("expected session.update");
    };
    assert_eq!(update.tab_id, 1234);
    assert_eq!(update.self_state.mic, Toggle::On);
    assert_eq!(update.self_state.hand, Toggle::Unknown);
    assert_eq!(update.participant_count, Some(5));
    assert_eq!(update.signals.speaking_while_muted, Some(false));
    assert_eq!(update.capabilities.len(), 5);
    assert_eq!(update.health, Health::Ok);
    assert_eq!(update.degraded_reasons, None);
}

#[test]
fn session_update_degraded() {
    let ExtensionMessage::SessionUpdate(update) = extension("session-update-degraded.json") else {
        panic!("expected session.update");
    };
    assert_eq!(update.title, None);
    assert_eq!(update.active_speaker, None);
    assert_eq!(update.signals.speaking_while_muted, None);
    assert_eq!(update.self_state.mic, Toggle::Unknown);
    assert!(!update.capabilities.contains(&Action::ToggleMic));
    assert_eq!(update.health, Health::Degraded);
    assert_eq!(
        update.degraded_reasons.as_deref(),
        Some(
            &[
                DegradedReason::MicButton,
                DegradedReason::ActiveSpeaker,
                DegradedReason::ParticipantCount
            ][..]
        )
    );
}

#[test]
fn session_ended() {
    let ExtensionMessage::SessionEnded(ended) = extension("session-ended.json") else {
        panic!("expected session.ended");
    };
    assert_eq!(ended.reason, EndReason::CallEnded);
}

#[test]
fn command_results() {
    let ExtensionMessage::CommandResult(ok) = extension("command-result-ok.json") else {
        panic!("expected command.result");
    };
    assert!(ok.ok);
    assert_eq!(ok.error, None);

    let ExtensionMessage::CommandResult(failed) = extension("command-result-error.json") else {
        panic!("expected command.result");
    };
    assert!(!failed.ok);
    assert_eq!(failed.error, Some(CommandErrorCode::NotConfirmed));
}

#[test]
fn pong() {
    assert_eq!(extension("pong.json"), ExtensionMessage::Pong);
}

#[test]
fn command() {
    let AppMessage::Command(command) = app("command.json") else {
        panic!("expected command");
    };
    assert_eq!(command.action, Action::ToggleMic);
}

#[test]
fn ping() {
    assert_eq!(app("ping.json"), AppMessage::Ping);
}

#[test]
fn error() {
    let AppMessage::Error(error) = app("error.json") else {
        panic!("expected error");
    };
    assert_eq!(error.code, islet_protocol::ErrorCode::AppNotRunning);
}

#[test]
fn typescript_constants_match() {
    let index = format!(
        "{}/../../packages/protocol-ts/src/index.ts",
        env!("CARGO_MANIFEST_DIR")
    );
    let index = std::fs::read_to_string(index).unwrap();
    assert!(index.contains(&format!(
        "PROTOCOL_VERSION = {};",
        islet_protocol::PROTOCOL_VERSION
    )));
    assert!(index.contains(&format!(
        "MAX_MESSAGE_BYTES = {};",
        islet_protocol::MAX_MESSAGE_BYTES
    )));
}
