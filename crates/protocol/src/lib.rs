//! Versioned messages exchanged over the Islet bridge (see `docs/adr/0002`).
//!
//! Every message is a JSON object tagged by `type` that carries `v: 1`. [`ExtensionMessage`]
//! flows from the browser extension to the app and [`AppMessage`] flows back. Always go through
//! [`ExtensionMessage::decode`], [`AppMessage::encode`] and friends: they add and check the version
//! and reject anything over [`MAX_MESSAGE_BYTES`].
//!
//! The TypeScript twins of these types are generated into `packages/protocol-ts` by `cargo test`.
//! Within `v: 1` the only allowed change is adding optional fields; anything else (new variants,
//! renamed or required fields) needs a new protocol version.

mod codec;
mod message;
mod version;

pub use codec::{MAX_MESSAGE_BYTES, ProtocolError};
pub use message::*;
pub use version::{PROTOCOL_VERSION, ProtocolVersion};
