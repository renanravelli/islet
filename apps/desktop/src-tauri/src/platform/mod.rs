//! OS-specific code. Each platform module offers the same functions; only macOS is implemented
//! in v0.1, the others are stubs so the crate builds everywhere.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(not(target_os = "macos"))]
mod other;
#[cfg(not(target_os = "macos"))]
pub use other::*;
