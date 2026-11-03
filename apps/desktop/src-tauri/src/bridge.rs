//! The app's end of the Chrome bridge: serves the local socket and feeds islet-provider-meet,
//! which never touches a socket itself (docs/adr/0002).

use islet_provider_meet::BridgeEvent;
use tokio::sync::mpsc;

#[cfg(unix)]
pub async fn serve(events: mpsc::UnboundedSender<BridgeEvent>) {
    use islet_bridge::BridgeServer;

    let Some(path) = islet_bridge::path::socket_path() else {
        tracing::error!("cannot serve the bridge: HOME is not set");
        return;
    };
    let server = match BridgeServer::bind(&path).await {
        Ok(server) => server,
        Err(error) => {
            tracing::error!(%error, "cannot serve the bridge");
            return;
        }
    };
    tracing::info!("serving the Chrome bridge");
    let mut next = 1;
    loop {
        match server.accept().await {
            Ok(connection) => {
                let id = next;
                next += 1;
                tauri::async_runtime::spawn(connection_loop(id, connection, events.clone()));
            }
            Err(error) => {
                tracing::warn!(%error, "bridge accept failed");
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
        }
    }
}

#[cfg(unix)]
async fn connection_loop(
    connection: u64,
    socket: islet_bridge::Connection,
    events: mpsc::UnboundedSender<BridgeEvent>,
) {
    let (mut reader, mut writer) = socket.split();
    let (outbox, mut queued) = mpsc::unbounded_channel();
    if events
        .send(BridgeEvent::Connected { connection, outbox })
        .is_err()
    {
        return;
    }
    tracing::info!(connection, "native host connected");
    let writing = tauri::async_runtime::spawn(async move {
        while let Some(message) = queued.recv().await {
            if let Err(error) = writer.send(&message).await {
                tracing::warn!(%error, "bridge write failed");
                return;
            }
        }
    });
    loop {
        match reader.recv().await {
            Ok(Some(message)) => {
                if events
                    .send(BridgeEvent::Message {
                        connection,
                        message,
                    })
                    .is_err()
                {
                    break;
                }
            }
            Ok(None) => break,
            Err(error) => {
                tracing::warn!(%error, "bridge read failed");
                break;
            }
        }
    }
    writing.abort();
    let _ = events.send(BridgeEvent::Disconnected { connection });
    tracing::info!(connection, "native host disconnected");
}

#[cfg(not(unix))]
pub async fn serve(_events: mpsc::UnboundedSender<BridgeEvent>) {
    tracing::warn!("the Chrome bridge is only implemented on Unix");
}

/// Checks and repairs Chrome's host manifest, pointing it at the host next to this binary
/// (`Contents/MacOS/islet-native-host` in the bundle, `target/<profile>/` in development). The
/// same routine runs on every start, in onboarding step 2 and from "Reinstall Chrome bridge".
pub fn repair_manifest() -> crate::model::BridgeState {
    use crate::model::BridgeState;
    let host = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("islet-native-host")));
    let Some(host) = host else {
        return BridgeState::Error {
            summary: "the app's own location is unknown".to_owned(),
        };
    };
    match islet_bridge::manifest::ensure_chrome_manifest(&host) {
        Ok(outcome) => {
            tracing::info!(?outcome, "Chrome bridge manifest checked");
            BridgeState::Ready
        }
        Err(error) => {
            tracing::warn!(%error, "Chrome bridge manifest not installed");
            BridgeState::Error {
                summary: error.to_string(),
            }
        }
    }
}
