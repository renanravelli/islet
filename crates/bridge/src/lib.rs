//! The transport between `islet-native-host` and the app (`docs/adr/0002`).
//!
//! - [`frame`]: Chrome's framing (a 32-bit native-endian length, then UTF-8 JSON), also used on
//!   the local socket.
//! - [`path`]: where the socket lives.
//! - [`origin`]: the extension IDs allowed to use the host.
//! - [`manifest`]: installing and repairing the host manifest Chrome reads.
//! - The socket itself ([`BridgeServer`] for the app, [`connect`] for the host), Unix only.

pub mod frame;
pub mod manifest;
pub mod origin;
pub mod path;
#[cfg(unix)]
mod socket;

#[cfg(unix)]
pub use socket::{BridgeError, BridgeServer, Connection, MessageReader, MessageWriter, connect};

/// The app's bundle ID, which is also the Native Messaging host name.
pub const BUNDLE_ID: &str = "io.github.renanravelli.islet";

/// The Native Messaging host name Chrome looks up.
pub const HOST_NAME: &str = BUNDLE_ID;
