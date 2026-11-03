//! Loads and saves the app's settings as JSON in its data folder.

use std::fs;
use std::path::{Path, PathBuf};

use crate::model::AppSettings;

pub struct SettingsFile {
    path: PathBuf,
}

impl SettingsFile {
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join("settings.json"),
        }
    }

    /// The saved settings, or the defaults when there are none or they cannot be read. Unknown
    /// or missing fields take their defaults.
    pub fn load(&self) -> AppSettings {
        match fs::read(&self.path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| {
                tracing::warn!(%error, "settings unreadable; using the defaults");
                AppSettings::default()
            }),
            Err(_) => AppSettings::default(),
        }
    }

    /// Writes atomically (a temporary file, then a rename).
    pub fn save(&self, settings: &AppSettings) -> std::io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let temp = self.path.with_extension("json.tmp");
        let mut json = serde_json::to_vec_pretty(settings).map_err(std::io::Error::other)?;
        json.push(b'\n');
        fs::write(&temp, json)?;
        fs::rename(&temp, &self.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Language;

    #[test]
    fn round_trips_and_tolerates_missing_or_bad_files() {
        let dir = std::env::temp_dir().join(format!("islet-settings-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let file = SettingsFile::new(&dir);
        assert_eq!(file.load(), AppSettings::default());

        let settings = AppSettings {
            language: Language::PtBr,
            show_participant_names: false,
            ..AppSettings::default()
        };
        file.save(&settings).unwrap();
        assert_eq!(file.load(), settings);

        fs::write(
            dir.join("settings.json"),
            br#"{"language":"en","unknown":1}"#,
        )
        .unwrap();
        assert_eq!(
            file.load(),
            AppSettings {
                language: Language::En,
                ..AppSettings::default()
            }
        );
        fs::write(dir.join("settings.json"), b"not json").unwrap();
        assert_eq!(file.load(), AppSettings::default());
        let _ = fs::remove_dir_all(&dir);
    }
}
