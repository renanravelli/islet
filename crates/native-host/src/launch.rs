//! Opening the app when a call starts and the app is not running.

use std::path::{Path, PathBuf};

/// The `.app` bundle that contains `exe`, when it lives at `<bundle>.app/Contents/MacOS/`.
///
/// The bundle comes from the host's own location, not from the bundle ID, so a development
/// build and a release build sharing the ID are never confused. Outside a bundle (for example
/// `target/debug`) there is none, and the host never opens the app by itself.
pub fn bundle_of(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let is_bundle = macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && bundle.extension()? == "app";
    is_bundle.then(|| bundle.to_owned())
}

/// Opens `bundle` in the background (`open -g`), without bringing it to the front.
#[cfg(target_os = "macos")]
pub fn open_in_background(bundle: &Path) {
    use std::process::Stdio;

    // The child must not inherit stdout: it belongs to Chrome's framing.
    let spawned = tokio::process::Command::new("/usr/bin/open")
        .arg("-g")
        .arg(bundle)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    match spawned {
        Ok(mut child) => {
            tokio::spawn(async move {
                match child.wait().await {
                    Ok(status) if status.success() => tracing::info!("opened the app"),
                    Ok(status) => tracing::warn!(%status, "could not open the app"),
                    Err(error) => tracing::warn!(%error, "could not open the app"),
                }
            });
        }
        Err(error) => tracing::warn!(%error, "could not run open"),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn open_in_background(_bundle: &Path) {
    tracing::debug!("opening the app is only implemented on macOS");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_bundle_from_the_hosts_location() {
        assert_eq!(
            bundle_of(Path::new(
                "/Applications/Islet.app/Contents/MacOS/islet-native-host"
            )),
            Some(PathBuf::from("/Applications/Islet.app"))
        );
        assert_eq!(
            bundle_of(Path::new(
                "/Users/x/Dev Build.app/Contents/MacOS/islet-native-host"
            )),
            Some(PathBuf::from("/Users/x/Dev Build.app"))
        );
    }

    #[test]
    fn development_builds_have_no_bundle() {
        for exe in [
            "/Users/x/islet/target/debug/islet-native-host",
            "/Users/x/islet/target/release/islet-native-host",
            "/Applications/Islet.app/Contents/Resources/islet-native-host",
            "/Applications/Islet/Contents/MacOS/islet-native-host",
            "/islet-native-host",
            "islet-native-host",
        ] {
            assert_eq!(bundle_of(Path::new(exe)), None, "{exe}");
        }
    }
}
