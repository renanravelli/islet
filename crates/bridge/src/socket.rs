//! The local socket between the native host and the app (Unix).
//!
//! Security (`docs/adr/0002`): the socket's directory is `0700`, the socket gets `0600` right
//! after `bind`, and both sides check that the peer runs as the same user.

use std::fs::{self, DirBuilder, Permissions};
use std::io;
use std::os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};

use islet_protocol::{AppMessage, ExtensionMessage};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{UnixListener, UnixStream};

use crate::frame::{Frame, read_frame, write_frame};

#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
    #[error("another app instance is already serving the bridge socket")]
    AlreadyRunning,
    #[error("the bridge socket path is taken by something that is not a socket")]
    NotASocket,
    #[error("the bridge socket directory belongs to another user")]
    ForeignDirectory,
    #[error("the bridge socket path has no parent directory")]
    NoParent,
    #[error(transparent)]
    Io(#[from] io::Error),
}

/// The app's end of the bridge: accepts connections from native hosts run by the same user.
#[derive(Debug)]
pub struct BridgeServer {
    listener: UnixListener,
    path: PathBuf,
    uid: u32,
}

impl BridgeServer {
    /// Binds the socket at `path`. A socket left behind by a crashed app is replaced; a live one
    /// means another instance is running.
    pub async fn bind(path: &Path) -> Result<Self, BridgeError> {
        let uid = own_uid()?;
        let dir = path.parent().ok_or(BridgeError::NoParent)?;
        private_dir(dir, uid)?;

        match fs::symlink_metadata(path) {
            Ok(meta) if meta.file_type().is_socket() => match UnixStream::connect(path).await {
                Ok(_) => return Err(BridgeError::AlreadyRunning),
                Err(_) => fs::remove_file(path)?,
            },
            Ok(_) => return Err(BridgeError::NotASocket),
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }

        let listener = UnixListener::bind(path)?;
        // `bind` honors the umask; nobody else can reach it yet because the directory is 0700.
        fs::set_permissions(path, Permissions::from_mode(0o600))?;
        Ok(Self {
            listener,
            path: path.to_owned(),
            uid,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Waits for the next connection from a native host run by the same user. Connections from
    /// other users are dropped and logged.
    pub async fn accept(&self) -> io::Result<Connection> {
        loop {
            let (stream, _) = self.listener.accept().await?;
            match stream.peer_cred() {
                Ok(peer) if peer.uid() == self.uid => return Ok(Connection { stream }),
                Ok(peer) => {
                    tracing::warn!(
                        peer_uid = peer.uid(),
                        "dropped a connection from another user"
                    );
                }
                Err(error) => tracing::warn!(%error, "dropped a connection without credentials"),
            }
        }
    }
}

impl Drop for BridgeServer {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// Connects the native host to the app, checking that the app runs as the same user.
pub async fn connect(path: &Path) -> io::Result<UnixStream> {
    let stream = UnixStream::connect(path).await?;
    if stream.peer_cred()?.uid() != own_uid()? {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "the bridge socket belongs to another user",
        ));
    }
    Ok(stream)
}

/// One native host connected to the app.
#[derive(Debug)]
pub struct Connection {
    stream: UnixStream,
}

impl Connection {
    pub fn split(self) -> (MessageReader, MessageWriter) {
        let (read, write) = self.stream.into_split();
        (MessageReader { read }, MessageWriter { write })
    }
}

#[derive(Debug)]
pub struct MessageReader {
    read: OwnedReadHalf,
}

impl MessageReader {
    /// The next valid message, or `None` once the host disconnects.
    ///
    /// Invalid messages (unknown `type`, other protocol version, malformed or oversized) are
    /// logged without their content and skipped; they never close the connection.
    pub async fn recv(&mut self) -> io::Result<Option<ExtensionMessage>> {
        loop {
            match read_frame(&mut self.read).await? {
                None => return Ok(None),
                Some(Frame::TooLarge { len }) => {
                    tracing::warn!(len, "ignored an oversized message from the native host");
                }
                Some(Frame::Message(bytes)) => match ExtensionMessage::decode(&bytes) {
                    Ok(message) => return Ok(Some(message)),
                    Err(error) => {
                        tracing::warn!(%error, "ignored a message from the native host");
                    }
                },
            }
        }
    }
}

#[derive(Debug)]
pub struct MessageWriter {
    write: OwnedWriteHalf,
}

impl MessageWriter {
    pub async fn send(&mut self, message: &AppMessage) -> io::Result<()> {
        let bytes = message
            .encode()
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?;
        write_frame(&mut self.write, &bytes).await
    }
}

/// Creates `dir` with mode 0700, or tightens it to 0700 if it exists and belongs to `uid`.
fn private_dir(dir: &Path, uid: u32) -> Result<(), BridgeError> {
    if let Some(parent) = dir.parent() {
        fs::create_dir_all(parent)?;
    }
    match DirBuilder::new().mode(0o700).create(dir) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e.into()),
    }
    let meta = fs::symlink_metadata(dir)?;
    if !meta.is_dir() || meta.uid() != uid {
        return Err(BridgeError::ForeignDirectory);
    }
    if meta.mode() & 0o077 != 0 {
        fs::set_permissions(dir, Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// This process's effective UID.
///
/// Rust's standard library has no `getuid`, and calling `libc::getuid` needs `unsafe`, which the
/// portable crates forbid. The peer of one end of a socket pair is this very process, so asking
/// tokio for that peer's credentials (the same safe call used to check real peers) returns our
/// own effective UID, as the kernel reports it.
fn own_uid() -> io::Result<u32> {
    let (ours, _theirs) = UnixStream::pair()?;
    Ok(ours.peer_cred()?.uid())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn own_uid_matches_the_owner_of_a_file_we_create() {
        // A new file is owned by the creating process's effective UID.
        let file = std::env::temp_dir().join(format!("islet-uid-{}", std::process::id()));
        fs::write(&file, b"").unwrap();
        let owner = fs::metadata(&file).unwrap().uid();
        fs::remove_file(&file).unwrap();
        assert_eq!(own_uid().unwrap(), owner);
    }
}
