//! Relays frames between Chrome (stdin/stdout) and the app (local socket).
//!
//! - Frames are forwarded as they are; the host only peeks at `hello` (replayed to the app on
//!   every connection) and at session messages (to know when a call starts).
//! - When the app cannot be reached, Chrome gets one `error: app_not_running` and the host keeps
//!   retrying with backoff. When a new call starts meanwhile, the host opens the app in the
//!   background, if it runs from inside the app bundle.
//! - When Chrome closes stdin, the host returns and exits.

use std::collections::HashSet;
use std::io;
use std::path::PathBuf;
use std::time::Duration;

use islet_bridge::frame::{Frame, read_frame, write_frame};
use islet_protocol::{AppMessage, BridgeError, ErrorCode, ExtensionMessage};
use tokio::io::{AsyncRead, Stdout};
use tokio::net::unix::OwnedWriteHalf;
use tokio::sync::mpsc;
use tokio::time::{Instant, sleep_until};

use crate::launch;

const FIRST_RETRY: Duration = Duration::from_millis(250);
const MAX_RETRY: Duration = Duration::from_secs(5);
/// Several tabs starting calls at once open the app only once.
const LAUNCH_COOLDOWN: Duration = Duration::from_secs(30);

/// A frame from the app, tagged with the connection it came from. `None` means that connection
/// closed.
type AppFrame = (u64, Option<Vec<u8>>);

pub async fn run(socket: PathBuf, bundle: Option<PathBuf>) -> io::Result<()> {
    let (chrome_tx, mut from_chrome) = mpsc::channel(16);
    tokio::spawn(read_frames(tokio::io::stdin(), chrome_tx));
    let (app_tx, mut from_app) = mpsc::channel(16);

    let mut relay = Relay {
        socket,
        bundle,
        stdout: tokio::io::stdout(),
        app: None,
        app_tx,
        connection: 0,
        retry: FIRST_RETRY,
        next_attempt: Instant::now(),
        told_not_running: false,
        hello: None,
        calls: HashSet::new(),
        last_launch: None,
    };

    loop {
        let next_attempt = relay.next_attempt;
        tokio::select! {
            frame = from_chrome.recv() => match frame {
                None | Some(Ok(None)) => return Ok(()),
                Some(Err(error)) => return Err(error),
                Some(Ok(Some(Frame::TooLarge { len }))) => {
                    tracing::warn!(len, "rejected an oversized message from Chrome");
                    relay.send_error_to_chrome(ErrorCode::MessageTooLarge).await?;
                }
                Some(Ok(Some(Frame::Message(bytes)))) => relay.handle_extension_frame(bytes).await?,
            },
            Some((connection, frame)) = from_app.recv() => {
                if connection == relay.connection {
                    match frame {
                        Some(bytes) => write_frame(&mut relay.stdout, &bytes).await?,
                        None => relay.lost_app().await?,
                    }
                }
            }
            () = sleep_until(next_attempt), if relay.app.is_none() => relay.connect().await?,
        }
    }
}

struct Relay {
    socket: PathBuf,
    bundle: Option<PathBuf>,
    /// Only `run` and `Relay` write to stdout, one whole frame at a time.
    stdout: Stdout,
    app: Option<OwnedWriteHalf>,
    app_tx: mpsc::Sender<AppFrame>,
    /// Incremented per connection, so frames from a closed connection are ignored.
    connection: u64,
    retry: Duration,
    next_attempt: Instant,
    told_not_running: bool,
    /// The extension's last `hello`, replayed to the app on every connection.
    hello: Option<Vec<u8>>,
    /// Tabs with a call in progress.
    calls: HashSet<u32>,
    last_launch: Option<Instant>,
}

