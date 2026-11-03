//! `provider-node unpair`: disconnect this computer from its account.
//!
//! The node is stopped, then `provider.toml` (which holds the account key) is MOVED aside, not
//! deleted, so the person can still read it or reconnect from it. The lifetime counters in
//! `stats.json` go with it: they are seeded into the next run, so a computer connected to a
//! different account would otherwise report the old account's totals as its own.
//!
//! This cannot revoke the key on the server: a node token is not allowed to (the owner's session
//! is needed, see `providerTokenPathAllowed` in control-api). The caller says so; the key in the
//! archived file stays valid until the person revokes it in the dashboard or deletes the file.
//!
//! The desktop app (apps/provider-app) runs `unpair --json` and reads `UnpairReport`.

use crate::{daemon_ctrl, paths, process_util, runtime_state};
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    /// The node was stopped (if it ran) and the settings were moved aside.
    Disconnected,
    /// There was no `provider.toml`, so nothing changed.
    NothingToDisconnect,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnpairReport {
    pub outcome: Outcome,
    /// A running node was stopped.
    pub stopped_node: bool,
    /// Where `provider.toml` went. It still holds the account key.
    pub archived_config: Option<String>,
    /// Where the lifetime counters went, when there were any.
    pub archived_stats: Option<String>,
}

