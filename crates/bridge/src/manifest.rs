//! The native host manifest Chrome reads to find `islet-native-host`.
//!
//! The app calls [`ensure_chrome_manifest`] on every start and from "Reinstall Chrome bridge":
//! it rewrites the manifest when it is missing, unreadable or out of date, for example after the
//! app was moved to `/Applications`. `scripts/install-native-host.sh` does the same in
//! development.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::HOST_NAME;
use crate::origin::allowed_origins;

/// The manifest's content, as Chrome documents it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostManifest {
    pub name: String,
    pub description: String,
    /// Absolute path of the host binary.
    pub path: PathBuf,
    #[serde(rename = "type")]
    pub kind: String,
    pub allowed_origins: Vec<String>,
}

impl HostManifest {
    /// The manifest for the host binary at `host`.
    pub fn for_host(host: &Path) -> Self {
        Self {
            name: HOST_NAME.to_owned(),
            description: "Islet: shows your Google Meet call around the notch".to_owned(),
            path: host.to_owned(),
            kind: "stdio".to_owned(),
            allowed_origins: allowed_origins(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManifestOutcome {
    /// The manifest was already correct; nothing was written.
    Unchanged,
    /// There was no manifest; it was written.
    Installed,
    /// The manifest was wrong (another binary path, other origins, or unreadable); it was
    /// rewritten.
    Repaired,
}

#[derive(Debug, thiserror::Error)]
pub enum ManifestError {
    #[error("the host binary path must be absolute")]
    HostPathNotAbsolute,
    #[error("the host binary does not exist")]
    HostMissing,
    #[error("the home directory is unknown")]
    HomeUnknown,
    #[error("Google Chrome does not seem to be installed for this user")]
    ChromeNotFound,
    #[error("installing native host manifests is not supported on this platform")]
    Unsupported,
    #[error(transparent)]
    Io(#[from] io::Error),
}

/// Chrome's per-user manifest directory.
pub fn chrome_hosts_dir(home: &Path) -> Result<PathBuf, ManifestError> {
    if cfg!(target_os = "macos") {
        Ok(home.join("Library/Application Support/Google/Chrome/NativeMessagingHosts"))
    } else if cfg!(target_os = "linux") {
        Ok(home.join(".config/google-chrome/NativeMessagingHosts"))
    } else {
        Err(ManifestError::Unsupported)
    }
}

/// Makes sure Chrome's manifest for this user points at `host`.
///
/// Fails with [`ManifestError::ChromeNotFound`] when Chrome's profile directory does not exist,
/// instead of creating it.
pub fn ensure_chrome_manifest(host: &Path) -> Result<ManifestOutcome, ManifestError> {
    let home = std::env::var_os("HOME").ok_or(ManifestError::HomeUnknown)?;
    let dir = chrome_hosts_dir(Path::new(&home))?;
    if !dir.parent().is_some_and(Path::is_dir) {
        return Err(ManifestError::ChromeNotFound);
    }
    ensure_manifest(&dir, host)
}

/// Makes sure `<dir>/<host name>.json` describes `host`, writing it atomically when needed.
pub fn ensure_manifest(dir: &Path, host: &Path) -> Result<ManifestOutcome, ManifestError> {
    if !host.is_absolute() {
        return Err(ManifestError::HostPathNotAbsolute);
    }
    if !host.is_file() {
        return Err(ManifestError::HostMissing);
    }

    let wanted = HostManifest::for_host(host);
    let file = dir.join(format!("{HOST_NAME}.json"));
    let outcome = match fs::read(&file) {
        Ok(bytes) => match serde_json::from_slice::<HostManifest>(&bytes) {
            Ok(current) if current == wanted => return Ok(ManifestOutcome::Unchanged),
            _ => ManifestOutcome::Repaired,
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => ManifestOutcome::Installed,
        Err(e) => return Err(e.into()),
    };

    fs::create_dir_all(dir)?;
    let mut json = serde_json::to_vec_pretty(&wanted).map_err(io::Error::other)?;
    json.push(b'\n');
    let temp = dir.join(format!(".{HOST_NAME}.json.tmp"));
    fs::write(&temp, json)?;
    fs::rename(&temp, &file)?;
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("islet-manifest-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn fake_host(dir: &Path, name: &str) -> PathBuf {
        let host = dir.join(name);
        fs::write(&host, b"").unwrap();
        host
    }

    #[test]
    fn installs_then_leaves_a_correct_manifest_alone() {
        let tmp = TempDir::new("install");
        let host = fake_host(&tmp.0, "islet-native-host");
        let hosts = tmp.0.join("NativeMessagingHosts");

        assert_eq!(
            ensure_manifest(&hosts, &host).unwrap(),
            ManifestOutcome::Installed
        );
        let file = hosts.join("io.github.renanravelli.islet.json");
        let json: serde_json::Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        assert_eq!(json["name"], "io.github.renanravelli.islet");
        assert_eq!(json["type"], "stdio");
        assert_eq!(json["path"], host.to_str().unwrap());
        assert_eq!(
            json["allowed_origins"],
            serde_json::json!(["chrome-extension://dhfbcfjjnccdblcpemefndebjeannaam/"])
        );

        assert_eq!(
            ensure_manifest(&hosts, &host).unwrap(),
            ManifestOutcome::Unchanged
        );
        assert_eq!(
            fs::read_dir(&hosts).unwrap().count(),
            1,
            "no temp file left"
        );
    }

    #[test]
    fn repairs_a_moved_host_or_a_broken_file() {
        let tmp = TempDir::new("repair");
        let old = fake_host(&tmp.0, "old-host");
        let new = fake_host(&tmp.0, "new-host");
        let hosts = tmp.0.join("hosts");
        ensure_manifest(&hosts, &old).unwrap();

        assert_eq!(
            ensure_manifest(&hosts, &new).unwrap(),
            ManifestOutcome::Repaired
        );
        let file = hosts.join("io.github.renanravelli.islet.json");
        let current: HostManifest = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        assert_eq!(current.path, new);

        fs::write(&file, b"{ not json").unwrap();
        assert_eq!(
            ensure_manifest(&hosts, &new).unwrap(),
            ManifestOutcome::Repaired
        );
        assert_eq!(
            ensure_manifest(&hosts, &new).unwrap(),
            ManifestOutcome::Unchanged
        );
    }

    #[test]
    fn refuses_bad_host_paths() {
        let tmp = TempDir::new("refuse");
        assert!(matches!(
            ensure_manifest(&tmp.0, Path::new("relative/host")),
            Err(ManifestError::HostPathNotAbsolute)
        ));
        assert!(matches!(
            ensure_manifest(&tmp.0, &tmp.0.join("missing")),
            Err(ManifestError::HostMissing)
        ));
        assert_eq!(fs::read_dir(&tmp.0).unwrap().count(), 0);
    }
}
