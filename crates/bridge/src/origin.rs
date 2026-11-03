//! Which extensions may use the native host. Chrome enforces the manifest's `allowed_origins`;
//! the host checks the origin Chrome passes it as well, as defense in depth.

const IDS: &str = include_str!("../extension-ids.txt");

/// The allowed extension IDs, from `extension-ids.txt`.
pub fn allowed_extension_ids() -> impl Iterator<Item = &'static str> {
    IDS.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
}

/// The allowed origins, as Chrome writes them: `chrome-extension://<id>/`.
pub fn allowed_origins() -> Vec<String> {
    allowed_extension_ids().map(origin_of).collect()
}

/// Whether `origin`, the first argument Chrome passes to the host, is an allowed extension.
pub fn is_allowed_origin(origin: &str) -> bool {
    allowed_extension_ids().any(|id| origin == origin_of(id))
}

fn origin_of(id: &str) -> String {
    format!("chrome-extension://{id}/")
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEV_ID: &str = "dhfbcfjjnccdblcpemefndebjeannaam";

    #[test]
    fn every_listed_id_is_well_formed() {
        let ids: Vec<_> = allowed_extension_ids().collect();
        assert!(ids.contains(&DEV_ID));
        for id in ids {
            assert_eq!(id.len(), 32, "{id}");
            assert!(id.bytes().all(|b| (b'a'..=b'p').contains(&b)), "{id}");
        }
    }

    #[test]
    fn accepts_only_exact_allowed_origins() {
        assert!(is_allowed_origin(&format!("chrome-extension://{DEV_ID}/")));
        for origin in [
            "",
            DEV_ID,
            "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
            &format!("chrome-extension://{DEV_ID}"),
            &format!("chrome-extension://{DEV_ID}/x"),
            &format!("https://{DEV_ID}/"),
            &format!(" chrome-extension://{DEV_ID}/"),
        ] {
            assert!(!is_allowed_origin(origin), "{origin:?}");
        }
    }

    #[test]
    fn origins_have_chromes_shape() {
        assert_eq!(allowed_origins(), [format!("chrome-extension://{DEV_ID}/")]);
    }
}