/// `<name>.disconnected-<unix>`, or with `-2`, `-3`... when that name is taken, so a second
/// disconnect in the same second can never overwrite the first.
fn archive_path(file: &Path, unix: u64) -> PathBuf {
    let name = file
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    let mut candidate = file.with_file_name(format!("{name}.disconnected-{unix}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = file.with_file_name(format!("{name}.disconnected-{unix}-{n}"));
        n += 1;
    }
    candidate
}

/// Move `config` and `stats` aside. The config moves first and its failure is the failure of the
/// whole call (nothing has changed then); a counters file that cannot be moved only means the
/// next run starts from the old totals, which is reported as "no archived stats", not an error.
pub fn archive_files(config: &Path, stats: &Path, unix: u64) -> Result<UnpairReport> {
    if !config.is_file() {
        return Ok(UnpairReport {
            outcome: Outcome::NothingToDisconnect,
            stopped_node: false,
            archived_config: None,
            archived_stats: None,
        });
    }
    let archived_config = archive_path(config, unix);
    std::fs::rename(config, &archived_config)
        .map_err(|e| anyhow::anyhow!("could not move {} aside: {e}", config.display()))?;

    let archived_stats = if stats.is_file() {
        let target = archive_path(stats, unix);
        std::fs::rename(stats, &target).ok().map(|_| target)
    } else {
        None
    };

    Ok(UnpairReport {
        outcome: Outcome::Disconnected,
        stopped_node: false,
        archived_config: Some(archived_config.to_string_lossy().into_owned()),
        archived_stats: archived_stats.map(|p| p.to_string_lossy().into_owned()),
    })
}

/// Stop the node, check that it really stopped, then move the settings aside. If the node will
/// not stop, nothing is moved: archiving the key out from under a running node would leave it
/// connected with no way to see or stop it from its settings.
pub async fn run(config_path: PathBuf) -> Result<UnpairReport> {
    if !config_path.is_file() {
        return archive_files(
            &config_path,
            &paths::stats_file(),
            runtime_state::unix_now(),
        );
    }
    let pid_before =
        process_util::read_pid_file().filter(|&p| process_util::provider_process_alive(p));
    let stopped = daemon_ctrl::stop_if_running().await?;
    if let Some(pid) = pid_before {
        if process_util::process_alive(pid) {
            bail!("the node did not stop in time, so nothing was changed");
        }
    }
    let mut report = archive_files(
        &config_path,
        &paths::stats_file(),
        runtime_state::unix_now(),
    )?;
    report.stopped_node = stopped;
    Ok(report)
}

pub fn print_human(report: &UnpairReport) {
    match report.outcome {
        Outcome::NothingToDisconnect => {
            println!("This computer is not connected to an account (no provider.toml).");
        }
        Outcome::Disconnected => {
            if report.stopped_node {
                println!("The node was stopped.");
            }
            if let Some(path) = &report.archived_config {
                println!("Settings moved to {path}");
                println!("That file still holds this computer's key. Delete it when you no longer need it.");
            }
            println!();
            println!("The key is NOT revoked yet. In your dashboard, open Tokens and revoke the token named");
            println!("\"Paired: <this computer's name>\"; until you do, anyone with the old file can use it.");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    struct Dir(PathBuf);
    impl Dir {
        fn new() -> Self {
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let dir = std::env::temp_dir()
                .join(format!("provider-node-unpair-{}-{n}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            Dir(dir)
        }
        fn file(&self, name: &str, contents: &str) -> PathBuf {
            let p = self.0.join(name);
            std::fs::write(&p, contents).unwrap();
            p
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn the_settings_and_counters_are_moved_aside_and_kept_byte_for_byte() {
        let d = Dir::new();
        let config = d.file("provider.toml", "api_key = \"SECRET\"\nnode_id = \"n\"\n");
        let stats = d.file("stats.json", "{\"bytes_up\":5}");

        let r = archive_files(&config, &stats, 1_700_000_000).unwrap();
        assert_eq!(r.outcome, Outcome::Disconnected);
        assert!(
            !config.exists() && !stats.exists(),
            "the originals are gone"
        );

        let cfg_archive = PathBuf::from(r.archived_config.unwrap());
        let stats_archive = PathBuf::from(r.archived_stats.unwrap());
        assert_eq!(
            cfg_archive.file_name().unwrap().to_string_lossy(),
            "provider.toml.disconnected-1700000000"
        );
        // Kept, not deleted: the person can still read or reuse what they had.
        assert_eq!(
            std::fs::read_to_string(cfg_archive).unwrap(),
            "api_key = \"SECRET\"\nnode_id = \"n\"\n"
        );
        assert_eq!(
            std::fs::read_to_string(stats_archive).unwrap(),
            "{\"bytes_up\":5}"
        );
    }

    #[test]
    fn a_computer_that_never_counted_anything_has_no_stats_to_move() {
        let d = Dir::new();
        let config = d.file("provider.toml", "x = 1");
        let r = archive_files(&config, &d.0.join("stats.json"), 1).unwrap();
        assert_eq!(r.outcome, Outcome::Disconnected);
        assert!(r.archived_config.is_some() && r.archived_stats.is_none());
    }

    #[test]
    fn with_no_settings_file_nothing_is_changed_or_created() {
        let d = Dir::new();
        let stats = d.file("stats.json", "{}");
        let r = archive_files(&d.0.join("provider.toml"), &stats, 1).unwrap();
        assert_eq!(r.outcome, Outcome::NothingToDisconnect);
        assert!(r.archived_config.is_none() && r.archived_stats.is_none());
        assert!(
            stats.exists(),
            "the counters are only moved together with the settings"
        );
        assert_eq!(std::fs::read_dir(&d.0).unwrap().count(), 1);
    }

    /// Two disconnects in the same second must not overwrite each other: the first archive holds a
    /// key the person may still want.
    #[test]
    fn a_second_archive_in_the_same_second_never_overwrites_the_first() {
        let d = Dir::new();
        let config = d.file("provider.toml", "first");
        let first = archive_files(&config, &d.0.join("stats.json"), 7).unwrap();
        d.file("provider.toml", "second");
        let second = archive_files(&config, &d.0.join("stats.json"), 7).unwrap();

        let a = PathBuf::from(first.archived_config.unwrap());
        let b = PathBuf::from(second.archived_config.unwrap());
        assert_ne!(a, b);
        assert_eq!(std::fs::read_to_string(a).unwrap(), "first");
        assert_eq!(std::fs::read_to_string(b).unwrap(), "second");
    }

    #[test]
    fn the_report_is_the_json_the_desktop_app_reads() {
        let v = serde_json::to_value(UnpairReport {
            outcome: Outcome::Disconnected,
            stopped_node: true,
            archived_config: Some("C:/p/provider.toml.disconnected-1".into()),
            archived_stats: None,
        })
        .unwrap();
        assert_eq!(v["outcome"], "disconnected");
        assert_eq!(v["stopped_node"], true);
        assert_eq!(v["archived_config"], "C:/p/provider.toml.disconnected-1");
        assert!(v["archived_stats"].is_null());
        let none = serde_json::to_value(UnpairReport {
            outcome: Outcome::NothingToDisconnect,
            stopped_node: false,
            archived_config: None,
            archived_stats: None,
        })
        .unwrap();
        assert_eq!(none["outcome"], "nothing_to_disconnect");
    }
}