impl Relay {
    async fn handle_extension_frame(&mut self, bytes: Vec<u8>) -> io::Result<()> {
        let mut call_started = false;
        match ExtensionMessage::decode(&bytes) {
            Ok(ExtensionMessage::Hello(_)) => self.hello = Some(bytes.clone()),
            Ok(ExtensionMessage::SessionUpdate(update)) => {
                call_started = self.calls.insert(update.tab_id);
            }
            Ok(ExtensionMessage::SessionEnded(ended)) => {
                self.calls.remove(&ended.tab_id);
            }
            // Anything else, valid or not, is the app's business: it logs and ignores what it
            // does not understand.
            _ => {}
        }

        if let Some(app) = &mut self.app {
            if let Err(error) = write_frame(app, &bytes).await {
                tracing::warn!(%error, "lost the app while writing");
                self.lost_app().await?;
            }
        } else if call_started {
            self.launch_app();
        } else {
            tracing::debug!("dropped a message: the app is not connected");
        }
        Ok(())
    }

    async fn connect(&mut self) -> io::Result<()> {
        match islet_bridge::connect(&self.socket).await {
            Ok(stream) => {
                let (read, mut write) = stream.into_split();
                if let Some(hello) = &self.hello
                    && let Err(error) = write_frame(&mut write, hello).await
                {
                    tracing::warn!(%error, "lost the app while replaying hello");
                    return self.schedule_retry().await;
                }
                self.connection += 1;
                tokio::spawn(read_app(read, self.connection, self.app_tx.clone()));
                self.app = Some(write);
                self.retry = FIRST_RETRY;
                self.told_not_running = false;
                tracing::info!("connected to the app");
                Ok(())
            }
            Err(error) => {
                tracing::debug!(%error, "the app is not reachable");
                self.schedule_retry().await
            }
        }
    }

    async fn lost_app(&mut self) -> io::Result<()> {
        tracing::info!("the app disconnected");
        self.app = None;
        self.connection += 1;
        self.retry = FIRST_RETRY;
        self.schedule_retry().await
    }

    async fn schedule_retry(&mut self) -> io::Result<()> {
        self.next_attempt = Instant::now() + self.retry;
        self.retry = (self.retry * 2).min(MAX_RETRY);
        if !self.told_not_running {
            self.told_not_running = true;
            self.send_error_to_chrome(ErrorCode::AppNotRunning).await?;
        }
        Ok(())
    }

    fn launch_app(&mut self) {
        let Some(bundle) = &self.bundle else {
            tracing::debug!("a call started; development mode, so not opening the app");
            return;
        };
        if self
            .last_launch
            .is_some_and(|at| at.elapsed() < LAUNCH_COOLDOWN)
        {
            return;
        }
        self.last_launch = Some(Instant::now());
        launch::open_in_background(bundle);
        // Try again soon instead of waiting out the backoff.
        self.retry = FIRST_RETRY;
        self.next_attempt = Instant::now() + FIRST_RETRY;
    }

    async fn send_error_to_chrome(&mut self, code: ErrorCode) -> io::Result<()> {
        let message = AppMessage::Error(BridgeError { code });
        let bytes = message
            .encode()
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        write_frame(&mut self.stdout, &bytes).await
    }
}

async fn read_frames<R: AsyncRead + Unpin>(
    mut reader: R,
    tx: mpsc::Sender<io::Result<Option<Frame>>>,
) {
    loop {
        let frame = read_frame(&mut reader).await;
        let done = !matches!(frame, Ok(Some(_)));
        if tx.send(frame).await.is_err() || done {
            return;
        }
    }
}

async fn read_app(
    mut read: tokio::net::unix::OwnedReadHalf,
    connection: u64,
    tx: mpsc::Sender<AppFrame>,
) {
    loop {
        match read_frame(&mut read).await {
            Ok(Some(Frame::Message(bytes))) => {
                if tx.send((connection, Some(bytes))).await.is_err() {
                    return;
                }
            }
            Ok(Some(Frame::TooLarge { len })) => {
                tracing::warn!(len, "dropped an oversized message from the app");
            }
            Ok(None) | Err(_) => {
                let _ = tx.send((connection, None)).await;
                return;
            }
        }
    }
}
