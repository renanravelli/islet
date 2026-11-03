//! `islet-native-host`: the Chrome Native Messaging host. Chrome starts it when the extension
//! opens its port and closes stdin when the port closes. It relays frames between Chrome (stdio)
//! and the app (local socket); see `docs/adr/0002`.
//!
//! **stdout carries Chrome's framing and nothing else.** Logs go to stderr. Any stray byte on
//! stdout would corrupt the stream, so printing to stdout is a compile error in this crate.

#![deny(clippy::print_stdout)]

use std::process::ExitCode;
use std::time::Duration;

#[cfg(unix)]
mod launch;
#[cfg(unix)]
mod relay;

/// Chrome closed stdin: the normal way to stop.
#[cfg(unix)]
const EXIT_OK: u8 = 0;
const EXIT_ERROR: u8 = 1;
/// The calling origin is not an allowed extension.
const EXIT_FORBIDDEN: u8 = 2;

/// Sets the log level on stderr: `error`, `warn`, `info` (default), `debug` or `trace`.
const LOG_ENV: &str = "ISLET_LOG";

fn main() -> ExitCode {
    init_logging();

    // Chrome passes the caller's origin as the first argument. It already enforces the
    // manifest's `allowed_origins`; checking again costs nothing.
    let origin = std::env::args().nth(1).unwrap_or_default();
    if !islet_bridge::origin::is_allowed_origin(&origin) {
        tracing::error!(origin, "refusing to run for an origin that is not allowed");
        return ExitCode::from(EXIT_FORBIDDEN);
    }

    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            tracing::error!(%error, "cannot start the runtime");
            return ExitCode::from(EXIT_ERROR);
        }
    };
    let code = runtime.block_on(run());
    // Do not wait for a blocked stdin read when stopping for another reason.
    runtime.shutdown_timeout(Duration::from_millis(100));
    ExitCode::from(code)
}

#[cfg(unix)]
async fn run() -> u8 {
    let Some(socket) = islet_bridge::path::socket_path() else {
        tracing::error!("cannot locate the bridge socket: HOME is not set");
        return EXIT_ERROR;
    };
    let bundle = std::env::current_exe()
        .ok()
        .and_then(|exe| launch::bundle_of(&exe));
    if bundle.is_none() {
        tracing::info!(
            "development mode: the host is not inside an app bundle, so it never opens the app"
        );
    }
    match relay::run(socket, bundle).await {
        Ok(()) => {
            tracing::info!("Chrome closed the port; exiting");
            EXIT_OK
        }
        Err(error) => {
            tracing::error!(%error, "stopping");
            EXIT_ERROR
        }
    }
}

#[cfg(not(unix))]
async fn run() -> u8 {
    tracing::error!("the native host is not implemented on this platform yet");
    EXIT_ERROR
}

fn init_logging() {
    let level = std::env::var(LOG_ENV)
        .ok()
        .and_then(|level| level.parse::<tracing::level_filters::LevelFilter>().ok())
        .unwrap_or(tracing::level_filters::LevelFilter::INFO);
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .with_target(false)
        .with_max_level(level)
        .init();
}
