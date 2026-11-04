use std::collections::BTreeMap;
use std::sync::Arc;

use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::{Instant, sleep_until, timeout};

use crate::reducer::{Event, Sessions, Timings, UiSnapshot, reduce};
use crate::status::{Diagnostics, ProviderDiagnostics, ProviderStatus, ProviderView, Settings};
use crate::{
    Command, CommandError, EventSink, Health, Provider, ProviderId, SessionKey, SessionStatus,
    Speaker,
};

/// What providers send the manager through their [`EventSink`].
// A full `SessionState` (photos included, ADR 0007) is about 240 bytes. Events are short-lived
// and go through a channel one at a time, so boxing it would only add an allocation.
#[allow(clippy::large_enum_variant)]
#[derive(Debug)]
pub(crate) enum Input {
    Event(Event),
    Status(ProviderId, ProviderStatus),
}

/// Collects sessions from every provider, elects the primary one and publishes a
/// [`UiSnapshot`] on a `watch` channel.
///
/// It uses tokio's clock, so tests can pause and advance time.
pub struct SessionManager {
    timings: Timings,
    settings: Settings,
    providers: BTreeMap<ProviderId, Arc<dyn Provider>>,
}

impl SessionManager {
    pub fn new(timings: Timings) -> Self {
        Self {
            timings,
            settings: Settings::default(),
            providers: BTreeMap::new(),
        }
    }

    /// The settings to start with; [`SessionHandle::set_settings`] changes them later.
    #[must_use]
    pub fn with_settings(mut self, settings: Settings) -> Self {
        self.settings = settings;
        self
    }

    /// Adds a provider. A provider with the same id replaces the previous one.
    #[must_use]
    pub fn with_provider(mut self, provider: Arc<dyn Provider>) -> Self {
        self.providers.insert(provider.id(), provider);
        self
    }

    /// Subscribes every provider and runs the manager on the current tokio runtime until every
    /// [`SessionHandle`] is dropped.
    pub fn spawn(self) -> SessionHandle {
        let (event_tx, events) = mpsc::unbounded_channel();
        let (request_tx, requests) = mpsc::unbounded_channel();
        let (snapshot_tx, snapshot) = watch::channel(UiSnapshot::default());

        for (id, provider) in &self.providers {
            provider.subscribe(EventSink::new(id.clone(), event_tx.clone()));
        }
        drop(event_tx);

        let actor = Actor {
            sessions: Sessions::new(self.timings),
            settings: self.settings,
            statuses: self
                .providers
                .keys()
                .map(|id| (id.clone(), Tracked::default()))
                .collect(),
            providers: self.providers,
            snapshot: snapshot_tx,
        };
        tokio::spawn(actor.run(events, requests));

        SessionHandle {
            requests: request_tx,
            snapshot,
        }
    }
}

/// The UI's and the shell's view of the [`SessionManager`].
#[derive(Debug, Clone)]
pub struct SessionHandle {
    requests: mpsc::UnboundedSender<Request>,
    snapshot: watch::Receiver<UiSnapshot>,
}

impl SessionHandle {
    pub fn snapshot(&self) -> watch::Receiver<UiSnapshot> {
        self.snapshot.clone()
    }

    /// Sends `command` to the session's provider and waits for its confirmation, at most the
    /// command timeout. The snapshot changes only when the provider reports the new state.
    pub async fn execute(&self, key: SessionKey, command: Command) -> Result<(), CommandError> {
        let (reply, result) = oneshot::channel();
        self.requests
            .send(Request::Execute {
                key,
                command,
                reply,
            })
            .map_err(|_| CommandError::Disconnected)?;
        result.await.unwrap_or(Err(CommandError::Disconnected))
    }

    /// Applies new settings and republishes the snapshot with them.
    pub fn set_settings(&self, settings: Settings) {
        let _ = self.requests.send(Request::SetSettings(settings));
    }

    /// The current diagnostics, or `None` once the manager has stopped.
    pub async fn diagnostics(&self) -> Option<Diagnostics> {
        let (reply, result) = oneshot::channel();
        self.requests.send(Request::Diagnostics(reply)).ok()?;
        result.await.ok()
    }
}

#[derive(Debug)]
enum Request {
    Execute {
        key: SessionKey,
        command: Command,
        reply: oneshot::Sender<Result<(), CommandError>>,
    },
    SetSettings(Settings),
    Diagnostics(oneshot::Sender<Diagnostics>),
}

/// What the manager remembers about a provider beyond its sessions.
#[derive(Debug, Default)]
struct Tracked {
    status: ProviderStatus,
    last_health: Option<Health>,
    last_update: Option<Instant>,
    last_degraded: Option<(Health, Instant)>,
}

struct Actor {
    sessions: Sessions,
    settings: Settings,
    statuses: BTreeMap<ProviderId, Tracked>,
    providers: BTreeMap<ProviderId, Arc<dyn Provider>>,
    snapshot: watch::Sender<UiSnapshot>,
}

