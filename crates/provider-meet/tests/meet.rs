//! The Meet provider behind a real `SessionManager`, fed the way the shell's bridge server will.

use std::sync::Arc;
use std::time::Duration;

use islet_core::{
    Command, CommandError, DegradedReason, EndReason, Field, Health, MeetingSession,
    ProviderDetail, SessionHandle, SessionKey, SessionManager, SessionStatus, Speaker, Timings,
    Toggle, UiSnapshot,
};
use islet_protocol::{
    self as wire, Action, ActiveSpeaker, AppMessage, CommandErrorCode, CommandResult,
    ExtensionMessage, Hello, Participant, SelfState, SessionEnded, SessionUpdate, Signals,
};
use islet_provider_meet::{BridgeEvent, MEET, MeetProvider};
use tokio::sync::{mpsc, watch};
use tokio::time::timeout;

struct Harness {
    seen: Option<MeetingSession>,
    handle: SessionHandle,
    snapshot: watch::Receiver<UiSnapshot>,
    bridge: mpsc::UnboundedSender<BridgeEvent>,
    provider: Arc<MeetProvider>,
}

impl Harness {
    fn start() -> Self {
        let (provider, bridge) = MeetProvider::new();
        let provider = Arc::new(provider);
        let handle = SessionManager::new(Timings::default())
            .with_provider(provider.clone())
            .spawn();
        let snapshot = handle.snapshot();
        Self {
            seen: None,
            handle,
            snapshot,
            bridge,
            provider,
        }
    }

    /// Connects a native host and returns what the provider sends it.
    async fn connect(&self, connection: u64) -> mpsc::UnboundedReceiver<AppMessage> {
        let (outbox, mut sent) = mpsc::unbounded_channel();
        self.bridge
            .send(BridgeEvent::Connected { connection, outbox })
            .unwrap();
        assert_eq!(
            next_sent(&mut sent).await,
            AppMessage::Ping,
            "ping on connect"
        );
        sent
    }

    fn message(&self, connection: u64, message: ExtensionMessage) {
        self.bridge
            .send(BridgeEvent::Message {
                connection,
                message,
            })
            .unwrap();
    }

    /// The next snapshot whose primary session differs from the last one this test saw;
    /// status-only changes are skipped.
    async fn next(&mut self) -> UiSnapshot {
        loop {
            let snapshot = self.snapshot.borrow_and_update().clone();
            if snapshot.primary != self.seen {
                self.seen = snapshot.primary.clone();
                return snapshot;
            }
            timeout(Duration::from_secs(5), self.snapshot.changed())
                .await
                .expect("a snapshot")
                .unwrap();
        }
    }

    async fn next_primary(&mut self) -> MeetingSession {
        self.next().await.primary.expect("a session")
    }
}

async fn next_sent(sent: &mut mpsc::UnboundedReceiver<AppMessage>) -> AppMessage {
    timeout(Duration::from_secs(5), sent.recv())
        .await
        .expect("a message to the extension")
        .unwrap()
}

fn update(tab_id: u32) -> SessionUpdate {
    SessionUpdate {
        tab_id,
        meeting_code: "abc-defg-hij".into(),
        title: Some("Synthetic title".into()),
        started_at: 1_793_700_000_000,
        self_state: SelfState {
            mic: wire::Toggle::On,
            cam: wire::Toggle::Off,
            hand: wire::Toggle::Unknown,
        },
        active_speaker: Some(ActiveSpeaker {
            display_name: "Alex Example".into(),
        }),
        participant_count: Some(4),
        participants: Some(
            ["Alex Example", "Sam Example", "Jo Example", "Kim Example"]
                .into_iter()
                .map(|name| Participant {
                    display_name: name.into(),
                })
                .collect(),
        ),
        signals: Signals {
            speaking_while_muted: Some(true),
        },
        capabilities: vec![Action::ToggleMic, Action::Leave, Action::FocusTab],
        health: wire::Health::Ok,
        degraded_reasons: None,
    }
}

