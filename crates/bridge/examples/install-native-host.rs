//! Development helper behind `scripts/install-native-host.sh`: writes Chrome's native host
//! manifest for a host binary, with the same routine the app runs on every start.
//!
//! Usage: cargo run -p islet-bridge --example install-native-host -- <absolute host path>

use std::path::PathBuf;
use std::process::ExitCode;

use islet_bridge::manifest::{ManifestOutcome, ensure_chrome_manifest};

fn main() -> ExitCode {
    let Some(host) = std::env::args_os().nth(1).map(PathBuf::from) else {
        eprintln!("usage: install-native-host <absolute path to islet-native-host>");
        return ExitCode::FAILURE;
    };
    match ensure_chrome_manifest(&host) {
        Ok(outcome) => {
            let what = match outcome {
                ManifestOutcome::Unchanged => "already up to date",
                ManifestOutcome::Installed => "installed",
                ManifestOutcome::Repaired => "repaired",
            };
            println!("native host manifest {what}: {}", host.display());
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}
