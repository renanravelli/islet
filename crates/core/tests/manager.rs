//! `SessionManager` tests on tokio's paused clock: sleeps advance time instantly.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use islet_core::{
    CapabilitySet, Command, CommandError, CommandFuture, DegradedReason, EndReason, EventSink,
    Field, Health, Provider, ProviderDetail, ProviderId, ProviderStatus, SessionEvent,
    SessionHandle, SessionKey, SessionManager, SessionState, SessionStatus, Settings, Speaker,
    Timings, Toggle, UiSnapshot,
};
use tokio::sync::watch;
use tokio::time::sleep;

const FAKE: ProviderId = ProviderId::from_static("fake");

/// How the fake answers commands.
#[derive(Clone, Copy)]
enum Answer {
    Confirm,
    Fail(CommandError),
    Never,
}

struct FakeProvider {
    capabilities: CapabilitySet,
    answer: Answer,
    sink: Mutex<Option<EventSink>>,
    executed: Mutex<Vec<(String, Command)>>,
}

impl FakeProvider {
    fn new(capabilities: CapabilitySet, answer: Answer) -> Arc<Self> {
        Arc::new(Self {
            capabilities,
            answer,
            sink: Mutex::new(None),
            executed: Mutex::new(Vec::new()),
        })
    }

    fn emit(&self, event: SessionEvent) {
        let sink = self.sink.lock().unwrap();
        sink.as_ref().expect("subscribed").send(event).unwrap();
    }

    fn status(&self, status: ProviderStatus) {
        let sink = self.sink.lock().unwrap();
        sink.as_ref()
            .expect("subscribed")
            .set_status(status)
            .unwrap();
    }

    fn update(&self, id: &str, state: SessionState) {
        self.emit(SessionEvent::Updated {
            id: id.into(),
            state,
        });
    }

    fn executed(&self) -> Vec<(String, Command)> {
        self.executed.lock().unwrap().clone()
    }
}

impl Provider for FakeProvider {
    fn id(&self) -> ProviderId {
        FAKE
    }

    fn capabilities(&self) -> CapabilitySet {
        self.capabilities
    }

    fn subscribe(&self, sink: EventSink) {
        *self.sink.lock().unwrap() = Some(sink);
    }

    fn execute(&self, session_id: &str, command: Command) -> CommandFuture<'_> {
        self.executed
            .lock()
            .unwrap()
            .push((session_id.to_owned(), command));
        let answer = self.answer;
        Box::pin(async move {
            match answer {
                Answer::Confirm => Ok(()),
                Answer::Fail(error) => Err(error),
                Answer::Never => std::future::pending().await,
            }
        })
    }
}

fn state(mic: Toggle) -> SessionState {
    SessionState {
        started_at: 1_793_700_000_000,
        mic,
        cam: Toggle::Off,
        hand: Toggle::Off,
        capabilities: CapabilitySet::all(),
        ..SessionState::default()
    }
}

fn key(id: &str) -> SessionKey {
    SessionKey::new(FAKE, id)
}

fn start(provider: &Arc<FakeProvider>) -> (SessionHandle, watch::Receiver<UiSnapshot>) {
    let handle = SessionManager::new(Timings::default())
        .with_provider(provider.clone())
        .spawn();
    let snapshot = handle.snapshot();
    (handle, snapshot)
}

async fn next(snapshot: &mut watch::Receiver<UiSnapshot>) -> UiSnapshot {
    snapshot.changed().await.expect("manager running");
    snapshot.borrow_and_update().clone()
}

#[tokio::test(start_paused = true)]
async fn publishes_the_primary_session() {
    let provider = FakeProvider::new(CapabilitySet::all(), Answer::Confirm);
    let (_handle, mut snapshot) = start(&provider);
    assert_eq!(snapshot.borrow().primary, None);

    provider.update("1", state(Toggle::On));
    let primary = next(&mut snapshot).await.primary.unwrap();
    assert_eq!(primary.key, key("1"));
    assert_eq!(primary.state.mic, Toggle::On);
}

#[tokio::test(start_paused = true)]
async fn unchanged_heartbeats_do_not_wake_the_ui() {
    let provider = FakeProvider::new(CapabilitySet::all(), Answer::Confirm);
    let (_handle, mut snapshot) = start(&provider);
    provider.update("1", state(Toggle::Off));
    next(&mut snapshot).await;

    for _ in 0..3 {
        sleep(Duration::from_secs(5)).await;
        provider.update("1", state(Toggle::Off));
    }
    sleep(Duration::from_millis(1)).await;
    assert!(!snapshot.has_changed().unwrap());
}

