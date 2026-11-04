//! The provider's own list of blocked sites: how a host is matched, and how the list is saved.
//!
//! Enforced on this computer (`proxy::handler`), before any connection is made, so it holds
//! whatever the gateway or ProxyHubb's servers do. A rule is a site name such as `example.com`
//! and blocks that site and all of its subdomains. A rule without a dot is a legacy text rule
//! and keeps the old "anywhere in the host name" match, so a hand-written `facebook` entry does
//! not silently stop blocking.

use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::path::Path;

/// More than any hand-made list; keeps the config file and the per-connection check small.
pub const MAX_BLOCKED_SITES: usize = 1000;

/// A lowercase site name with at least one dot, from a site name or a full URL. `None` for IP
/// addresses, wildcards and anything that is not a host name.
pub fn normalize_site(raw: &str) -> Option<String> {
    let s = raw.trim().to_ascii_lowercase();
    let s = s
        .strip_prefix("https://")
        .or_else(|| s.strip_prefix("http://"))
        .unwrap_or(&s);
    let host = s.split(['/', '?', '#']).next()?.split(':').next()?.trim_end_matches('.');
    if host.len() > 253 || !host.contains('.') || host.parse::<std::net::IpAddr>().is_ok() {
        return None;
    }
    let labels: Vec<&str> = host.split('.').collect();
    let valid_label = |l: &&str| {
        !l.is_empty()
            && l.len() <= 63
            && !l.starts_with('-')
            && !l.ends_with('-')
            && l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    };
    let tld = labels.last()?;
    if !labels.iter().all(valid_label) || !tld.bytes().any(|b| b.is_ascii_alphabetic()) {
        return None;
    }
    Some(host.to_string())
}

/// True when `host` is blocked by `rule`.
pub fn host_matches(host: &str, rule: &str) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    let rule = rule.trim().trim_end_matches('.').to_ascii_lowercase();
    if rule.is_empty() {
        return false;
    }
    if !rule.contains('.') {
        return host.contains(&rule);
    }
    host == rule || host.ends_with(&format!(".{rule}"))
}

#[derive(Debug, Serialize, PartialEq)]
pub struct SetReport {
    pub config_path: String,
    pub blocked_hosts: Vec<String>,
    /// Entries left out because they are not site names (shown back, never silently dropped).
    pub rejected: Vec<String>,
    /// More than `MAX_BLOCKED_SITES` site names were given; the rest were left out.
    pub truncated: bool,
    pub changed: bool,
}

/// Normalise, de-duplicate and cap a list of entries.
pub fn clean_list(entries: &[String]) -> (Vec<String>, Vec<String>, bool) {
    let mut hosts: Vec<String> = Vec::new();
    let mut rejected: Vec<String> = Vec::new();
    for raw in entries {
        if raw.trim().is_empty() {
            continue;
        }
        match normalize_site(raw) {
            Some(h) if !hosts.contains(&h) => hosts.push(h),
            Some(_) => {}
            None => rejected.push(raw.trim().chars().take(80).collect()),
        }
    }
    let truncated = hosts.len() > MAX_BLOCKED_SITES;
    hosts.truncate(MAX_BLOCKED_SITES);
    (hosts, rejected, truncated)
}

