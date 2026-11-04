//! The pure session reducer. Time is an argument, so tests control it completely.

use std::collections::BTreeMap;
use std::time::Duration;

use serde::Serialize;
use tokio::time::Instant;
use ts_rs::TS;

use crate::{
    CapabilitySet, DegradedReason, EndReason, Health, MeetingSession, SessionKey, SessionState,
    SessionStatus, Signals, Toggle,
};

/// Lifecycle durations. The defaults are the product decisions in `CLAUDE.md`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Timings {
    /// How long an ended session stays visible before it is dropped.
    pub ended_linger: Duration,
    /// Silence after which a session is marked degraded (`stale`).
    pub stale_after: Duration,
    /// How long the manager waits for a provider to confirm a command.
    pub command_timeout: Duration,
}

impl Default for Timings {
    fn default() -> Self {
        Self {
            ended_linger: Duration::from_secs(5),
            stale_after: Duration::from_secs(10),
            command_timeout: Duration::from_secs(2),
        }
    }
}

/// An input to [`reduce`].
// A full `SessionState` (photos included, ADR 0007) is about 240 bytes. Events are short-lived
// and go through a channel one at a time, so boxing it would only add an allocation.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Updated(SessionKey, SessionState),
    Ended(SessionKey, EndReason),
    /// Time has passed: drop expired ended sessions and mark silent ones stale.
    Tick,
}

/// What the UI renders. `primary: None` means idle: the island is hidden. `providers` feeds the
/// tray, the onboarding and the settings.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "ui-types/src/generated/ui.ts")]
pub struct UiSnapshot {
    pub primary: Option<MeetingSession>,
    pub providers: Vec<crate::ProviderView>,
}

/// Every session the manager knows about.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Sessions {
    timings: Timings,
    entries: BTreeMap<SessionKey, Entry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Entry {
    /// As last reported by the provider.
    state: SessionState,
    phase: Phase,
    /// Last time the reported state changed. Heartbeats do not count, so two open calls do not
    /// swap places every few seconds.
    last_changed: Instant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Active { last_seen: Instant, stale: bool },
    Ended { reason: EndReason, at: Instant },
}

/// Applies `event` at time `now`.
pub fn reduce(mut sessions: Sessions, event: Event, now: Instant) -> Sessions {
    match event {
        Event::Updated(key, state) => {
            let active = Phase::Active {
                last_seen: now,
                stale: false,
            };
            match sessions.entries.get_mut(&key) {
                Some(entry) => {
                    let changed = entry.state != state
                        || !matches!(entry.phase, Phase::Active { stale: false, .. });
                    entry.state = state;
                    entry.phase = active;
                    if changed {
                        entry.last_changed = now;
                    }
                }
                None => {
                    sessions.entries.insert(
                        key,
                        Entry {
                            state,
                            phase: active,
                            last_changed: now,
                        },
                    );
                }
            }
        }
        Event::Ended(key, reason) => {
            if let Some(entry) = sessions.entries.get_mut(&key)
                && matches!(entry.phase, Phase::Active { .. })
            {
                entry.phase = Phase::Ended { reason, at: now };
                entry.last_changed = now;
            }
        }
        Event::Tick => {
            let timings = sessions.timings;
            sessions.entries.retain(|_, entry| match &mut entry.phase {
                Phase::Active { last_seen, stale } => {
                    if now.saturating_duration_since(*last_seen) >= timings.stale_after {
                        *stale = true;
                    }
                    true
                }
                Phase::Ended { at, .. } => {
                    now.saturating_duration_since(*at) < timings.ended_linger
                }
            });
        }
    }
    sessions
}

impl Sessions {
    pub fn new(timings: Timings) -> Self {
        Self {
            timings,
            entries: BTreeMap::new(),
        }
    }

