use std::future::Future;
use std::pin::Pin;

use tokio::sync::mpsc;

use crate::manager::Input;
use crate::reducer::Event;
use crate::status::ProviderStatus;
use crate::{
    CapabilitySet, Command, CommandError, EndReason, ProviderId, SessionKey, SessionState,
};

/// The future returned by [`Provider::execute`].
pub type CommandFuture<'a> = Pin<Box<dyn Future<Output = Result<(), CommandError>> + Send + 'a>>;

/// A meeting app adapter, such as Google Meet. The core and the UI never know which provider is
/// behind a session; they only see what it reports and the commands it declares.
pub trait Provider: Send + Sync + 'static {
    fn id(&self) -> ProviderId;

    /// Every command this provider can perform. Session capabilities outside this set are
    /// dropped, so the UI never renders an undeclared control.
    fn capabilities(&self) -> CapabilitySet;

    /// Called once, when the provider is registered. From then on the provider reports its
    /// sessions through `sink`.
    fn subscribe(&self, sink: EventSink);

    /// Performs `command` on the provider's session `session_id`.
    ///
    /// Resolve with `Ok` only once the provider has observed the change. Do not report the new
    /// state optimistically: send it through the [`EventSink`] when it is confirmed. The
    /// manager gives up after the command timeout and reports [`CommandError::Timeout`].
    fn execute(&self, session_id: &str, command: Command) -> CommandFuture<'_>;
}

/// What a provider reports about one of its sessions.
// A full `SessionState` (photos included, ADR 0007) is about 240 bytes. Events are short-lived
// and go through a channel one at a time, so boxing it would only add an allocation.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionEvent {
    /// The full current state. Send it whenever something changes and, unchanged, as a
    /// heartbeat: a session without updates for the stale timeout is marked degraded.
    Updated {
        id: String,
        state: SessionState,
    },
    Ended {
        id: String,
        reason: EndReason,
    },
}

/// The provider's channel into the [`SessionManager`](crate::SessionManager).
///
/// It stamps every event with the provider's id, so a provider cannot report sessions of
/// another one.
#[derive(Debug, Clone)]
pub struct EventSink {
    provider: ProviderId,
    tx: mpsc::UnboundedSender<Input>,
}

/// The session manager has stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("the session manager has stopped")]
pub struct ManagerStopped;

impl EventSink {
    pub(crate) fn new(provider: ProviderId, tx: mpsc::UnboundedSender<Input>) -> Self {
        Self { provider, tx }
    }

    pub fn send(&self, event: SessionEvent) -> Result<(), ManagerStopped> {
        let event = match event {
            SessionEvent::Updated { id, state } => {
                Event::Updated(SessionKey::new(self.provider.clone(), id), state)
            }
            SessionEvent::Ended { id, reason } => {
                Event::Ended(SessionKey::new(self.provider.clone(), id), reason)
            }
        };
        self.tx
            .send(Input::Event(event))
            .map_err(|_| ManagerStopped)
    }

    /// Reports the provider's own state: whether its client (for Meet, the extension) is
    /// connected, and its version. Shown in the tray, the settings and the diagnostics.
    pub fn set_status(&self, status: ProviderStatus) -> Result<(), ManagerStopped> {
        self.tx
            .send(Input::Status(self.provider.clone(), status))
            .map_err(|_| ManagerStopped)
    }
}