#[tokio::test(start_paused = true)]
async fn ended_sessions_go_idle_after_five_seconds() {
    let provider = FakeProvider::new(CapabilitySet::all(), Answer::Confirm);
    let (_handle, mut snapshot) = start(&provider);
    provider.update("1", state(Toggle::On));
    next(&mut snapshot).await;

    provider.emit(SessionEvent::Ended {
        id: "1".into(),
        reason: EndReason::CallEnded,
    });
    let ended_at = tokio::time::Instant::now();
    let ended = next(&mut snapshot).await.primary.unwrap();
    assert_eq!(
        ended.status,
        SessionStatus::Ended {
            reason: EndReason::CallEnded
        }
    );

    assert_eq!(next(&mut snapshot).await.primary, None);
    assert_eq!(ended_at.elapsed(), Duration::from_secs(5));
}

#[tokio::test(start_paused = true)]
async fn silent_sessions_become_stale_after_ten_seconds() {
    let provider = FakeProvider::new(CapabilitySet::all(), Answer::Confirm);
    let (_handle, mut snapshot) = start(&provider);
    provider.update("1", state(Toggle::On));
    next(&mut snapshot).await;
    let last_update = tokio::time::Instant::now();

    let stale = next(&mut snapshot).await.primary.unwrap();
    assert_eq!(last_update.elapsed(), Duration::from_secs(10));
    assert_eq!(stale.state.mic, Toggle::Unknown);
    assert_eq!(
        stale.state.health,
        Health::degraded([DegradedReason::Stale])
    );

    provider.update("1", state(Toggle::On));
    assert_eq!(
        next(&mut snapshot).await.primary.unwrap().state.mic,
        Toggle::On
    );
}

#[tokio::test(start_paused = true)]
async fn commands_wait_for_the_provider_and_never_change_state() {
    let provider = FakeProvider::new(CapabilitySet::all(), Answer::Confirm);
    let (handle, mut snapshot) = start(&provider);
    provider.update("1", state(Toggle::On));
    next(&mut snapshot).await;

    assert_eq!(handle.execute(key("1"), Command::ToggleMic).await, Ok(()));
    assert_eq!(provider.executed(), [("1".to_owned(), Command::ToggleMic)]);
    // No optimistic update: the mic stays on until the provider reports otherwise.
    assert!(!snapshot.has_changed().unwrap());
    assert_eq!(
        snapshot.borrow().primary.as_ref().unwrap().state.mic,
        Toggle::On
    );

    provider.update("1", state(Toggle::Off));
    assert_eq!(
        next(&mut snapshot).await.primary.unwrap().state.mic,
        Toggle::Off
    );
}

#[tokio::test(start_paused = true)]
async fn commands_time_out_after_two_seconds() {
    let provider = FakeProvider::new(CapabilitySet::all(), Answer::Never);
    let (handle, mut snapshot) = start(&provider);
    provider.update("1", state(Toggle::On));
    next(&mut snapshot).await;

    let sent = tokio::time::Instant::now();
    assert_eq!(
        handle.execute(key("1"), Command::Leave).await,
        Err(CommandError::Timeout)
    );
    assert_eq!(sent.elapsed(), Duration::from_secs(2));
}

#[tokio::test(start_paused = true)]
async fn provider_errors_are_passed_through() {
    let provider = FakeProvider::new(
        CapabilitySet::all(),
        Answer::Fail(CommandError::NotConfirmed),
    );
    let (handle, mut snapshot) = start(&provider);
    provider.update("1", state(Toggle::On));
    next(&mut snapshot).await;

    assert_eq!(
        handle.execute(key("1"), Command::ToggleCam).await,
        Err(CommandError::NotConfirmed)
    );
}

#[tokio::test(start_paused = true)]
async fn only_declared_capabilities_reach_the_ui() {
    let declared: CapabilitySet = [Command::ToggleMic, Command::FocusTab]
        .into_iter()
        .collect();
    let provider = FakeProvider::new(declared, Answer::Confirm);
    let (handle, mut snapshot) = start(&provider);

    let mut reported = state(Toggle::On);
    reported.capabilities = [Command::ToggleMic, Command::ToggleHand]
        .into_iter()
        .collect();
    provider.update("1", reported);
    let primary = next(&mut snapshot).await.primary.unwrap();
    assert_eq!(
        primary.state.capabilities,
        [Command::ToggleMic].into_iter().collect()
    );

    // Neither undeclared nor unreported commands reach the provider.
    for command in [Command::ToggleHand, Command::FocusTab] {
        assert_eq!(
            handle.execute(key("1"), command).await,
            Err(CommandError::Unsupported)
        );
    }
    assert!(provider.executed().is_empty());
}