/// Replace `blocked_hosts` in the config file with `entries`, changing no other setting.
///
/// The file is parsed as a table so settings this build does not know are kept; comments are
/// not. The result must still load as a `Config` before it is written. Refuses when there is no
/// config file yet: a node that is not connected to an account has nothing to protect.
pub fn set(config_path: &Path, entries: &[String]) -> Result<SetReport> {
    let text = match std::fs::read_to_string(config_path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            bail!("This computer is not connected to an account yet ({} does not exist).", config_path.display())
        }
        Err(e) => return Err(e).with_context(|| format!("Failed to read {}", config_path.display())),
    };
    let mut table: toml::Table = toml::from_str(&text).with_context(|| format!("{} is not valid TOML", config_path.display()))?;
    let before: Vec<String> = table
        .get("blocked_hosts")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    let (hosts, rejected, truncated) = clean_list(entries);
    let changed = before != hosts;
    if changed {
        table.insert(
            "blocked_hosts".to_string(),
            toml::Value::Array(hosts.iter().cloned().map(toml::Value::String).collect()),
        );
        let body = toml::to_string_pretty(&table)?;
        toml::from_str::<crate::config::Config>(&body).context("The new settings would not load; nothing was written")?;
        crate::config::write_private(config_path, &body)
            .with_context(|| format!("Failed to write {}", config_path.display()))?;
    }
    Ok(SetReport {
        config_path: config_path.display().to_string(),
        blocked_hosts: hosts,
        rejected,
        truncated,
        changed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    /// A fresh scratch directory, removed when dropped.
    struct Scratch(PathBuf);
    impl Scratch {
        fn new(label: &str) -> Self {
            static N: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir().join(format!(
                "phub-blocked-{label}-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::SeqCst)
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn site_names_are_normalised_and_junk_is_refused() {
        assert_eq!(normalize_site("https://Shop.Example.com/path?q=1").as_deref(), Some("shop.example.com"));
        assert_eq!(normalize_site("bet365.com:443").as_deref(), Some("bet365.com"));
        assert_eq!(normalize_site("example.org.").as_deref(), Some("example.org"));
        for bad in ["10.0.0.1", "*.example.com", "localhost", "not a host", "", "-x.com", "a..b", "example.123"] {
            assert_eq!(normalize_site(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_site_rule_blocks_the_site_and_its_subdomains_only() {
        assert!(host_matches("facebook.com", "facebook.com"));
        assert!(host_matches("m.facebook.com", "facebook.com"));
        assert!(host_matches("WWW.FACEBOOK.COM.", "facebook.com"));
        assert!(!host_matches("notfacebook.com", "facebook.com"));
        assert!(!host_matches("facebook.com.evil.example", "facebook.com"));
    }

    #[test]
    fn a_legacy_rule_without_a_dot_keeps_matching_anywhere_in_the_host() {
        assert!(host_matches("www.facebook.com", "facebook"));
        assert!(host_matches("notfacebook.example", "facebook"));
        assert!(!host_matches("example.com", ""));
    }

    #[test]
    fn lists_are_deduplicated_capped_and_rejections_reported() {
        let (hosts, rejected, truncated) = clean_list(&s(&["Example.com", "https://example.com/x", "10.0.0.1", " ", "bet365.com"]));
        assert_eq!(hosts, s(&["example.com", "bet365.com"]));
        assert_eq!(rejected, s(&["10.0.0.1"]));
        assert!(!truncated);
        let many: Vec<String> = (0..MAX_BLOCKED_SITES + 5).map(|i| format!("site{i}.example.com")).collect();
        let (hosts, _, truncated) = clean_list(&many);
        assert_eq!(hosts.len(), MAX_BLOCKED_SITES);
        assert!(truncated);
    }

    #[test]
    fn set_changes_only_blocked_hosts_and_keeps_other_settings() {
        let dir = Scratch::new("set");
        let path = dir.path().join("provider.toml");
        std::fs::write(
            &path,
            "# a comment\ncontrol_api_url = \"https://api.example.test\"\napi_key = \"pt_secret\"\nmax_connections = 7\nfuture_setting = \"kept\"\nblocked_hosts = [\"old.example\"]\n",
        )
        .unwrap();
        let report = set(&path, &s(&["https://Bet365.com/x", "pornhub.com", "1.2.3.4"])).unwrap();
        assert!(report.changed);
        assert_eq!(report.blocked_hosts, s(&["bet365.com", "pornhub.com"]));
        assert_eq!(report.rejected, s(&["1.2.3.4"]));

        let saved: toml::Table = toml::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved["api_key"].as_str(), Some("pt_secret"));
        assert_eq!(saved["max_connections"].as_integer(), Some(7));
        assert_eq!(saved["future_setting"].as_str(), Some("kept"));
        let cfg = crate::config::Config::load(path.to_str().unwrap()).unwrap();
        assert_eq!(cfg.blocked_hosts, s(&["bet365.com", "pornhub.com"]));

        let again = set(&path, &s(&["bet365.com", "pornhub.com"])).unwrap();
        assert!(!again.changed);
        let cleared = set(&path, &[]).unwrap();
        assert!(cleared.changed && cleared.blocked_hosts.is_empty());
    }

    #[test]
    fn set_refuses_without_a_config_file_and_leaves_a_broken_one_alone() {
        let dir = Scratch::new("set");
        let missing = dir.path().join("provider.toml");
        assert!(set(&missing, &s(&["example.com"])).unwrap_err().to_string().contains("not connected"));
        assert!(!missing.exists());

        let broken = dir.path().join("broken.toml");
        std::fs::write(&broken, "this is = = not toml").unwrap();
        assert!(set(&broken, &s(&["example.com"])).is_err());
        assert_eq!(std::fs::read_to_string(&broken).unwrap(), "this is = = not toml");
    }
}