impl Actor {
    async fn run(
        mut self,
        mut events: mpsc::UnboundedReceiver<Input>,
        mut requests: mpsc::UnboundedReceiver<Request>,
    ) {
        self.publish();
        loop {
            let deadline = self.sessions.next_deadline();
            let tick = async {
                match deadline {
                    Some(deadline) => sleep_until(deadline).await,
                    None => std::future::pending().await,
                }
            };
            let event = tokio::select! {
                Some(input) = events.recv() => match input {
                    Input::Event(event) => event,
                    Input::Status(provider, status) => {
                        self.statuses.entry(provider).or_default().status = status;
                        self.publish();
                        continue;
                    }
                },
                request = requests.recv() => match request {
                    Some(request) => {
                        self.handle(request);
                        continue;
                    }
                    None => break,
                },
                () = tick => Event::Tick,
            };
            self.apply(event);
        }
    }

    fn apply(&mut self, event: Event) {
        let now = Instant::now();
        let event = match event {
            Event::Updated(key, mut state) => {
                let declared = self
                    .providers
                    .get(&key.provider)
                    .map_or(crate::CapabilitySet::EMPTY, |p| p.capabilities());
                state.capabilities = state.capabilities.intersection(declared);
                let tracked = self.statuses.entry(key.provider.clone()).or_default();
                tracked.last_health = Some(state.health.clone());
                tracked.last_update = Some(now);
                if !state.health.is_ok() {
                    tracked.last_degraded = Some((state.health.clone(), now));
                }
                Event::Updated(key, state)
            }
            other => other,
        };
        let sessions = std::mem::take(&mut self.sessions);
        self.sessions = reduce(sessions, event, now);
        self.publish();
    }

    /// Publishes the snapshot if it changed, with the settings applied.
    fn publish(&self) {
        let mut primary = self.sessions.primary();
        if !self.settings.show_participant_names
            && let Some(session) = &mut primary
        {
            session.state.title = None;
            if session.state.active_speaker.is_some() {
                session.state.active_speaker = Some(Speaker::anonymous());
            }
            if session.state.self_participant.is_some() {
                session.state.self_participant = Some(Speaker::anonymous());
            }
            for participant in &mut session.state.participants {
                *participant = Speaker::anonymous();
            }
        }
        let providers = self
            .statuses
            .iter()
            .map(|(id, tracked)| ProviderView {
                id: id.clone(),
                connected: tracked.status.connected,
                client_version: tracked.status.client_version.clone(),
                last_health: tracked.last_health.clone(),
            })
            .collect();
        let next = UiSnapshot { primary, providers };
        self.snapshot.send_if_modified(|current| {
            let changed = *current != next;
            if changed {
                *current = next;
            }
            changed
        });
    }

    fn diagnostics(&self) -> Diagnostics {
        let now = Instant::now();
        let secs = |at: Instant| now.saturating_duration_since(at).as_secs();
        Diagnostics {
            providers: self
                .statuses
                .iter()
                .map(|(id, tracked)| ProviderDiagnostics {
                    provider: id.clone(),
                    connected: tracked.status.connected,
                    client_version: tracked.status.client_version.clone(),
                    sessions: self.sessions.count_for(id),
                    health: tracked.last_health.clone(),
                    last_degraded: tracked.last_degraded.as_ref().map(|(h, _)| h.clone()),
                    last_degraded_secs_ago: tracked.last_degraded.as_ref().map(|(_, at)| secs(*at)),
                    last_update_secs_ago: tracked.last_update.map(secs),
                })
                .collect(),
        }
    }

    fn handle(&mut self, request: Request) {
        let (key, command, reply) = match request {
            Request::Execute {
                key,
                command,
                reply,
            } => (key, command, reply),
            Request::SetSettings(settings) => {
                self.settings = settings;
                self.publish();
                return;
            }
            Request::Diagnostics(reply) => {
                let _ = reply.send(self.diagnostics());
                return;
            }
        };
        let provider = match self.check(&key, command) {
            Ok(provider) => provider,
            Err(error) => {
                let _ = reply.send(Err(error));
                return;
            }
        };
        let limit = self.sessions.timings().command_timeout;
        tokio::spawn(async move {
            let result = timeout(limit, provider.execute(&key.id, command))
                .await
                .unwrap_or(Err(CommandError::Timeout));
            let _ = reply.send(result);
        });
    }

    fn check(&self, key: &SessionKey, command: Command) -> Result<Arc<dyn Provider>, CommandError> {
        let session = self.sessions.get(key).ok_or(CommandError::NoSession)?;
        if session.status != SessionStatus::Active {
            return Err(CommandError::SessionEnded);
        }
        if !session.state.capabilities.contains(command) {
            return Err(CommandError::Unsupported);
        }
        self.providers
            .get(&key.provider)
            .cloned()
            .ok_or(CommandError::NoSession)
    }
}
