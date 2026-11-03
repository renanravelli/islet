//! Google Meet provider. It never touches a socket: the shell feeds it [`BridgeEvent`]s from the
//! bridge server and forwards the [`AppMessage`]s it queues, so the provider builds and tests on
//! every platform (`docs/adr/0002`).
//!
//! Sessions are keyed `<connection>:<tab id>`: each native host (one per Chrome profile) is a
//! connection, and tab ids are only unique within one browser.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};

use islet_core::{
    CapabilitySet, Command, CommandError, CommandFuture, DegradedReason, EndReason, EventSink,
    Field, Health, Provider, ProviderDetail, ProviderId, SessionEvent, SessionState, Signals,
    Speaker, Toggle,
};
use islet_protocol as wire;
use islet_protocol::{AppMessage, ExtensionMessage};
use tokio::sync::{mpsc, oneshot};

pub const MEET: ProviderId = ProviderId::from_static("meet");

/// Identifies one native host connection, chosen by the shell.
pub type ConnectionId = u64;

/// What the shell's bridge server tells the provider.
#[derive(Debug)]
pub enum BridgeEvent {
    /// A native host connected. Messages for it go to `outbox`.
    Connected {
        connection: ConnectionId,
        outbox: mpsc::UnboundedSender<AppMessage>,
    },
    Message {
        connection: ConnectionId,
        message: ExtensionMessage,
    },
    Disconnected {
        connection: ConnectionId,
    },
}

/// See the [crate docs](crate).
pub struct MeetProvider {
    shared: Arc<Mutex<Shared>>,
    inbox: Mutex<Option<mpsc::UnboundedReceiver<BridgeEvent>>>,
}

#[derive(Default)]
struct Shared {
    connections: HashMap<ConnectionId, Connection>,
    pending: HashMap<u32, Pending>,
    next_command: u32,
}

struct Connection {
    outbox: mpsc::UnboundedSender<AppMessage>,
    /// From the extension's `hello`; for diagnostics.
    extension_version: Option<String>,
    /// Tabs with a session, so they can be ended if the connection drops.
    tabs: HashSet<u32>,
}

struct Pending {
    connection: ConnectionId,
    reply: oneshot::Sender<Result<(), CommandError>>,
}

impl MeetProvider {
    /// The provider and the sender the shell feeds bridge events into.
    pub fn new() -> (Self, mpsc::UnboundedSender<BridgeEvent>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let provider = Self {
            shared: Arc::default(),
            inbox: Mutex::new(Some(rx)),
        };
        (provider, tx)
    }

    /// The version the extension reported on `connection`, if it said hello.
    pub fn extension_version(&self, connection: ConnectionId) -> Option<String> {
        lock(&self.shared)
            .connections
            .get(&connection)
            .and_then(|c| c.extension_version.clone())
    }
}

impl Provider for MeetProvider {
    fn id(&self) -> ProviderId {
        MEET
    }

    fn capabilities(&self) -> CapabilitySet {
        CapabilitySet::all()
    }

    /// Starts consuming bridge events on the current tokio runtime. Only the first call has an
    /// effect.
    fn subscribe(&self, sink: EventSink) {
        let inbox = self.inbox.lock().map(|mut inbox| inbox.take());
        if let Ok(Some(mut inbox)) = inbox {
            let shared = self.shared.clone();
            tokio::spawn(async move {
                while let Some(event) = inbox.recv().await {
                    if handle(&shared, &sink, event).is_err() {
                        return;
                    }
                }
            });
        }
    }

    fn execute(&self, session_id: &str, command: Command) -> CommandFuture<'_> {
        let queued = self.queue(session_id, command);
        Box::pin(async move {
            let (id, reply) = queued?;
            let guard = PendingGuard {
                shared: &self.shared,
                id,
            };
            let result = reply.await.unwrap_or(Err(CommandError::Disconnected));
            drop(guard);
            result
        })
    }
}