    pub fn timings(&self) -> Timings {
        self.timings
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Sessions of `provider`, active or ended.
    pub fn count_for(&self, provider: &crate::ProviderId) -> usize {
        self.entries
            .keys()
            .filter(|key| key.provider == *provider)
            .count()
    }

    /// The session as the UI should see it.
    pub fn get(&self, key: &SessionKey) -> Option<MeetingSession> {
        self.entries.get(key).map(|entry| entry.view(key))
    }

    /// The session the island shows: one with the mic or camera on, then the most recently
    /// changed active one, then the most recently ended one.
    pub fn primary(&self) -> Option<MeetingSession> {
        self.entries
            .iter()
            .map(|(key, entry)| (entry.view(key), entry.last_changed))
            .max_by(|(a, a_changed), (b, b_changed)| {
                rank(a)
                    .cmp(&rank(b))
                    .then(a_changed.cmp(b_changed))
                    // Deterministic tie-break: the smaller key wins.
                    .then_with(|| b.key.cmp(&a.key))
            })
            .map(|(session, _)| session)
    }

    pub fn snapshot(&self) -> UiSnapshot {
        UiSnapshot {
            primary: self.primary(),
            providers: Vec::new(),
        }
    }

    /// When the next [`Event::Tick`] can change something.
    pub fn next_deadline(&self) -> Option<Instant> {
        self.entries
            .values()
            .filter_map(|entry| match entry.phase {
                Phase::Active {
                    last_seen,
                    stale: false,
                } => Some(last_seen + self.timings.stale_after),
                Phase::Active { stale: true, .. } => None,
                Phase::Ended { at, .. } => Some(at + self.timings.ended_linger),
            })
            .min()
    }
}

fn rank(session: &MeetingSession) -> u8 {
    match session.status {
        SessionStatus::Ended { .. } => 0,
        SessionStatus::Active if session.state.mic.is_on() || session.state.cam.is_on() => 2,
        SessionStatus::Active => 1,
    }
}

impl Entry {
    /// Applies the `Unknown` policy: what we can no longer vouch for is not shown.
    fn view(&self, key: &SessionKey) -> MeetingSession {
        let mut state = self.state.clone();
        let status = match self.phase {
            Phase::Active { stale: false, .. } => SessionStatus::Active,
            Phase::Active { stale: true, .. } => {
                forget_live_state(&mut state);
                state.health = state.health.with_reason(DegradedReason::Stale);
                SessionStatus::Active
            }
            Phase::Ended { reason, .. } => {
                forget_live_state(&mut state);
                state.capabilities = CapabilitySet::EMPTY;
                state.health = Health::Ok;
                SessionStatus::Ended { reason }
            }
        };
        MeetingSession {
            key: key.clone(),
            status,
            state,
        }
    }
}

fn forget_live_state(state: &mut SessionState) {
    state.mic = Toggle::Unknown;
    state.cam = Toggle::Unknown;
    state.hand = Toggle::Unknown;
    state.active_speaker = None;
    state.raised_hands = None;
    state.signals = Signals::default();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Command, Field, ProviderDetail, ProviderId, Speaker};

    const MEET: ProviderId = ProviderId::from_static("meet");

    fn key(id: &str) -> SessionKey {
        SessionKey::new(MEET, id)
    }

    fn state(mic: Toggle, cam: Toggle) -> SessionState {
        SessionState {
            title: Some("Synthetic title".into()),
            started_at: 1_793_700_000_000,
            mic,
            cam,
            hand: Toggle::Off,
            active_speaker: Some(Speaker::new("Alex Example")),
            participant_count: Some(3),
            participants: Vec::new(),
            self_participant: None,
            raised_hands: None,
            signals: Signals {
                speaking_while_muted: true,
            },
            capabilities: CapabilitySet::all(),
            health: Health::Ok,
        }
    }

    fn secs(start: Instant, s: f64) -> Instant {
        start + Duration::from_secs_f64(s)
    }

    struct Clock {
        start: Instant,
        sessions: Sessions,
    }

    impl Clock {
        fn new() -> Self {
            Self {
                start: Instant::now(),
                sessions: Sessions::new(Timings::default()),
            }
        }

        fn at(&mut self, s: f64, event: Event) -> &Sessions {
            let sessions = std::mem::take(&mut self.sessions);
            self.sessions = reduce(sessions, event, secs(self.start, s));
            &self.sessions
        }
    }

    fn primary_id(sessions: &Sessions) -> Option<String> {
        sessions.primary().map(|s| s.key.id)
    }

    #[test]
    fn starts_idle() {
        let sessions = Sessions::new(Timings::default());
        assert_eq!(sessions.snapshot(), UiSnapshot::default());
        assert_eq!(sessions.next_deadline(), None);
    }

    #[test]
    fn an_update_creates_an_active_session() {
        let mut clock = Clock::new();
        let sessions = clock.at(
            0.0,
            Event::Updated(key("1"), state(Toggle::Off, Toggle::Off)),
        );
        let primary = sessions.primary().unwrap();
        assert_eq!(primary.status, SessionStatus::Active);
        assert_eq!(primary.state, state(Toggle::Off, Toggle::Off));
    }

