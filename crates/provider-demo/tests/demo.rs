//! The demo provider driving a real `SessionManager`, on tokio's paused clock.

use std::sync::Arc;
use std::time::Duration;

use islet_core::{
    Command, CommandError, DegradedReason, EndReason, Health, MeetingSession, SessionHandle,
    SessionKey, SessionManager, SessionStatus, Timings, Toggle, UiSnapshot,
};
use islet_provider_demo::{CONFIRM_DELAY, Change, DEMO, DemoProvider, Script, Step};
use tokio::sync::watch;
use tokio::time::{Instant, sleep, timeout};

fn start(script: Script) -> (SessionHandle, watch::Receiver<UiSnapshot>) {
    let handle = SessionManager::new(Timings::default())
        .with_provider(Arc::new(DemoProvider::new(script)))
        .spawn();
    let snapshot = handle.snapshot();
    (handle, snapshot)
}

async fn next(snapshot: &mut watch::Receiver<UiSnapshot>) -> UiSnapshot {
    snapshot.changed().await.expect("manager running");
    snapshot.borrow_and_update().clone()
}

async fn next_primary(snapshot: &mut watch::Receiver<UiSnapshot>) -> MeetingSession {
    next(snapshot).await.primary.expect("a session")
}

fn joined_only() -> Script {
    Script {
        steps: vec![Step::new(
            Duration::ZERO,
            Change::Join {
                title: "Test call",
                participants: 2,
            },
        )],
        repeat: false,
    }
}

#[tokio::test(start_paused = true)]
async fn the_tour_shows_every_island_state_and_repeats() {
    let (_handle, mut snapshot) = start(Script::tour());
    let mut seen = Vec::new();
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(100) {
        seen.push(next(&mut snapshot).await);
    }

    let sessions: Vec<&MeetingSession> = seen.iter().filter_map(|s| s.primary.as_ref()).collect();
    let saw = |what: &str, check: &dyn Fn(&MeetingSession) -> bool| {
        assert!(
            sessions.iter().any(|s| check(s)),
            "the tour never showed {what}"
        );
    };
    saw("the mic on", &|s| s.state.mic == Toggle::On);
    saw("the mic off", &|s| s.state.mic == Toggle::Off);
    saw("an unknown mic", &|s| {
        s.state.mic == Toggle::Unknown && s.status == SessionStatus::Active
    });
    saw("a speaker", &|s| s.state.active_speaker.is_some());
    saw("the speaking-while-muted alert", &|s| {
        s.state.signals.speaking_while_muted && s.state.mic == Toggle::Off
    });
    saw("a raised hand", &|s| s.state.hand == Toggle::On);
    saw("a degraded session", &|s| !s.state.health.is_ok());
    saw("an ended session", &|s| {
        matches!(s.status, SessionStatus::Ended { .. })
    });
    assert!(seen.iter().any(|s| s.primary.is_none()), "never idle");

    // Never stale: the demo sends heartbeats even when nothing changes for a while.
    for session in &sessions {
        if let Health::Degraded { reasons, .. } = &session.state.health {
            assert!(!reasons.contains(&DegradedReason::Stale));
        }
    }

    // It started over with a fresh session.
    let ids: Vec<&str> = sessions.iter().map(|s| s.key.id.as_str()).collect();
    assert!(
        ids.contains(&"demo-1") && ids.contains(&"demo-2"),
        "{ids:?}"
    );
    assert!(sessions.iter().all(|s| s.key.provider == DEMO));
}

#[tokio::test(start_paused = true)]
async fn heartbeats_keep_a_quiet_session_fresh() {
    let (_handle, mut snapshot) = start(joined_only());
    let joined = next_primary(&mut snapshot).await;
    assert_eq!(joined.state.mic, Toggle::On);

    // Nothing changes for a minute, so the UI is never woken up.
    let quiet = timeout(Duration::from_secs(60), snapshot.changed()).await;
    assert!(quiet.is_err(), "the session went stale or changed");
}

#[tokio::test(start_paused = true)]
async fn commands_are_confirmed_after_a_delay() {
    let (handle, mut snapshot) = start(joined_only());
    let key = next_primary(&mut snapshot).await.key;

    let sent = Instant::now();
    assert_eq!(
        handle.execute(key.clone(), Command::ToggleMic).await,
        Ok(())
    );
    assert_eq!(sent.elapsed(), CONFIRM_DELAY);
    assert_eq!(next_primary(&mut snapshot).await.state.mic, Toggle::Off);

    handle
        .execute(key.clone(), Command::ToggleHand)
        .await
        .unwrap();
    assert_eq!(next_primary(&mut snapshot).await.state.hand, Toggle::On);

    handle
        .execute(key.clone(), Command::ToggleCam)
        .await
        .unwrap();
    assert_eq!(next_primary(&mut snapshot).await.state.cam, Toggle::On);

    // Focusing changes nothing.
    handle.execute(key, Command::FocusTab).await.unwrap();
    sleep(Duration::from_secs(1)).await;
    assert!(!snapshot.has_changed().unwrap());
}

#[tokio::test(start_paused = true)]
async fn turning_the_mic_on_clears_the_muted_alert() {
    let mut script = joined_only();
    script.steps.extend([
        Step::new(Duration::from_secs(1), Change::Mic(Toggle::Off)),
        Step::new(Duration::from_secs(1), Change::SpeakingWhileMuted(true)),
    ]);
    let (handle, mut snapshot) = start(script);
    let key = next_primary(&mut snapshot).await.key;
    next(&mut snapshot).await;
    assert!(
        next_primary(&mut snapshot)
            .await
            .state
            .signals
            .speaking_while_muted
    );

    handle.execute(key, Command::ToggleMic).await.unwrap();
    let after = next_primary(&mut snapshot).await;
    assert_eq!(after.state.mic, Toggle::On);
    assert!(!after.state.signals.speaking_while_muted);
}

#[tokio::test(start_paused = true)]
async fn leaving_ends_the_session() {
    let (handle, mut snapshot) = start(joined_only());
    let key = next_primary(&mut snapshot).await.key;

    handle.execute(key.clone(), Command::Leave).await.unwrap();
    assert_eq!(
        next_primary(&mut snapshot).await.status,
        SessionStatus::Ended {
            reason: EndReason::CallEnded
        }
    );
    assert_eq!(
        handle.execute(key, Command::ToggleMic).await,
        Err(CommandError::SessionEnded)
    );
    assert_eq!(next(&mut snapshot).await, UiSnapshot::default());
}

#[tokio::test(start_paused = true)]
async fn rejects_commands_for_another_session() {
    let (handle, mut snapshot) = start(joined_only());
    next(&mut snapshot).await;
    assert_eq!(
        handle
            .execute(SessionKey::new(DEMO, "demo-99"), Command::ToggleMic)
            .await,
        Err(CommandError::NoSession)
    );
}