impl MeetProvider {
    fn queue(
        &self,
        session_id: &str,
        command: Command,
    ) -> Result<(u32, oneshot::Receiver<Result<(), CommandError>>), CommandError> {
        let (connection, tab_id) = parse_session_id(session_id).ok_or(CommandError::NoSession)?;
        let mut shared = lock(&self.shared);
        let outbox = shared
            .connections
            .get(&connection)
            .map(|c| c.outbox.clone())
            .ok_or(CommandError::Disconnected)?;
        let id = shared.next_command;
        shared.next_command = shared.next_command.wrapping_add(1);
        let (reply, result) = oneshot::channel();
        shared.pending.insert(id, Pending { connection, reply });
        let message = AppMessage::Command(wire::Command {
            id,
            tab_id,
            action: action(command),
        });
        if outbox.send(message).is_err() {
            shared.pending.remove(&id);
            return Err(CommandError::Disconnected);
        }
        Ok((id, result))
    }
}

/// Forgets a pending command when its caller stops waiting (for example on the core's timeout).
struct PendingGuard<'a> {
    shared: &'a Mutex<Shared>,
    id: u32,
}

impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        lock(self.shared).pending.remove(&self.id);
    }
}

fn handle(
    shared: &Mutex<Shared>,
    sink: &EventSink,
    event: BridgeEvent,
) -> Result<(), islet_core::ManagerStopped> {
    match event {
        BridgeEvent::Connected { connection, outbox } => {
            // Ask the extension to re-send every tab's state now instead of at the next heartbeat.
            let _ = outbox.send(AppMessage::Ping);
            lock(shared).connections.insert(
                connection,
                Connection {
                    outbox,
                    extension_version: None,
                    tabs: HashSet::new(),
                },
            );
        }
        BridgeEvent::Disconnected { connection } => {
            let (tabs, replies) = {
                let mut shared = lock(shared);
                let tabs = shared
                    .connections
                    .remove(&connection)
                    .map(|c| c.tabs)
                    .unwrap_or_default();
                let ids: Vec<u32> = shared
                    .pending
                    .iter()
                    .filter(|(_, p)| p.connection == connection)
                    .map(|(id, _)| *id)
                    .collect();
                let replies: Vec<_> = ids
                    .into_iter()
                    .filter_map(|id| shared.pending.remove(&id))
                    .collect();
                (tabs, replies)
            };
            for pending in replies {
                let _ = pending.reply.send(Err(CommandError::Disconnected));
            }
            for tab in tabs {
                sink.send(SessionEvent::Ended {
                    id: session_id(connection, tab),
                    reason: EndReason::Disconnected,
                })?;
            }
        }
        BridgeEvent::Message {
            connection,
            message,
        } => return handle_message(shared, sink, connection, message),
    }
    Ok(())
}

fn handle_message(
    shared: &Mutex<Shared>,
    sink: &EventSink,
    connection: ConnectionId,
    message: ExtensionMessage,
) -> Result<(), islet_core::ManagerStopped> {
    match message {
        ExtensionMessage::Hello(hello) => {
            if let Some(c) = lock(shared).connections.get_mut(&connection) {
                c.extension_version = Some(hello.extension_version);
            }
        }
        ExtensionMessage::SessionUpdate(update) => {
            if let Some(c) = lock(shared).connections.get_mut(&connection) {
                c.tabs.insert(update.tab_id);
            }
            sink.send(SessionEvent::Updated {
                id: session_id(connection, update.tab_id),
                state: session_state(update),
            })?;
        }
        ExtensionMessage::SessionEnded(ended) => {
            if let Some(c) = lock(shared).connections.get_mut(&connection) {
                c.tabs.remove(&ended.tab_id);
            }
            sink.send(SessionEvent::Ended {
                id: session_id(connection, ended.tab_id),
                reason: match ended.reason {
                    wire::EndReason::CallEnded => EndReason::CallEnded,
                    wire::EndReason::TabClosed | wire::EndReason::Navigated => EndReason::Closed,
                },
            })?;
        }
        ExtensionMessage::CommandResult(result) => {
            let mut shared = lock(shared);
            // Only the connection the command went to may answer it.
            if shared
                .pending
                .get(&result.id)
                .is_some_and(|p| p.connection == connection)
                && let Some(pending) = shared.pending.remove(&result.id)
            {
                let _ = pending.reply.send(command_result(result));
            }
        }
        ExtensionMessage::Pong => {}
    }
    Ok(())
}

fn session_id(connection: ConnectionId, tab_id: u32) -> String {
    format!("{connection}:{tab_id}")
}

