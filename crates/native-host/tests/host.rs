//! Runs the real `islet-native-host` binary the way Chrome does, against a real bridge server.

#![cfg(unix)]

use std::path::PathBuf;
use std::process::{ExitStatus, Stdio};
use std::time::Duration;

use islet_bridge::frame::{Frame, read_frame, write_frame};
use islet_bridge::{BridgeServer, MessageReader, MessageWriter};
use islet_protocol::{
    AppMessage, BridgeError, ErrorCode, ExtensionMessage, Hello, MAX_MESSAGE_BYTES,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::time::timeout;

const ORIGIN: &str = "chrome-extension://dhfbcfjjnccdblcpemefndebjeannaam/";
const WAIT: Duration = Duration::from_secs(10);

struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!("islet-host-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        Self(path)
    }

    fn socket(&self) -> PathBuf {
        self.0.join("bridge.sock")
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// The host as Chrome sees it.
struct Host {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: ChildStdout,
    stderr: ChildStderr,
}

impl Host {
    fn spawn(socket: &std::path::Path, args: &[&str]) -> Self {
        // Logs land in <socket dir>/home/Library/Logs, never in the real home.
        let home = socket.parent().unwrap().join("home");
        let mut child = Command::new(env!("CARGO_BIN_EXE_islet-native-host"))
            .args(args)
            .env("HOME", home)
            .env(islet_bridge::path::SOCKET_ENV, socket)
            .env("ISLET_LOG", "trace")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        Self {
            stdin: child.stdin.take(),
            stdout: child.stdout.take().unwrap(),
            stderr: child.stderr.take().unwrap(),
            child,
        }
    }

    fn start(socket: &std::path::Path) -> Self {
        Self::spawn(socket, &[ORIGIN])
    }

    async fn send(&mut self, message: &ExtensionMessage) {
        let stdin = self.stdin.as_mut().unwrap();
        write_frame(stdin, &message.encode().unwrap())
            .await
            .unwrap();
    }

    async fn send_raw(&mut self, bytes: &[u8]) {
        self.stdin.as_mut().unwrap().write_all(bytes).await.unwrap();
    }

    async fn recv(&mut self) -> AppMessage {
        let frame = timeout(WAIT, read_frame(&mut self.stdout))
            .await
            .expect("a frame in time")
            .unwrap();
        let Some(Frame::Message(bytes)) = frame else {
            panic!("expected a frame, got {frame:?}");
        };
        AppMessage::decode(&bytes).expect("only protocol frames on stdout")
    }

    /// Closes stdin like Chrome does, then checks the host exits and that everything it wrote
    /// to stdout was well-formed frames. Returns the exit status, the leftover frames and stderr.
    async fn close(mut self) -> (ExitStatus, Vec<AppMessage>, String) {
        drop(self.stdin.take());
        let status = timeout(WAIT, self.child.wait())
            .await
            .expect("exits after EOF")
            .unwrap();
        let mut leftover = Vec::new();
        loop {
            match read_frame(&mut self.stdout).await {
                Ok(None) => break,
                Ok(Some(Frame::Message(bytes))) => {
                    leftover.push(AppMessage::decode(&bytes).expect("only protocol frames"));
                }
                other => panic!("stdout is not clean framing: {other:?}"),
            }
        }
        let mut stderr = String::new();
        self.stderr.read_to_string(&mut stderr).await.unwrap();
        (status, leftover, stderr)
    }
}

fn hello() -> ExtensionMessage {
    ExtensionMessage::Hello(Hello {
        extension_version: "0.1.0".into(),
        browser: "Chrome test".into(),
    })
}

fn not_running() -> AppMessage {
    AppMessage::Error(BridgeError {
        code: ErrorCode::AppNotRunning,
    })
}

async fn accept(server: &BridgeServer) -> (MessageReader, MessageWriter) {
    timeout(WAIT, server.accept())
        .await
        .expect("the host connects")
        .unwrap()
        .split()
}

async fn recv(reader: &mut MessageReader) -> Option<ExtensionMessage> {
    timeout(WAIT, reader.recv())
        .await
        .expect("a message")
        .unwrap()
}

#[tokio::test]
async fn refuses_origins_that_are_not_allowed() {
    let tmp = TempDir::new("origin");
    for args in [
        &[][..],
        &["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"][..],
        &["--parent-window=0"][..],
    ] {
        let host = Host::spawn(&tmp.socket(), args);
        let (status, leftover, stderr) = host.close().await;
        assert_eq!(status.code(), Some(2), "{args:?}");
        assert!(leftover.is_empty(), "nothing on stdout");
        assert!(stderr.contains("not allowed"), "{stderr}");
    }
}

#[tokio::test]
async fn reports_app_not_running_once_and_exits_on_eof() {
    let tmp = TempDir::new("notrunning");
    let mut host = Host::start(&tmp.socket());
    assert_eq!(host.recv().await, not_running());

    // Heartbeats while the app is away are dropped quietly, not answered with more errors.
    host.send(&hello()).await;
    host.send(&ExtensionMessage::Pong).await;
    tokio::time::sleep(Duration::from_millis(800)).await;

    let (status, leftover, stderr) = host.close().await;
    assert!(status.success(), "{stderr}");
    assert!(leftover.is_empty(), "{leftover:?}");
    assert!(stderr.contains("development mode"), "{stderr}");
}

#[tokio::test]
async fn relays_both_ways_and_disconnects_on_eof() {
    let tmp = TempDir::new("relay");
    let server = BridgeServer::bind(&tmp.socket()).await.unwrap();
    let mut host = Host::start(&tmp.socket());
    let (mut reader, mut writer) = accept(&server).await;

    host.send(&hello()).await;
    assert_eq!(recv(&mut reader).await, Some(hello()));

    writer.send(&AppMessage::Ping).await.unwrap();
    assert_eq!(host.recv().await, AppMessage::Ping);
    host.send(&ExtensionMessage::Pong).await;
    assert_eq!(recv(&mut reader).await, Some(ExtensionMessage::Pong));

    let (status, leftover, _) = host.close().await;
    assert!(status.success());
    assert!(leftover.is_empty());
    assert_eq!(recv(&mut reader).await, None, "the app sees the host leave");
}

#[tokio::test]
async fn reconnects_with_backoff_and_replays_hello() {
    let tmp = TempDir::new("reconnect");
    let mut host = Host::start(&tmp.socket());
    assert_eq!(host.recv().await, not_running());
    host.send(&hello()).await;

    // The app starts later.
    tokio::time::sleep(Duration::from_millis(600)).await;
    let server = BridgeServer::bind(&tmp.socket()).await.unwrap();
    let (mut reader, _writer) = accept(&server).await;
    assert_eq!(recv(&mut reader).await, Some(hello()), "hello is replayed");

    // The app quits: Chrome hears about it once, and the host comes back to a new app.
    drop(reader);
    drop(_writer);
    drop(server);
    assert_eq!(host.recv().await, not_running());
    let server = BridgeServer::bind(&tmp.socket()).await.unwrap();
    let (mut reader, _writer) = accept(&server).await;
    assert_eq!(recv(&mut reader).await, Some(hello()));

    let (status, leftover, _) = host.close().await;
    assert!(status.success());
    assert!(leftover.is_empty());
}

#[tokio::test]
async fn rejects_oversized_messages_without_losing_sync() {
    let tmp = TempDir::new("oversized");
    let server = BridgeServer::bind(&tmp.socket()).await.unwrap();
    let mut host = Host::start(&tmp.socket());
    let (mut reader, _writer) = accept(&server).await;

    let len = u32::try_from(MAX_MESSAGE_BYTES + 1).unwrap();
    host.send_raw(&len.to_ne_bytes()).await;
    host.send_raw(&vec![b' '; MAX_MESSAGE_BYTES + 1]).await;
    assert_eq!(
        host.recv().await,
        AppMessage::Error(BridgeError {
            code: ErrorCode::MessageTooLarge
        })
    );

    host.send(&ExtensionMessage::Pong).await;
    assert_eq!(recv(&mut reader).await, Some(ExtensionMessage::Pong));
    let (status, _, stderr) = host.close().await;
    assert!(status.success());
    assert!(stderr.contains("oversized"), "{stderr}");
}

#[tokio::test]
async fn stdout_carries_only_frames_even_with_verbose_logging() {
    let tmp = TempDir::new("stdout");
    let mut host = Host::start(&tmp.socket());
    // Exercise the noisy paths: failed connections, drops, oversize, a reconnect, bad input.
    assert_eq!(host.recv().await, not_running());
    host.send(&hello()).await;
    host.send_raw(&4u32.to_ne_bytes()).await;
    host.send_raw(b"oops").await;
    let len = u32::try_from(MAX_MESSAGE_BYTES + 1).unwrap();
    host.send_raw(&len.to_ne_bytes()).await;
    host.send_raw(&vec![b'x'; MAX_MESSAGE_BYTES + 1]).await;
    tokio::time::sleep(Duration::from_millis(600)).await;
    let server = BridgeServer::bind(&tmp.socket()).await.unwrap();
    let (mut reader, mut writer) = accept(&server).await;
    assert_eq!(recv(&mut reader).await, Some(hello()));
    assert_eq!(
        host.recv().await,
        AppMessage::Error(BridgeError {
            code: ErrorCode::MessageTooLarge
        })
    );
    writer.send(&AppMessage::Ping).await.unwrap();
    assert_eq!(host.recv().await, AppMessage::Ping);

    // `close` fails unless every byte left on stdout is part of a well-formed frame.
    let (status, frames, stderr) = host.close().await;
    assert!(status.success());
    assert!(frames.is_empty(), "{frames:?}");
    // The logs went to stderr.
    assert!(stderr.contains("connected to the app"), "{stderr}");
    assert!(stderr.lines().count() >= 5, "{stderr}");
}

#[tokio::test]
async fn also_logs_to_a_daily_file() {
    let tmp = TempDir::new("logfile");
    let mut host = Host::start(&tmp.socket());
    assert_eq!(host.recv().await, not_running());
    let (status, _, stderr) = host.close().await;
    assert!(status.success());

    let dir = islet_bridge::path::log_dir_in(&tmp.0.join("home"));
    let files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    assert_eq!(files.len(), 1, "{files:?}");
    assert!(
        files[0].starts_with("native-host.") && files[0].ends_with(".log"),
        "{files:?}"
    );
    let log = std::fs::read_to_string(dir.join(&files[0])).unwrap();
    assert!(log.contains("development mode"), "{log}");
    // Same content as stderr.
    assert_eq!(log, stderr);
}
