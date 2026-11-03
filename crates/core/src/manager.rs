use std::collections::BTreeMap;
use std::sync::Arc;

use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::{Instant, sleep_until, timeout};

use crate::reducer::{Event, Sessions, Timings, UiSnapshot, reduce};
use crate::{Command, CommandError, EventSink, Provider, ProviderId, SessionKey, SessionStatus};

/// Collects sessions from every provider, elects the primary one and publishes a
/// [`UiSnapshot`] on a `watch` channel.
///
/// It uses tokio's clock, so tests can pause and advance time.
pub struct SessionManager {
    timings: Timings,
    providers: BTreeMap<ProviderId, Arc<dyn Provider>>,
}

impl SessionManager {
    pub fn new(timings: Timings) -> Self {
        Self {
            timings,
            providers: BTreeMap::new(),
        }
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
}

#[derive(Debug)]
enum Request {
    Execute {
        key: SessionKey,
        command: Command,
        reply: oneshot::Sender<Result<(), CommandError>>,
    },
}

struct Actor {
    sessions: Sessions,
    providers: BTreeMap<ProviderId, Arc<dyn Provider>>,
    snapshot: watch::Sender<UiSnapshot>,
}

impl Actor {
    async fn run(
        mut self,
        mut events: mpsc::UnboundedReceiver<Event>,
        mut requests: mpsc::UnboundedReceiver<Request>,
    ) {
        loop {
            let deadline = self.sessions.next_deadline();
            let tick = async {
                match deadline {
                    Some(deadline) => sleep_until(deadline).await,
                    None => std::future::pending().await,
                }
            };
            let event = tokio::select! {
                Some(event) = events.recv() => event,
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
        let event = match event {
            Event::Updated(key, mut state) => {
                let declared = self
                    .providers
                    .get(&key.provider)
                    .map_or(crate::CapabilitySet::EMPTY, |p| p.capabilities());
                state.capabilities = state.capabilities.intersection(declared);
                Event::Updated(key, state)
            }
            other => other,
        };
        let sessions = std::mem::take(&mut self.sessions);
        self.sessions = reduce(sessions, event, Instant::now());
        let next = self.sessions.snapshot();
        self.snapshot.send_if_modified(|current| {
            let changed = *current != next;
            if changed {
                *current = next;
            }
            changed
        });
    }

    fn handle(&self, request: Request) {
        let Request::Execute {
            key,
            command,
            reply,
        } = request;
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
