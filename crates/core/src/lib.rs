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
mod status;

pub use command::{CapabilitySet, Command, CommandError};
pub use manager::{SessionHandle, SessionManager};
pub use provider::{CommandFuture, EventSink, ManagerStopped, Provider, SessionEvent};
pub use reducer::{Event, Sessions, Timings, UiSnapshot, reduce};
pub use session::{
    DegradedReason, EndReason, Field, Health, MAX_AVATAR_BYTES, MAX_PARTICIPANTS, MeetingSession,
    ProviderDetail, ProviderId, RaisedHands, SessionKey, SessionState, SessionStatus, Signals,
    Speaker, Toggle,
};
pub use status::{Diagnostics, ProviderDiagnostics, ProviderStatus, ProviderView, Settings};
