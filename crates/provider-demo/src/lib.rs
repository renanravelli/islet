//! A scripted [`Provider`] with fictional data, for demo mode (`--demo`), the onboarding preview
//! and tests.
//!
//! [`Script::tour`] walks through every state the island can show. Commands work like a real
//! provider: the change is reported only after a short "confirmation" delay.

use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use islet_core::{
    CapabilitySet, Command, CommandError, CommandFuture, DegradedReason, EndReason, EventSink,
    Field, Health, Provider, ProviderDetail, ProviderId, RaisedHands, SessionEvent, SessionState,
    Signals, Speaker, Toggle,
};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::{Instant, sleep, sleep_until};

pub const DEMO: ProviderId = ProviderId::from_static("demo");

/// The demo re-sends its state at this interval, like the Meet adapter's heartbeat.
pub const HEARTBEAT: Duration = Duration::from_secs(5);

/// How long the demo takes to "confirm" a command.
pub const CONFIRM_DELAY: Duration = Duration::from_millis(300);

/// One change to the demo session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    /// Start a new session with the mic on and the camera and hand off.
    Join {
        title: &'static str,
        participants: u32,
    },
    Speaker(Option<&'static str>),
    Participants(u32),
    Mic(Toggle),
    Cam(Toggle),
    Hand(Toggle),
    /// Others' raised hands: the first in line and how many, or nobody.
    RaisedHands(Option<(&'static str, u32)>),
    SpeakingWhileMuted(bool),
    Health(Health),
    End(EndReason),
    /// No change. Use it to wait, for example at the end of a script.
    Pause,
}

/// A change applied `after` the previous step.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Step {
    pub after: Duration,
    pub change: Change,
}

impl Step {
    pub fn new(after: Duration, change: Change) -> Self {
        Self { after, change }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Script {
    pub steps: Vec<Step>,
    /// Start over after the last step.
    pub repeat: bool,
}

impl Script {
    /// About a minute through every island state: compact, mic off, the speaking-while-muted
    /// alert, raised hands (the user's and others'), an `Unknown` mic, degraded, ended and idle.
    /// Then it starts over.
    pub fn tour() -> Self {
        let s = Duration::from_secs;
        let steps = vec![
            Step::new(
                s(1),
                Change::Join {
                    title: "Weekly design review",
                    participants: 6,
                },
            ),
            Step::new(s(0), Change::Speaker(Some("Alex Rivera"))),
            Step::new(s(4), Change::Speaker(Some("Sam Taylor"))),
            Step::new(s(4), Change::Mic(Toggle::Off)),
            Step::new(s(3), Change::SpeakingWhileMuted(true)),
            Step::new(s(5), Change::SpeakingWhileMuted(false)),
            Step::new(s(1), Change::Hand(Toggle::On)),
            Step::new(s(4), Change::Hand(Toggle::Off)),
            Step::new(s(1), Change::RaisedHands(Some(("Sam Taylor", 1)))),
            Step::new(s(6), Change::RaisedHands(Some(("Sam Taylor", 2)))),
            Step::new(s(4), Change::RaisedHands(Some(("Alex Rivera", 1)))),
            Step::new(s(6), Change::RaisedHands(None)),
            Step::new(s(1), Change::Speaker(None)),
            Step::new(s(3), Change::Mic(Toggle::Unknown)),
            Step::new(
                s(3),
                Change::Health(
                    Health::degraded([DegradedReason::Unreadable(Field::ActiveSpeaker)])
                        .with_details(ProviderDetail::new("demoSpeakerTile")),
                ),
            ),
            Step::new(s(4), Change::Health(Health::Ok)),
            Step::new(s(0), Change::Mic(Toggle::Off)),
            Step::new(s(0), Change::Speaker(Some("Alex Rivera"))),
            Step::new(s(4), Change::End(EndReason::CallEnded)),
            // The ended state lasts 5 s in the core, then the island is idle for a moment.
            Step::new(s(8), Change::Pause),
        ];
        Self {
            steps,
            repeat: true,
        }
    }
}

/// See the [crate docs](crate).
pub struct DemoProvider {
    script: Script,
    requests: mpsc::UnboundedSender<Request>,
    inbox: Mutex<Option<mpsc::UnboundedReceiver<Request>>>,
    switch: DemoSwitch,
}

/// Turns a [`DemoProvider`] on and off while it runs: the tray's "Modo demo".
#[derive(Debug, Clone)]
pub struct DemoSwitch(Arc<watch::Sender<bool>>);

impl DemoSwitch {
    /// Off ends the demo session and stops the script; on starts the script from the top.
    pub fn set(&self, on: bool) {
        self.0.send_replace(on);
    }

    pub fn is_on(&self) -> bool {
        *self.0.borrow()
    }
}

struct Request {
    session_id: String,
    command: Command,
    reply: oneshot::Sender<Result<(), CommandError>>,
}

impl DemoProvider {
    /// A demo that plays from the start.
    pub fn new(script: Script) -> Self {
        Self::switchable(script, true).0
    }

    /// A demo that plays only while its switch is on.
    pub fn switchable(script: Script, on: bool) -> (Self, DemoSwitch) {
        let (requests, inbox) = mpsc::unbounded_channel();
        let switch = DemoSwitch(Arc::new(watch::channel(on).0));
        let provider = Self {
            script,
            requests,
            inbox: Mutex::new(Some(inbox)),
            switch: switch.clone(),
        };
        (provider, switch)
    }
}

impl Provider for DemoProvider {
    fn id(&self) -> ProviderId {
        DEMO
    }

    fn capabilities(&self) -> CapabilitySet {
        CapabilitySet::all()
    }

    /// Starts the script on the current tokio runtime. Only the first call has an effect.
    fn subscribe(&self, sink: EventSink) {
        let inbox = self.inbox.lock().map(|mut inbox| inbox.take());
        if let Ok(Some(inbox)) = inbox {
            let player = Player {
                sink,
                inbox,
                on: self.switch.0.subscribe(),
                session: None,
                cycle: 0,
                last_sent: Instant::now(),
            };
            tokio::spawn(player.run(self.script.clone()));
        }
    }

    fn execute(&self, session_id: &str, command: Command) -> CommandFuture<'_> {
        let (reply, result) = oneshot::channel();
        let sent = self.requests.send(Request {
            session_id: session_id.to_owned(),
            command,
            reply,
        });
        Box::pin(async move {
            sent.map_err(|_| CommandError::Disconnected)?;
            result.await.unwrap_or(Err(CommandError::Disconnected))
        })
    }
}

struct Player {
    sink: EventSink,
    inbox: mpsc::UnboundedReceiver<Request>,
    on: watch::Receiver<bool>,
    session: Option<(String, SessionState)>,
    cycle: u32,
    last_sent: Instant,
}

impl Player {
    async fn run(mut self, script: Script) {
        loop {
            // Off: answer nothing but commands, which find no session.
            while !*self.on.borrow_and_update() {
                tokio::select! {
                    changed = self.on.changed() => if changed.is_err() { return },
                    Some(request) = self.inbox.recv() => {
                        let _ = request.reply.send(Err(CommandError::NoSession));
                    }
                }
            }
            match self.play(&script).await {
                Wait::Elapsed => {}
                Wait::Stopped => return,
                Wait::Off => {
                    if let Some((id, _)) = self.session.take() {
                        let _ = self.sink.send(SessionEvent::Ended {
                            id,
                            reason: EndReason::Closed,
                        });
                    }
                }
            }
        }
    }

    /// Plays the script until it ends (forever if it repeats) or the switch turns off.
    async fn play(&mut self, script: &Script) -> Wait {
        loop {
            for step in &script.steps {
                let outcome = self.wait(step.after).await;
                if outcome != Wait::Elapsed {
                    return outcome;
                }
                self.apply(step.change.clone());
            }
            if !script.repeat {
                // Keep answering commands and sending heartbeats.
                loop {
                    let outcome = self.wait(Duration::from_secs(3600)).await;
                    if outcome != Wait::Elapsed {
                        return outcome;
                    }
                }
            }
        }
    }

    /// Waits `duration` while answering commands and sending heartbeats.
    async fn wait(&mut self, duration: Duration) -> Wait {
        let deadline = Instant::now() + duration;
        loop {
            let heartbeat = self.last_sent + HEARTBEAT;
            tokio::select! {
                () = sleep_until(deadline) => return Wait::Elapsed,
                changed = self.on.changed() => {
                    if changed.is_err() {
                        return Wait::Stopped;
                    }
                    if !*self.on.borrow_and_update() {
                        return Wait::Off;
                    }
                }
                () = sleep_until(heartbeat), if self.session.is_some() => {
                    if !self.send_update() {
                        return Wait::Stopped;
                    }
                }
                Some(request) = self.inbox.recv() => {
                    let result = self.handle(&request).await;
                    let _ = request.reply.send(result);
                }
            }
        }
    }

    async fn handle(&mut self, request: &Request) -> Result<(), CommandError> {
        match &self.session {
            Some((id, _)) if *id == request.session_id => {}
            _ => return Err(CommandError::NoSession),
        }
        sleep(CONFIRM_DELAY).await;
        let change = match request.command {
            Command::ToggleMic => Change::Mic(flip(self.current(|s| s.mic))),
            Command::ToggleCam => Change::Cam(flip(self.current(|s| s.cam))),
            Command::ToggleHand => Change::Hand(flip(self.current(|s| s.hand))),
            Command::Leave => Change::End(EndReason::CallEnded),
            Command::FocusTab => return Ok(()),
        };
        self.apply(change);
        Ok(())
    }

    fn current(&self, read: impl Fn(&SessionState) -> Toggle) -> Toggle {
        self.session
            .as_ref()
            .map_or(Toggle::Unknown, |(_, state)| read(state))
    }

    fn apply(&mut self, change: Change) {
        if let Change::Join {
            title,
            participants,
        } = change
        {
            self.cycle += 1;
            let state = SessionState {
                title: Some(title.to_owned()),
                started_at: unix_millis(),
                mic: Toggle::On,
                cam: Toggle::Off,
                hand: Toggle::Off,
                active_speaker: None,
                participant_count: Some(participants),
                participants: ["Alex Rivera", "Sam Taylor", "Jordan Kim"]
                    .into_iter()
                    .map(Speaker::new)
                    .collect(),
                self_participant: Some(Speaker::new("Jordan Kim")),
                raised_hands: None,
                signals: Signals::default(),
                capabilities: CapabilitySet::all(),
                health: Health::Ok,
            };
            self.session = Some((format!("demo-{}", self.cycle), state));
            self.send_update();
            return;
        }

        let Some((id, state)) = &mut self.session else {
            return;
        };
        match change {
            Change::Join { .. } => unreachable!("handled above"),
            Change::Pause => return,
            Change::Speaker(name) => state.active_speaker = name.map(Speaker::new),
            Change::Participants(count) => state.participant_count = Some(count),
            Change::Mic(mic) => {
                state.mic = mic;
                if mic != Toggle::Off {
                    state.signals.speaking_while_muted = false;
                }
            }
            Change::Cam(cam) => state.cam = cam,
            Change::Hand(hand) => state.hand = hand,
            Change::RaisedHands(hands) => {
                let since = match (&state.raised_hands, hands) {
                    (Some(current), Some((first, _)))
                        if current.first.display_name.as_deref() == Some(first) =>
                    {
                        current.since
                    }
                    _ => unix_millis(),
                };
                state.raised_hands = hands.map(|(first, count)| RaisedHands {
                    first: Speaker::new(first),
                    count,
                    since,
                });
            }
            Change::SpeakingWhileMuted(on) => state.signals.speaking_while_muted = on,
            Change::Health(health) => state.health = health,
            Change::End(reason) => {
                let id = id.clone();
                self.session = None;
                let _ = self.sink.send(SessionEvent::Ended { id, reason });
                return;
            }
        }
        self.send_update();
    }

    fn send_update(&mut self) -> bool {
        self.last_sent = Instant::now();
        let Some((id, state)) = &self.session else {
            return true;
        };
        self.sink
            .send(SessionEvent::Updated {
                id: id.clone(),
                state: state.clone(),
            })
            .is_ok()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Wait {
    Elapsed,
    /// The switch turned off.
    Off,
    /// The manager has stopped.
    Stopped,
}

fn flip(toggle: Toggle) -> Toggle {
    match toggle {
        Toggle::On => Toggle::Off,
        Toggle::Off | Toggle::Unknown => Toggle::On,
    }
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}
