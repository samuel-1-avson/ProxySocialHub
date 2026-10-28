//! The app's own persisted choices: consent, and whether the user wants to share.
//!
//! Everything else (the node's identity, keys, gateway) lives in `provider.toml` and is owned
//! by `provider-node`; this file never duplicates it, so the app and the CLI cannot disagree.

use serde::{Deserialize, Serialize};
use std::io;
use std::path::Path;

pub const FILE_NAME: &str = "settings.json";

/// Bump when the consent text changes. Everyone is asked again, because an older answer
/// was an answer to older wording.
pub const CONSENT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Consent {
    pub version: u32,
    pub accepted_at_unix: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub consent: Option<Consent>,
    /// The user's wish: share whenever the app runs. Pause sets it to false; Quit leaves it
    /// alone, so the next launch resumes what they had.
    #[serde(default)]
    pub sharing_wanted: bool,
}

impl Settings {
    /// True only for consent given to the *current* wording.
    pub fn consent_is_current(&self) -> bool {
        matches!(&self.consent, Some(c) if c.version == CONSENT_VERSION)
    }

    pub fn accept_consent(&mut self, now_unix: u64) {
        self.consent = Some(Consent {
            version: CONSENT_VERSION,
            accepted_at_unix: now_unix,
        });
    }
}

/// Load settings from `dir`. A missing or unreadable file means "nothing agreed yet": it can
/// only ever fall back to *less* permission (no consent, not sharing), never more.
pub fn load(dir: &Path) -> Settings {
    std::fs::read_to_string(dir.join(FILE_NAME))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Write settings atomically: a crash mid-write must not leave a half file that reads as
/// something else.
pub fn save(dir: &Path, settings: &Settings) -> io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{FILE_NAME}.tmp"));
    let body = serde_json::to_string_pretty(settings)?;
    std::fs::write(&tmp, body)?;
    std::fs::rename(&tmp, dir.join(FILE_NAME))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A fresh directory under the OS temp dir, removed when dropped.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let dir = std::env::temp_dir().join(format!(
                "provider-app-test-{label}-{}-{nanos}",
                std::process::id()
            ));
            TempDir(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_new_install_has_no_consent_and_is_not_sharing() {
        let dir = TempDir::new("fresh");
        let s = load(&dir.0);
        assert_eq!(s, Settings::default());
        assert!(!s.consent_is_current());
        assert!(!s.sharing_wanted);
    }

    #[test]
    fn settings_survive_a_round_trip() {
        let dir = TempDir::new("roundtrip");
        let mut s = Settings::default();
        s.accept_consent(1_700_000_000);
        s.sharing_wanted = true;
        save(&dir.0, &s).unwrap();
        assert_eq!(load(&dir.0), s);
        assert!(load(&dir.0).consent_is_current());
    }

    #[test]
    fn consent_to_older_wording_is_not_current() {
        let s = Settings {
            consent: Some(Consent {
                version: CONSENT_VERSION - 1,
                accepted_at_unix: 1,
            }),
            sharing_wanted: true,
        };
        assert!(!s.consent_is_current(), "a bumped version must re-ask");
    }

    #[test]
    fn consent_to_newer_wording_is_not_trusted_either() {
        // An older build reading a newer file must not treat it as agreement to its own text.
        let s = Settings {
            consent: Some(Consent {
                version: CONSENT_VERSION + 1,
                accepted_at_unix: 1,
            }),
            sharing_wanted: false,
        };
        assert!(!s.consent_is_current());
    }

    #[test]
    fn a_corrupt_file_falls_back_to_no_consent_never_to_accepted() {
        let dir = TempDir::new("corrupt");
        std::fs::create_dir_all(&dir.0).unwrap();
        for garbage in ["", "{", "not json", "[1,2,3]", r#"{"consent": "yes"}"#] {
            std::fs::write(dir.0.join(FILE_NAME), garbage).unwrap();
            let s = load(&dir.0);
            assert!(
                !s.consent_is_current(),
                "{garbage:?} must not count as consent"
            );
            assert!(!s.sharing_wanted, "{garbage:?} must not turn sharing on");
        }
    }

    #[test]
    fn unknown_and_missing_fields_are_tolerated() {
        let dir = TempDir::new("tolerant");
        std::fs::create_dir_all(&dir.0).unwrap();
        std::fs::write(dir.0.join(FILE_NAME), r#"{"from_the_future": 1}"#).unwrap();
        assert_eq!(load(&dir.0), Settings::default());
    }

    #[test]
    fn saving_creates_the_directory_and_leaves_no_temp_file() {
        let dir = TempDir::new("atomic");
        let nested = dir.0.join("a").join("b");
        save(&nested, &Settings::default()).unwrap();
        assert!(nested.join(FILE_NAME).is_file());
        assert!(!nested.join(format!("{FILE_NAME}.tmp")).exists());
    }

    #[test]
    fn saving_over_an_existing_file_replaces_it() {
        let dir = TempDir::new("overwrite");
        let mut s = Settings::default();
        save(&dir.0, &s).unwrap();
        s.sharing_wanted = true;
        save(&dir.0, &s).unwrap();
        assert!(load(&dir.0).sharing_wanted);
    }
}
