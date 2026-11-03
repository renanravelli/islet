#![cfg(unix)]

use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use islet_bridge::frame::{Frame, read_frame, write_frame};
use islet_bridge::{BridgeError, BridgeServer, connect};
use islet_protocol::{AppMessage, ExtensionMessage, MAX_MESSAGE_BYTES};
use tokio::io::AsyncWriteExt;

struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!("islet-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        Self(path)
    }

    fn socket(&self) -> PathBuf {
        self.0.join("bridge.sock")
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn mode(path: &std::path::Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[tokio::test]
async fn binds_privately() {
    let tmp = TempDir::new("bind");
    let server = BridgeServer::bind(&tmp.socket()).await.unwrap();
    assert_eq!(mode(&tmp.0), 0o700);
    assert_eq!(mode(server.path()), 0o600);

    drop(server);
    assert!(!tmp.socket().exists(), "the socket is removed on shutdown");
}

#[tokio::test]
async fn tightens_an_existing_directory() {
    let tmp = TempDir::new("tighten");
    fs::create_dir_all(&tmp.0).unwrap();
    fs::set_permissions(&tmp.0, fs::Permissions::from_mode(0o755)).unwrap();
    let _server = BridgeServer::bind(&tmp.socket()).await.unwrap();
    assert_eq!(mode(&tmp.0), 0o700);
}

#[tokio::test]
async fn replaces_a_stale_socket_but_not_a_live_one() {
    let tmp = TempDir::new("stale");
    let first = BridgeServer::bind(&tmp.socket()).await.unwrap();
    assert!(matches!(
        BridgeServer::bind(&tmp.socket()).await,
        Err(BridgeError::AlreadyRunning)
    ));

    drop(first);

    // A crashed app leaves its socket file behind, with nobody listening.
    drop(std::os::unix::net::UnixListener::bind(tmp.socket()).unwrap());
    assert!(tmp.socket().exists());
    let _second = BridgeServer::bind(&tmp.socket()).await.unwrap();
}

#[tokio::test]
async fn never_deletes_a_file_that_is_not_a_socket() {
    let tmp = TempDir::new("notsocket");
    fs::create_dir_all(&tmp.0).unwrap();
    fs::write(tmp.socket(), b"precious").unwrap();
    assert!(matches!(
        BridgeServer::bind(&tmp.socket()).await,
        Err(BridgeError::NotASocket)
    ));
    assert_eq!(fs::read(tmp.socket()).unwrap(), b"precious");
}

#[tokio::test]
async fn relays_messages_both_ways() {
    let tmp = TempDir::new("relay");
    let server = BridgeServer::bind(&tmp.socket()).await.unwrap();
    let mut host = connect(&tmp.socket()).await.unwrap();
    let (mut reader, mut writer) = server.accept().await.unwrap().split();

    write_frame(&mut host, &ExtensionMessage::Pong.encode().unwrap())
        .await
        .unwrap();
    assert_eq!(reader.recv().await.unwrap(), Some(ExtensionMessage::Pong));

    writer.send(&AppMessage::Ping).await.unwrap();
    let Some(Frame::Message(bytes)) = read_frame(&mut host).await.unwrap() else {
        panic!("expected a frame");
    };
    assert_eq!(AppMessage::decode(&bytes).unwrap(), AppMessage::Ping);

    drop(host);
    assert_eq!(reader.recv().await.unwrap(), None);
}

#[derive(Clone, Default)]
struct Logs(Arc<Mutex<Vec<u8>>>);

impl Write for Logs {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Logs {
    fn text(&self) -> String {
        String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
    }
}

#[tokio::test]
async fn logs_and_skips_bad_messages_without_dropping_the_connection() {
    let logs = Logs::default();
    let writer = logs.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .with_writer(move || writer.clone())
        .finish();
    let _guard = tracing::subscriber::set_default(subscriber);

    let tmp = TempDir::new("unknown");
    let server = BridgeServer::bind(&tmp.socket()).await.unwrap();
    let mut host = connect(&tmp.socket()).await.unwrap();
    let (mut reader, _writer) = server.accept().await.unwrap().split();

    // Written concurrently: the oversized frame does not fit in the socket buffer.
    let sender = tokio::spawn(async move {
        for bad in [
            br#"{"v":1,"type":"screen.share","presenter":"Alex Example"}"#.to_vec(),
            br#"{"v":2,"type":"pong"}"#.to_vec(),
            br#"{"v":1,"type":"session.ended","tab_id":"Alex Example"}"#.to_vec(),
            b"not json".to_vec(),
        ] {
            write_frame(&mut host, &bad).await.unwrap();
        }
        // An oversized frame, written by hand since write_frame refuses it.
        let big = vec![b' '; MAX_MESSAGE_BYTES + 1];
        let prefix = u32::try_from(big.len()).unwrap().to_ne_bytes();
        host.write_all(&prefix).await.unwrap();
        host.write_all(&big).await.unwrap();
        write_frame(&mut host, &ExtensionMessage::Pong.encode().unwrap())
            .await
            .unwrap();
        host
    });

    // Every bad message is skipped and the connection still delivers the next good one.
    assert_eq!(reader.recv().await.unwrap(), Some(ExtensionMessage::Pong));
    let _host = sender.await.unwrap();

    let text = logs.text();
    assert!(
        text.contains(r#"unknown message type "screen.share""#),
        "{text}"
    );
    assert!(text.contains("unsupported protocol version 2"), "{text}");
    assert!(text.contains("malformed message"), "{text}");
    assert!(text.contains("oversized"), "{text}");
    assert!(!text.contains("Alex"), "personal data in logs: {text}");
}
