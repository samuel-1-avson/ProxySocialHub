//! Auto-adopt a freshly downloaded `provider.toml` into the canonical config path.
//!
//! Non-technical Windows users often click "Download provider.toml" and leave it in
//! Downloads while `provider-node` reads `%APPDATA%\proxyhubb\provider.toml`. When the
//! Downloads copy is newer / has a different node_id / has an api_key and the canonical
//! file is missing or stale, we copy it automatically before start/doctor.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use tracing::info;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdoptResult {
    pub from: PathBuf,
    pub to: PathBuf,
    pub reason: String,
}

/// If a downloaded dashboard config should replace `canonical`, copy it and return Some.
pub fn maybe_adopt_downloaded_config(canonical: &Path) -> Option<AdoptResult> {
    let candidate = find_best_download_candidate()?;
    if !should_adopt(canonical, &candidate) {
        return None;
    }
    if let Some(parent) = canonical.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::copy(&candidate, canonical).ok()?;
    let reason = adopt_reason(canonical, &candidate);
    info!(
        from = %candidate.display(),
        to = %canonical.display(),
        %reason,
        "Adopted provider.toml from Downloads into canonical config path"
    );
    Some(AdoptResult {
        from: candidate,
        to: canonical.to_path_buf(),
        reason,
    })
}

fn find_best_download_candidate() -> Option<PathBuf> {
    let downloads = dirs::download_dir()?;
    let mut best: Option<(SystemTime, PathBuf)> = None;

    let entries = fs::read_dir(&downloads).ok()?;
    for ent in entries.flatten() {
        let path = ent.path();
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        // provider.toml, provider (1).toml, provider-f248c4f3.toml
        if !(name == "provider.toml" || (name.starts_with("provider") && name.ends_with(".toml"))) {
            continue;
        }
        let Ok(meta) = ent.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let Ok(contents) = fs::read_to_string(&path) else {
            continue;
        };
        if extract_toml_string(&contents, "api_key").is_none() {
            continue;
        }
        let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        match &best {
            None => best = Some((mtime, path)),
            Some((best_mtime, _)) if mtime > *best_mtime => best = Some((mtime, path)),
            _ => {}
        }
    }
    best.map(|(_, p)| p)
}

fn should_adopt(canonical: &Path, candidate: &Path) -> bool {
    let Ok(cand_body) = fs::read_to_string(candidate) else {
        return false;
    };
    let Some(cand_key) = extract_toml_string(&cand_body, "api_key") else {
        return false;
    };
    if cand_key.is_empty() {
        return false;
    }

    if !canonical.exists() {
        return true;
    }

    let Ok(canon_body) = fs::read_to_string(canonical) else {
        return true;
    };
    let canon_key = extract_toml_string(&canon_body, "api_key").unwrap_or_default();
    let cand_node = extract_toml_string(&cand_body, "node_id").unwrap_or_default();
    let canon_node = extract_toml_string(&canon_body, "node_id").unwrap_or_default();

    if !cand_node.is_empty() && cand_node != canon_node {
        return true;
    }
    if !cand_key.is_empty() && cand_key != canon_key {
        return true;
    }

    let cand_mtime = fs::metadata(candidate)
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let canon_mtime = fs::metadata(canonical)
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);
    cand_mtime > canon_mtime
}

fn adopt_reason(canonical: &Path, candidate: &Path) -> String {
    if !canonical.exists() {
        return "canonical config missing".into();
    }
    let cand = fs::read_to_string(candidate).unwrap_or_default();
    let canon = fs::read_to_string(canonical).unwrap_or_default();
    let cand_node = extract_toml_string(&cand, "node_id").unwrap_or_default();
    let canon_node = extract_toml_string(&canon, "node_id").unwrap_or_default();
    if cand_node != canon_node {
        return format!("Downloads node_id {cand_node} differs from AppData {canon_node}");
    }
    "Downloads provider.toml is newer than AppData copy".into()
}

/// Minimal TOML string extractor (handles `key = "value"`).
fn extract_toml_string(body: &str, key: &str) -> Option<String> {
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        let Some((k, rest)) = trimmed.split_once('=') else {
            continue;
        };
        if k.trim() != key {
            continue;
        }
        let v = rest.trim();
        if let Some(inner) = v.strip_prefix('"').and_then(|s| s.strip_suffix('"')) {
            let s = inner.trim();
            if s.is_empty() {
                return None;
            }
            return Some(s.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn extracts_quoted_toml_strings() {
        let body = r#"
node_id = "abc-123"
api_key = "secret-token"
jwt_token = ""
"#;
        assert_eq!(
            extract_toml_string(body, "node_id").as_deref(),
            Some("abc-123")
        );
        assert_eq!(
            extract_toml_string(body, "api_key").as_deref(),
            Some("secret-token")
        );
        assert!(extract_toml_string(body, "jwt_token").is_none());
    }

    #[test]
    fn adopts_when_node_id_differs() {
        let dir = std::env::temp_dir().join(format!("ph-adopt-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let canon = dir.join("appdata-provider.toml");
        let cand = dir.join("downloads-provider.toml");
        fs::write(
            &canon,
            "node_id = \"old\"\napi_key = \"old-key-old-key-old-key-old-key-old\"\n",
        )
        .unwrap();
        fs::write(
            &cand,
            "node_id = \"new\"\napi_key = \"new-key-new-key-new-key-new-key-new\"\n",
        )
        .unwrap();
        assert!(should_adopt(&canon, &cand));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn skips_when_identical() {
        let dir = std::env::temp_dir().join(format!("ph-adopt2-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let canon = dir.join("a.toml");
        let cand = dir.join("b.toml");
        let body = "node_id = \"same\"\napi_key = \"same-key-same-key-same-key-same\"\n";
        fs::write(&canon, body).unwrap();
        // Ensure candidate is not newer.
        std::thread::sleep(std::time::Duration::from_millis(20));
        let mut f = fs::File::create(&cand).unwrap();
        f.write_all(body.as_bytes()).unwrap();
        // Touch canonical to be newer
        let mut f2 = fs::File::create(&canon).unwrap();
        f2.write_all(body.as_bytes()).unwrap();
        assert!(!should_adopt(&canon, &cand));
        let _ = fs::remove_dir_all(&dir);
    }
}
