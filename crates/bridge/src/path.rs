//! Where the bridge socket lives (`docs/adr/0002`).

use std::env;
use std::path::{Path, PathBuf};

use crate::BUNDLE_ID;

/// Overrides the socket path, for tests and development. Both the app and the host read it.
pub const SOCKET_ENV: &str = "ISLET_BRIDGE_SOCKET";

const SOCKET_FILE: &str = "bridge.sock";

/// The longest socket path the OS accepts (`sun_path` minus its terminating NUL).
#[cfg(target_os = "macos")]
const MAX_SOCKET_PATH: usize = 103;
#[cfg(not(target_os = "macos"))]
const MAX_SOCKET_PATH: usize = 107;

/// The socket path: `$ISLET_BRIDGE_SOCKET` if set, else [`resolve`] from `$HOME` and the
/// temporary directory. `None` when `$HOME` is not set.
pub fn socket_path() -> Option<PathBuf> {
    if let Some(path) = env::var_os(SOCKET_ENV) {
        return Some(path.into());
    }
    let home = env::var_os("HOME")?;
    Some(resolve(Path::new(&home), &env::temp_dir()))
}

/// Where the app and the native host write their logs: `~/Library/Logs/<bundle id>` on macOS.
/// Both use the same folder, so "Abrir pasta" in the settings shows both. `None` when `$HOME` is
/// not set.
pub fn log_dir() -> Option<PathBuf> {
    let home = env::var_os("HOME")?;
    Some(log_dir_in(Path::new(&home)))
}

/// [`log_dir`] for the given home folder.
#[cfg(target_os = "macos")]
pub fn log_dir_in(home: &Path) -> PathBuf {
    home.join("Library/Logs").join(BUNDLE_ID)
}

/// [`log_dir`] for the given home folder.
#[cfg(not(target_os = "macos"))]
pub fn log_dir_in(home: &Path) -> PathBuf {
    home.join(".local/state").join(BUNDLE_ID).join("logs")
}

/// `<app data>/<bundle id>/bridge.sock`, or the same under `temp` when that path is too long for
/// a Unix socket. On macOS `<app data>` is `~/Library/Application Support` and `temp` is the
/// per-user `$TMPDIR`.
pub fn resolve(home: &Path, temp: &Path) -> PathBuf {
    let preferred = app_data(home).join(BUNDLE_ID).join(SOCKET_FILE);
    if preferred.as_os_str().len() <= MAX_SOCKET_PATH {
        preferred
    } else {
        temp.join(BUNDLE_ID).join(SOCKET_FILE)
    }
}

#[cfg(target_os = "macos")]
fn app_data(home: &Path) -> PathBuf {
    home.join("Library/Application Support")
}

#[cfg(not(target_os = "macos"))]
fn app_data(home: &Path) -> PathBuf {
    home.join(".local/share")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "macos")]
    fn prefers_application_support() {
        assert_eq!(
            resolve(Path::new("/Users/someone"), Path::new("/tmp")),
            Path::new(
                "/Users/someone/Library/Application Support/io.github.renanravelli.islet/bridge.sock"
            )
        );
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn logs_go_to_library_logs() {
        assert_eq!(
            log_dir_in(Path::new("/Users/someone")),
            Path::new("/Users/someone/Library/Logs/io.github.renanravelli.islet")
        );
    }

    #[test]
    fn falls_back_to_temp_when_too_long() {
        let home = PathBuf::from(format!("/Users/{}", "x".repeat(80)));
        let path = resolve(&home, Path::new("/var/folders/ab/T"));
        assert_eq!(
            path,
            Path::new("/var/folders/ab/T/io.github.renanravelli.islet/bridge.sock")
        );
    }

    #[test]
    fn a_path_at_the_limit_is_kept() {
        let suffix = app_data(Path::new("/"))
            .join(BUNDLE_ID)
            .join(SOCKET_FILE)
            .as_os_str()
            .len();
        let home = PathBuf::from(format!("/{}", "h".repeat(MAX_SOCKET_PATH - suffix - 1)));
        let path = resolve(&home, Path::new("/tmp"));
        assert_eq!(path.as_os_str().len(), MAX_SOCKET_PATH);
        assert!(path.starts_with(&home));
    }
}
