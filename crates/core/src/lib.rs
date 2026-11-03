//! The platform-agnostic heart of Islet: the meeting session model, the pure [`reduce`]r, the
//! [`Provider`] trait and the [`SessionManager`].
//!
//! Nothing here knows about Tauri, a UI or an operating system. Time is injected: [`reduce`]
//! takes `now` as an argument, and the manager runs on tokio's clock, which tests can pause.

mod command;
mod manager;
mod provider;
mod reducer;
mod session;

pub use command::{CapabilitySet, Command, CommandError};
pub use manager::{SessionHandle, SessionManager};
pub use provider::{CommandFuture, EventSink, ManagerStopped, Provider, SessionEvent};
pub use reducer::{Event, Sessions, Timings, UiSnapshot, reduce};
pub use session::{
    DegradedReason, EndReason, Field, Health, MeetingSession, ProviderId, SessionKey, SessionState,
    SessionStatus, Signals, Speaker, Toggle,
};
