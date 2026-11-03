//! `SessionManager` tests on tokio's paused clock: sleeps advance time instantly.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use islet_core::{
    CapabilitySet, Command, CommandError, CommandFuture, DegradedReason, EndReason, EventSink,
    Health, Provider, ProviderId, SessionEvent, SessionHandle, SessionKey, SessionManager,
    SessionState, SessionStatus, Timings, Toggle, UiSnapshot,
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
    assert_eq!(*snapshot.borrow(), UiSnapshot::default());

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

    assert_eq!(next(&mut snapshot).await, UiSnapshot::default());
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
