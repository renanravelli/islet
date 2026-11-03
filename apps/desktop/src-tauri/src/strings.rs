//! The UI dictionary (generated from docs/design/ui-spec.md), for the few strings the Rust side
//! shows itself: the tray menu.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use crate::model::Language;

type Table = BTreeMap<String, BTreeMap<String, String>>;

static STRINGS: LazyLock<Table> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../src/i18n/strings.json")).unwrap_or_default()
});

/// "pt-BR" or "en": the setting, or the system language when it is automatic.
pub fn locale(language: Language, system: &str) -> &'static str {
    match language {
        Language::PtBr => "pt-BR",
        Language::En => "en",
        Language::Auto if system.to_ascii_lowercase().starts_with("pt") => "pt-BR",
        Language::Auto => "en",
    }
}

/// The text for `key`, falling back to English and then to the key itself.
pub fn t(locale: &str, key: &str) -> String {
    let lookup = |l: &str| STRINGS.get(l).and_then(|table| table.get(key)).cloned();
    lookup(locale)
        .or_else(|| lookup("en"))
        .unwrap_or_else(|| key.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_the_locale_and_the_tray_strings() {
        assert_eq!(locale(Language::Auto, "pt-BR"), "pt-BR");
        assert_eq!(locale(Language::Auto, "pt-PT"), "pt-BR");
        assert_eq!(locale(Language::Auto, "de-DE"), "en");
        assert_eq!(locale(Language::En, "pt-BR"), "en");
        assert_eq!(t("pt-BR", "tray.quit"), "Sair do Islet");
        assert_eq!(t("en", "tray.quit"), "Quit Islet");
        assert_eq!(t("en", "no.such.key"), "no.such.key");
        for key in [
            "tray.connected",
            "tray.disconnected",
            "tray.finish_setup",
            "tray.demo",
            "tray.settings",
            "tray.onboarding",
            "shortcut.unavailable",
        ] {
            assert_ne!(t("pt-BR", key), key);
        }
    }
}