#[tokio::test]
async fn maps_session_updates() {
    let mut h = Harness::start();
    let _sent = h.connect(1).await;
    h.message(1, ExtensionMessage::SessionUpdate(update(42)));

    let session = h.next_primary().await;
    assert_eq!(session.key, SessionKey::new(MEET, "1:42"));
    assert_eq!(session.state.title.as_deref(), Some("Synthetic title"));
    assert_eq!(session.state.mic, Toggle::On);
    assert_eq!(session.state.cam, Toggle::Off);
    assert_eq!(session.state.hand, Toggle::Unknown);
    assert_eq!(
        session.state.active_speaker.and_then(|s| s.display_name),
        Some("Alex Example".to_owned())
    );
    assert_eq!(session.state.participant_count, Some(4));
    // The avatar row shows three; the rest are dropped.
    assert_eq!(
        session.state.participants,
        ["Alex Example", "Sam Example", "Jo Example"].map(Speaker::new)
    );
    assert!(session.state.signals.speaking_while_muted);
    assert_eq!(
        session.state.capabilities.iter().collect::<Vec<_>>(),
        [Command::ToggleMic, Command::Leave, Command::FocusTab]
    );
    assert_eq!(session.state.health, Health::Ok);
}

#[tokio::test]
async fn degraded_updates_keep_the_selector_keys_as_details() {
    let mut h = Harness::start();
    let _sent = h.connect(1).await;
    let mut degraded = update(7);
    degraded.self_state.mic = wire::Toggle::Unknown;
    degraded.health = wire::Health::Degraded;
    degraded.degraded_reasons = Some(vec![
        wire::DegradedReason::MicButton,
        wire::DegradedReason::LeaveButton,
    ]);
    h.message(1, ExtensionMessage::SessionUpdate(degraded));

    let session = h.next_primary().await;
    assert_eq!(
        session.state.health,
        Health::degraded([
            DegradedReason::Unreadable(Field::Mic),
            DegradedReason::ControlMissing(Command::Leave),
        ])
        .with_details(["micButton", "leaveButton"].map(|k| ProviderDetail::new(k).unwrap()))
    );
}

#[tokio::test]
async fn commands_round_trip_through_the_extension() {
    let mut h = Harness::start();
    let mut sent = h.connect(1).await;
    h.message(1, ExtensionMessage::SessionUpdate(update(42)));
    let key = h.next_primary().await.key;

    let handle = h.handle.clone();
    let command = tokio::spawn(async move { handle.execute(key, Command::ToggleMic).await });
    let AppMessage::Command(sent_command) = next_sent(&mut sent).await else {
        panic!("expected a command");
    };
    assert_eq!(sent_command.tab_id, 42);
    assert_eq!(sent_command.action, Action::ToggleMic);

    // An answer from another connection is ignored.
    h.message(
        2,
        ExtensionMessage::CommandResult(CommandResult::success(sent_command.id)),
    );
    h.message(
        1,
        ExtensionMessage::CommandResult(CommandResult::success(sent_command.id)),
    );
    assert_eq!(command.await.unwrap(), Ok(()));

    // No optimistic update: the mic is still on until the extension reports otherwise.
    assert_eq!(
        h.snapshot.borrow().primary.as_ref().unwrap().state.mic,
        Toggle::On
    );
}

#[tokio::test]
async fn command_errors_are_mapped() {
    let mut h = Harness::start();
    let mut sent = h.connect(1).await;
    h.message(1, ExtensionMessage::SessionUpdate(update(42)));
    let key = h.next_primary().await.key;

    for (code, expected) in [
        (
            Some(CommandErrorCode::ControlNotFound),
            CommandError::ControlNotFound,
        ),
        (
            Some(CommandErrorCode::NotConfirmed),
            CommandError::NotConfirmed,
        ),
        (Some(CommandErrorCode::TabNotFound), CommandError::NoSession),
        (
            Some(CommandErrorCode::Unsupported),
            CommandError::Unsupported,
        ),
        (None, CommandError::NotConfirmed),
    ] {
        let handle = h.handle.clone();
        let key = key.clone();
        let command = tokio::spawn(async move { handle.execute(key, Command::Leave).await });
        let AppMessage::Command(sent_command) = next_sent(&mut sent).await else {
            panic!("expected a command");
        };
        h.message(
            1,
            ExtensionMessage::CommandResult(CommandResult {
                id: sent_command.id,
                ok: false,
                error: code,
            }),
        );
        assert_eq!(command.await.unwrap(), Err(expected));
    }
}

