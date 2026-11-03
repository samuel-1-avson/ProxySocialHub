//! "A newer version is available": comparing this app's version with the newest installer
//! ProxyHubb has published, and the notice the window shows.
//!
//! The app does not update itself (decided: an unsigned self-updater is a supply-chain risk until
//! signing exists). It only says a newer installer exists and opens the download page.
//!
//! Wrongly claiming an update is worse than missing one, so anything that is not a plain
//! `major.minor.patch` on both sides is "no update".

use serde::{Deserialize, Serialize};

use crate::account::first_json;

/// What `provider-node latest-release --package desktop --json` prints. `provider-node`'s
/// `update::latest_release_tests` pin these fields.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct LatestRelease {
    #[serde(default)]
    pub version: String,
}

pub fn parse_latest_release(text: &str) -> Result<LatestRelease, String> {
    first_json(text, "latest-release")
}

/// `1.2.3` -> `[1, 2, 3]`. A leading `v` is dropped. Anything else (a pre-release suffix, a
/// missing part, a non-number) is `None`.
fn parse_version(v: &str) -> Option<[u64; 3]> {
    let v = v.trim().trim_start_matches('v');
    let mut parts = v.split('.');
    let mut out = [0u64; 3];
    for slot in &mut out {
        let part = parts.next()?;
        if part.is_empty() || !part.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        *slot = part.parse().ok()?;
    }
    if parts.next().is_some() {
        return None;
    }
    Some(out)
}

/// Is `latest` strictly newer than `current`? `false` when either cannot be read.
pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UpdateNotice {
    pub latest: String,
    pub current: String,
}

/// The notice to show, or `None` when this app is as new as the published installer (or newer,
/// as a build made before it was published is).
pub fn update_notice_for(current: &str, latest: &str) -> Option<UpdateNotice> {
    is_newer(latest, current).then(|| UpdateNotice {
        latest: latest.trim().trim_start_matches('v').to_string(),
        current: current.trim().trim_start_matches('v').to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_newer_installer_is_reported_and_an_equal_or_older_one_is_not() {
        assert!(is_newer("0.1.3", "0.1.2"));
        assert!(is_newer("0.2.0", "0.1.9"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(!is_newer("0.1.2", "0.1.2"), "equal");
        assert!(
            !is_newer("0.1.1", "0.1.2"),
            "older, such as a build made before publishing"
        );
    }

    #[test]
    fn versions_compare_as_numbers_not_as_text() {
        assert!(is_newer("0.1.10", "0.1.9"));
        assert!(!is_newer("0.1.9", "0.1.10"));
        assert!(is_newer("0.10.0", "0.9.0"));
    }

    #[test]
    fn a_leading_v_and_padding_are_ignored() {
        assert!(is_newer(" v0.1.3 ", "v0.1.2"));
        assert!(!is_newer("v0.1.2", "0.1.2"));
    }

    /// Wrongly saying "update available" is worse than missing one.
    #[test]
    fn anything_that_is_not_a_plain_version_is_never_an_update() {
        for bad in [
            "",
            "v",
            "1",
            "1.2",
            "1.2.3.4",
            "1.2.x",
            "1.2.3-beta",
            "latest",
            "1..3",
            "-1.2.3",
        ] {
            assert!(!is_newer(bad, "0.0.1"), "{bad:?} as the latest");
            assert!(!is_newer("9.9.9", bad), "{bad:?} as the current");
        }
    }

    #[test]
    fn the_notice_names_both_versions_without_a_leading_v() {
        assert_eq!(
            update_notice_for("0.1.2", "v0.1.3"),
            Some(UpdateNotice {
                latest: "0.1.3".into(),
                current: "0.1.2".into()
            })
        );
        assert_eq!(update_notice_for("0.1.2", "0.1.2"), None);
        assert_eq!(update_notice_for("0.1.2", "garbage"), None);
    }

    #[test]
    fn the_real_answer_is_read() {
        let text = r#"{"package_type":"desktop","version":"0.1.2","filename":"provider-desktop-0.1.2-windows-amd64.exe"}"#;
        assert_eq!(parse_latest_release(text).unwrap().version, "0.1.2");
        assert!(parse_latest_release("nothing").is_err());
        // A missing version reads as empty, which `is_newer` then refuses.
        assert!(!is_newer(
            &parse_latest_release("{}").unwrap().version,
            "0.0.1"
        ));
    }

    /// The version the app compares is the one the installer is built as: Cargo's and Tauri's
    /// must agree, or the notice would compare against a number nobody installed.
    #[test]
    fn the_apps_own_version_is_the_one_in_its_tauri_config() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["version"], env!("CARGO_PKG_VERSION"));
        assert!(parse_version(env!("CARGO_PKG_VERSION")).is_some());
    }
}