    #[test]
    fn election_prefers_live_media_then_the_latest_change() {
        let mut clock = Clock::new();
        clock.at(
            0.0,
            Event::Updated(key("a"), state(Toggle::On, Toggle::Off)),
        );
        clock.at(
            1.0,
            Event::Updated(key("b"), state(Toggle::Off, Toggle::Off)),
        );
        assert_eq!(primary_id(&clock.sessions).as_deref(), Some("a"));

        // Camera on also counts; both have live media, so the latest change wins.
        clock.at(
            2.0,
            Event::Updated(key("b"), state(Toggle::Off, Toggle::On)),
        );
        assert_eq!(primary_id(&clock.sessions).as_deref(), Some("b"));

        // Unknown is not "on".
        clock.at(
            3.0,
            Event::Updated(key("b"), state(Toggle::Unknown, Toggle::Unknown)),
        );
        assert_eq!(primary_id(&clock.sessions).as_deref(), Some("a"));

        // Without live media anywhere, the latest change wins.
        clock.at(
            4.0,
            Event::Updated(key("a"), state(Toggle::Off, Toggle::Off)),
        );
        assert_eq!(primary_id(&clock.sessions).as_deref(), Some("a"));
        clock.at(
            5.0,
            Event::Updated(key("b"), state(Toggle::Off, Toggle::Off)),
        );
        assert_eq!(primary_id(&clock.sessions).as_deref(), Some("b"));
    }

    #[test]
    fn heartbeats_do_not_reorder_sessions() {
        let mut clock = Clock::new();
        clock.at(
            0.0,
            Event::Updated(key("a"), state(Toggle::Off, Toggle::Off)),
        );
        clock.at(
            1.0,
            Event::Updated(key("b"), state(Toggle::Off, Toggle::Off)),
        );
        // "a" repeats its unchanged state later than "b" changed.
        clock.at(
            5.0,
            Event::Updated(key("a"), state(Toggle::Off, Toggle::Off)),
        );
        assert_eq!(primary_id(&clock.sessions).as_deref(), Some("b"));
    }

    #[test]
    fn ended_sessions_linger_then_go_idle() {
        let mut clock = Clock::new();
        clock.at(0.0, Event::Updated(key("1"), state(Toggle::On, Toggle::On)));
        let sessions = clock.at(1.0, Event::Ended(key("1"), EndReason::CallEnded));
        let ended = sessions.primary().unwrap();
        assert_eq!(
            ended.status,
            SessionStatus::Ended {
                reason: EndReason::CallEnded
            }
        );
        // Nothing live is shown for an ended call, and no controls are offered.
        assert_eq!(ended.state.mic, Toggle::Unknown);
        assert_eq!(ended.state.active_speaker, None);
        assert!(ended.state.capabilities.is_empty());
        assert_eq!(sessions.next_deadline(), Some(secs(clock.start, 6.0)));

        assert!(clock.at(5.9, Event::Tick).primary().is_some());
        assert_eq!(clock.at(6.0, Event::Tick).snapshot(), UiSnapshot::default());
        assert!(clock.sessions.is_empty());
    }

    #[test]
    fn an_active_session_outranks_an_ended_one() {
        let mut clock = Clock::new();
        clock.at(
            0.0,
            Event::Updated(key("a"), state(Toggle::Off, Toggle::Off)),
        );
        clock.at(
            1.0,
            Event::Updated(key("b"), state(Toggle::On, Toggle::Off)),
        );
        clock.at(2.0, Event::Ended(key("b"), EndReason::Closed));
        assert_eq!(primary_id(&clock.sessions).as_deref(), Some("a"));
    }

    #[test]
    fn ending_twice_keeps_the_first_end() {
        let mut clock = Clock::new();
        clock.at(
            0.0,
            Event::Updated(key("1"), state(Toggle::Off, Toggle::Off)),
        );
        clock.at(1.0, Event::Ended(key("1"), EndReason::CallEnded));
        clock.at(4.0, Event::Ended(key("1"), EndReason::Closed));
        let ended = clock.sessions.primary().unwrap();
        assert_eq!(
            ended.status,
            SessionStatus::Ended {
                reason: EndReason::CallEnded
            }
        );
        assert!(clock.at(6.0, Event::Tick).is_empty());
    }

    #[test]
    fn ending_an_unknown_session_is_ignored() {
        let mut clock = Clock::new();
        assert!(
            clock
                .at(0.0, Event::Ended(key("ghost"), EndReason::Closed))
                .is_empty()
        );
    }

    #[test]
    fn an_update_revives_an_ended_session() {
        let mut clock = Clock::new();
        clock.at(
            0.0,
            Event::Updated(key("1"), state(Toggle::Off, Toggle::Off)),
        );
        clock.at(1.0, Event::Ended(key("1"), EndReason::CallEnded));
        clock.at(
            2.0,
            Event::Updated(key("1"), state(Toggle::On, Toggle::Off)),
        );
        let session = clock.at(10.0, Event::Tick).primary().unwrap();
        assert_eq!(session.status, SessionStatus::Active);
        assert_eq!(session.state.mic, Toggle::On);
    }