#[tokio::test(start_paused = true)]
async fn commands_need_an_active_session() {
    let provider = FakeProvider::new(CapabilitySet::all(), Answer::Confirm);
    let (handle, mut snapshot) = start(&provider);

    assert_eq!(
        handle.execute(key("nope"), Command::ToggleMic).await,
        Err(CommandError::NoSession)
    );

    provider.update("1", state(Toggle::On));
    next(&mut snapshot).await;
    provider.emit(SessionEvent::Ended {
        id: "1".into(),
        reason: EndReason::Closed,
    });
    next(&mut snapshot).await;
    assert_eq!(
        handle.execute(key("1"), Command::ToggleMic).await,
        Err(CommandError::SessionEnded)
    );
    assert!(provider.executed().is_empty());
}

fn named_state() -> SessionState {
    SessionState {
        title: Some("Synthetic title".into()),
        active_speaker: Some(Speaker::new("Alex Example")),
        participants: vec![Speaker::new("Alex Example"), Speaker::new("Sam Example")],
        self_participant: Some(Speaker::new("Sam Example")),
        health: Health::degraded([DegradedReason::Unreadable(Field::Mic)])
            .with_details(ProviderDetail::new("micButton")),
        ..state(Toggle::Unknown)
    }
}

#[tokio::test(start_paused = true)]
async fn hidden_names_never_reach_the_snapshot() {
    let provider = FakeProvider::new(CapabilitySet::all(), Answer::Confirm);
    let handle = SessionManager::new(Timings::default())
        .with_settings(Settings {
            show_participant_names: false,
        })
        .with_provider(provider.clone())
        .spawn();
    let mut snapshot = handle.snapshot();
    provider.update("1", named_state());

    let hidden = next(&mut snapshot).await;
    let json = serde_json::to_string(&hidden).unwrap();
    assert!(!json.contains("Alex"), "{json}");
    assert!(!json.contains("Synthetic title"), "{json}");
    assert!(!json.contains("Sam"), "{json}");
    let session = hidden.primary.unwrap();
    // Someone is still speaking; who is not shown.
    assert_eq!(session.state.active_speaker, Some(Speaker::anonymous()));
    // The avatar row keeps its size, with generic avatars.
    assert_eq!(session.state.participants, vec![Speaker::anonymous(); 2]);
    assert_eq!(session.state.self_participant, Some(Speaker::anonymous()));
    assert_eq!(session.state.title, None);

    handle.set_settings(Settings::default());
    let shown = next(&mut snapshot).await.primary.unwrap();
    assert_eq!(
        shown.state.active_speaker,
        Some(Speaker::new("Alex Example"))
    );
}

#[tokio::test(start_paused = true)]
async fn diagnostics_have_no_personal_data() {
    let provider = FakeProvider::new(CapabilitySet::all(), Answer::Confirm);
    let (handle, mut snapshot) = start(&provider);
    provider.status(ProviderStatus {
        connected: true,
        client_version: Some("0.1.0".into()),
    });
    provider.update("1", named_state());
    next(&mut snapshot).await;
    sleep(Duration::from_secs(3)).await;
    provider.update("1", state(Toggle::On));
    sleep(Duration::from_secs(1)).await;

    let diagnostics = handle.diagnostics().await.unwrap();
    let text = diagnostics.to_string();
    let json = serde_json::to_string(&diagnostics).unwrap();
    for out in [&text, &json] {
        for secret in ["Alex", "Synthetic title", "fake:1", "\"1\""] {
            assert!(!out.contains(secret), "{secret} in {out}");
        }
    }
    let [fake] = diagnostics.providers.as_slice() else {
        panic!("one provider expected");
    };
    assert!(fake.connected);
    assert_eq!(fake.client_version.as_deref(), Some("0.1.0"));
    assert_eq!(fake.sessions, 1);
    assert_eq!(fake.health, Some(Health::Ok));
    assert_eq!(fake.last_update_secs_ago, Some(1));
    assert_eq!(fake.last_degraded_secs_ago, Some(4));
    assert!(text.contains("unreadable mic"), "{text}");
    assert!(text.contains("micButton"), "{text}");
    assert!(text.contains("client 0.1.0"), "{text}");
}

#[tokio::test(start_paused = true)]
async fn the_snapshot_lists_providers_with_their_last_health() {
    let provider = FakeProvider::new(CapabilitySet::all(), Answer::Confirm);
    let (_handle, mut snapshot) = start(&provider);
    provider.update("1", named_state());
    next(&mut snapshot).await;
    provider.emit(SessionEvent::Ended {
        id: "1".into(),
        reason: EndReason::CallEnded,
    });
    // After the session is gone, its last health stays for the settings pane.
    sleep(Duration::from_secs(6)).await;
    let current = snapshot.borrow().clone();
    assert_eq!(current.primary, None);
    let [view] = current.providers.as_slice() else {
        panic!("one provider expected");
    };
    assert_eq!(view.id, FAKE);
    assert!(!view.last_health.as_ref().unwrap().is_ok());
}