#[tokio::test]
async fn sessions_end_with_their_tab_or_their_connection() {
    let mut h = Harness::start();
    let mut sent = h.connect(1).await;
    h.message(1, ExtensionMessage::SessionUpdate(update(1)));
    h.next().await;
    h.message(
        1,
        ExtensionMessage::SessionEnded(SessionEnded {
            tab_id: 1,
            reason: wire::EndReason::TabClosed,
        }),
    );
    assert_eq!(
        h.next_primary().await.status,
        SessionStatus::Ended {
            reason: EndReason::Closed
        }
    );

    h.message(1, ExtensionMessage::SessionUpdate(update(2)));
    let key = h.next_primary().await.key;
    let handle = h.handle.clone();
    let pending = tokio::spawn(async move { handle.execute(key, Command::ToggleMic).await });
    next_sent(&mut sent).await;

    // The host goes away: its sessions end and its pending commands fail at once.
    h.bridge
        .send(BridgeEvent::Disconnected { connection: 1 })
        .unwrap();
    assert_eq!(pending.await.unwrap(), Err(CommandError::Disconnected));
    let session = h.next_primary().await;
    assert_eq!(session.key.id, "1:2");
    assert_eq!(
        session.status,
        SessionStatus::Ended {
            reason: EndReason::Disconnected
        }
    );
}

#[tokio::test]
async fn reports_whether_the_extension_is_connected_and_its_version() {
    let mut h = Harness::start();
    let meet = |h: &Harness| {
        h.snapshot
            .borrow()
            .providers
            .iter()
            .find(|p| p.id == MEET)
            .cloned()
            .unwrap_or_else(|| panic!("no Meet provider in the snapshot"))
    };
    // The manager publishes its providers as soon as it starts.
    timeout(Duration::from_secs(5), async {
        while h.snapshot.borrow().providers.is_empty() {
            h.snapshot.changed().await.unwrap();
        }
    })
    .await
    .unwrap();
    assert!(!meet(&h).connected);
    let _sent = h.connect(1).await;
    h.message(
        1,
        ExtensionMessage::Hello(Hello {
            extension_version: "0.1.0".into(),
            browser: "Chrome test".into(),
        }),
    );
    timeout(Duration::from_secs(5), async {
        while meet(&h).client_version.is_none() {
            h.snapshot.changed().await.unwrap();
        }
    })
    .await
    .unwrap();
    assert!(meet(&h).connected);
    assert_eq!(meet(&h).client_version.as_deref(), Some("0.1.0"));

    h.bridge
        .send(BridgeEvent::Disconnected { connection: 1 })
        .unwrap();
    timeout(Duration::from_secs(5), async {
        while meet(&h).connected {
            h.snapshot.changed().await.unwrap();
        }
    })
    .await
    .unwrap();
    assert_eq!(meet(&h).client_version, None);
}

#[tokio::test]
async fn connections_are_kept_apart() {
    let mut h = Harness::start();
    let _one = h.connect(1).await;
    let mut two = h.connect(2).await;
    h.message(
        2,
        ExtensionMessage::Hello(Hello {
            extension_version: "0.1.0".into(),
            browser: "Chrome test".into(),
        }),
    );
    // The same tab id in two browsers is two sessions.
    h.message(1, ExtensionMessage::SessionUpdate(update(5)));
    h.next().await;
    let mut other = update(5);
    other.self_state.mic = wire::Toggle::Off;
    h.message(2, ExtensionMessage::SessionUpdate(other));
    tokio::time::sleep(Duration::from_millis(50)).await;

    let key = SessionKey::new(MEET, "2:5");
    let handle = h.handle.clone();
    let command = tokio::spawn(async move { handle.execute(key, Command::FocusTab).await });
    let AppMessage::Command(sent) = next_sent(&mut two).await else {
        panic!("expected a command on connection 2");
    };
    assert_eq!(sent.tab_id, 5);
    h.message(
        2,
        ExtensionMessage::CommandResult(CommandResult::success(sent.id)),
    );
    assert_eq!(command.await.unwrap(), Ok(()));
    assert_eq!(h.provider.extension_version(2).as_deref(), Some("0.1.0"));
    assert_eq!(h.provider.extension_version(1), None);
}

#[tokio::test(start_paused = true)]
async fn unanswered_commands_time_out_and_are_forgotten() {
    let mut h = Harness::start();
    let mut sent = h.connect(1).await;
    h.message(1, ExtensionMessage::SessionUpdate(update(42)));
    let key = h.next_primary().await.key;

    assert_eq!(
        h.handle.execute(key, Command::ToggleMic).await,
        Err(CommandError::Timeout)
    );
    let AppMessage::Command(late) = next_sent(&mut sent).await else {
        panic!("expected a command");
    };
    // A late answer finds nothing waiting and changes nothing.
    h.message(
        1,
        ExtensionMessage::CommandResult(CommandResult::success(late.id)),
    );
    tokio::time::sleep(Duration::from_millis(10)).await;
}