    #[test]
    fn silent_sessions_become_stale_and_unknown() {
        let mut clock = Clock::new();
        let mut reported = state(Toggle::On, Toggle::Off);
        reported.health = Health::degraded([DegradedReason::Unreadable(Field::ParticipantCount)])
            .with_details(ProviderDetail::new("participantCount"));
        reported.raised_hands = Some(crate::RaisedHands {
            first: Speaker::new("Sam Example"),
            count: 1,
            since: 1_793_700_060_000,
        });
        clock.at(0.0, Event::Updated(key("1"), reported.clone()));
        assert_eq!(
            clock.sessions.next_deadline(),
            Some(secs(clock.start, 10.0))
        );

        let not_yet = clock.at(9.9, Event::Tick).primary().unwrap();
        assert_eq!(not_yet.state, reported, "not stale yet");

        let stale = clock.at(10.0, Event::Tick).primary().unwrap();
        assert_eq!(stale.status, SessionStatus::Active);
        assert_eq!(
            stale.state.health,
            Health::degraded([
                DegradedReason::Unreadable(Field::ParticipantCount),
                DegradedReason::Stale
            ])
            .with_details(ProviderDetail::new("participantCount")),
            "staleness keeps the provider details"
        );
        assert_eq!(stale.state.mic, Toggle::Unknown);
        assert_eq!(stale.state.cam, Toggle::Unknown);
        assert_eq!(stale.state.active_speaker, None);
        assert_eq!(
            stale.state.raised_hands, None,
            "a stale line of hands is not shown"
        );
        assert!(!stale.state.signals.speaking_while_muted);
        // Still offers controls: the provider may yet answer.
        assert!(stale.state.capabilities.contains(Command::ToggleMic));
        assert_eq!(clock.sessions.next_deadline(), None);

        // The next update, even an unchanged heartbeat, restores it.
        let fresh = clock
            .at(12.0, Event::Updated(key("1"), reported.clone()))
            .primary();
        assert_eq!(fresh.unwrap().state, reported);
    }

    #[test]
    fn stale_sessions_lose_priority() {
        let mut clock = Clock::new();
        clock.at(
            0.0,
            Event::Updated(key("a"), state(Toggle::On, Toggle::Off)),
        );
        clock.at(
            1.0,
            Event::Updated(key("b"), state(Toggle::Off, Toggle::Off)),
        );
        clock.at(
            8.0,
            Event::Updated(key("b"), state(Toggle::Off, Toggle::Off)),
        );
        // "a" goes silent and its mic becomes Unknown; "b" changed more recently.
        assert_eq!(
            primary_id(clock.at(10.0, Event::Tick)).as_deref(),
            Some("b")
        );
    }

    #[test]
    fn debug_output_never_contains_personal_data() {
        let mut clock = Clock::new();
        clock.at(
            0.0,
            Event::Updated(key("1"), state(Toggle::On, Toggle::Off)),
        );
        let debug = format!("{:?} {:?}", clock.sessions, clock.sessions.snapshot());
        assert!(!debug.contains("Alex"), "{debug}");
        assert!(!debug.contains("Synthetic title"), "{debug}");
    }

    #[test]
    fn provider_details_accept_only_identifiers() {
        for ok in ["micButton", "leave_button", "v2.speaker-tile", "a"] {
            assert!(ProviderDetail::new(ok).is_some(), "{ok}");
        }
        for bad in [
            "",
            "Alex Example",
            "Weekly design review",
            "mic button",
            "título",
            "<b>",
            &"x".repeat(ProviderDetail::MAX_LEN + 1),
        ] {
            assert!(ProviderDetail::new(bad).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn degraded_health_serializes_reasons_and_details() {
        let health = Health::degraded([DegradedReason::Unreadable(Field::Mic)])
            .with_details(ProviderDetail::new("micButton"));
        assert_eq!(
            serde_json::to_value(health).unwrap(),
            serde_json::json!({
                "status": "degraded",
                "reasons": [{"unreadable": "mic"}],
                "provider_details": ["micButton"],
            })
        );
        assert_eq!(
            Health::Ok.with_details(ProviderDetail::new("micButton")),
            Health::Ok
        );
    }

    #[test]
    fn snapshot_serializes_flat_for_the_ui() {
        let mut clock = Clock::new();
        clock.at(
            0.0,
            Event::Updated(key("1"), state(Toggle::On, Toggle::Unknown)),
        );
        let json = serde_json::to_value(clock.sessions.snapshot()).unwrap();
        let primary = &json["primary"];
        assert_eq!(
            primary["key"],
            serde_json::json!({"provider": "meet", "id": "1"})
        );
        assert_eq!(primary["status"], serde_json::json!({"phase": "active"}));
        assert_eq!(primary["mic"], "on");
        assert_eq!(primary["cam"], "unknown");
        assert_eq!(primary["health"], serde_json::json!({"status": "ok"}));
        assert_eq!(primary["active_speaker"]["display_name"], "Alex Example");
    }
}