fn parse_session_id(id: &str) -> Option<(ConnectionId, u32)> {
    let (connection, tab) = id.split_once(':')?;
    Some((connection.parse().ok()?, tab.parse().ok()?))
}

fn session_state(update: wire::SessionUpdate) -> SessionState {
    let health = match update.health {
        wire::Health::Ok => Health::Ok,
        wire::Health::Degraded => {
            let keys = update.degraded_reasons.unwrap_or_default();
            Health::degraded(keys.iter().map(|key| degraded_reason(*key))).with_details(
                keys.iter()
                    .filter_map(|key| ProviderDetail::new(selector_key(*key))),
            )
        }
    };
    SessionState {
        title: update.title,
        started_at: update.started_at,
        mic: toggle(update.self_state.mic),
        cam: toggle(update.self_state.cam),
        hand: toggle(update.self_state.hand),
        active_speaker: update
            .active_speaker
            .map(|speaker| Speaker::new(speaker.display_name)),
        participant_count: update.participant_count,
        signals: Signals {
            speaking_while_muted: update.signals.speaking_while_muted == Some(true),
        },
        capabilities: update.capabilities.into_iter().map(command).collect(),
        health,
    }
}

fn toggle(toggle: wire::Toggle) -> Toggle {
    match toggle {
        wire::Toggle::On => Toggle::On,
        wire::Toggle::Off => Toggle::Off,
        wire::Toggle::Unknown => Toggle::Unknown,
    }
}

fn command(action: wire::Action) -> Command {
    match action {
        wire::Action::ToggleMic => Command::ToggleMic,
        wire::Action::ToggleCam => Command::ToggleCam,
        wire::Action::ToggleHand => Command::ToggleHand,
        wire::Action::Leave => Command::Leave,
        wire::Action::FocusTab => Command::FocusTab,
    }
}

fn action(command: Command) -> wire::Action {
    match command {
        Command::ToggleMic => wire::Action::ToggleMic,
        Command::ToggleCam => wire::Action::ToggleCam,
        Command::ToggleHand => wire::Action::ToggleHand,
        Command::Leave => wire::Action::Leave,
        Command::FocusTab => wire::Action::FocusTab,
    }
}

fn degraded_reason(key: wire::DegradedReason) -> DegradedReason {
    use wire::DegradedReason as Key;
    match key {
        Key::LeaveButton => DegradedReason::ControlMissing(Command::Leave),
        Key::MicButton => DegradedReason::Unreadable(Field::Mic),
        Key::CamButton => DegradedReason::Unreadable(Field::Cam),
        Key::HandButton => DegradedReason::Unreadable(Field::Hand),
        Key::ActiveSpeaker => DegradedReason::Unreadable(Field::ActiveSpeaker),
        Key::ParticipantCount => DegradedReason::Unreadable(Field::ParticipantCount),
        Key::MutedSpeakingNotice => DegradedReason::Unreadable(Field::SpeakingWhileMuted),
        Key::MeetingTitle => DegradedReason::Unreadable(Field::Title),
    }
}

/// The key as written in `extension/src/content/meet/selectors.json`.
fn selector_key(key: wire::DegradedReason) -> &'static str {
    use wire::DegradedReason as Key;
    match key {
        Key::LeaveButton => "leaveButton",
        Key::MicButton => "micButton",
        Key::CamButton => "camButton",
        Key::HandButton => "handButton",
        Key::ActiveSpeaker => "activeSpeaker",
        Key::ParticipantCount => "participantCount",
        Key::MutedSpeakingNotice => "mutedSpeakingNotice",
        Key::MeetingTitle => "meetingTitle",
    }
}

fn command_result(result: wire::CommandResult) -> Result<(), CommandError> {
    if result.ok {
        return Ok(());
    }
    Err(match result.error {
        Some(wire::CommandErrorCode::TabNotFound) => CommandError::NoSession,
        Some(wire::CommandErrorCode::ControlNotFound) => CommandError::ControlNotFound,
        Some(wire::CommandErrorCode::Unsupported) => CommandError::Unsupported,
        Some(wire::CommandErrorCode::NotConfirmed) | None => CommandError::NotConfirmed,
    })
}

fn lock(shared: &Mutex<Shared>) -> MutexGuard<'_, Shared> {
    // A panic while holding the lock leaves plain data behind; keep going with it.
    shared
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
