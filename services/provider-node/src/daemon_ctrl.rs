//! Background daemon lifecycle helpers for the interactive console / TUI.
//!
//! Operators want the tunnel running while they use the dashboard in the same
//! CLI window. `start` remains a foreground command for services; these helpers
//! spawn a detached `provider-node start` child instead.

use crate::config::Config;
use crate::paths;
use crate::process_util;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tokio::time::sleep;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DaemonEnsureResult {
    AlreadyRunning { pid: u32 },
    Started { pid: u32 },
}

/// Ensure a provider-node daemon is running for `config`.
///
/// If a live PID file exists, returns immediately. Otherwise spawns
/// `provider-node start --config …` detached and waits briefly for the PID file.
pub async fn ensure_running(config: &Path) -> anyhow::Result<DaemonEnsureResult> {
    let _ = crate::config_adopt::maybe_adopt_downloaded_config(config);
    if !config.is_file() {
        anyhow::bail!(
            "config not found at {} — open Dashboard → My nodes → Connect and click Setup this PC",
            config.display()
        );
    }

    paths::ensure_state_dirs()?;

    if let Some(pid) =
        process_util::read_pid_file().filter(|&p| process_util::provider_process_alive(p))
    {
        return Ok(DaemonEnsureResult::AlreadyRunning { pid });
    }
    let _ = process_util::remove_stale_pid_file();

    spawn_detached(config)?;

    let pid = wait_for_pid(Duration::from_secs(20)).await.ok_or_else(|| {
        anyhow::anyhow!(
            "daemon did not write a live PID file — check {}",
            paths::log_file().display()
        )
    })?;

    // Best-effort: give metrics a moment so the TUI can attach.
    let port = Config::load(&config.to_string_lossy())
        .map(|c| c.metrics_port)
        .unwrap_or(9090);
    let _ = wait_for_metrics(port, Duration::from_secs(8)).await;

    Ok(DaemonEnsureResult::Started { pid })
}

pub fn describe(result: DaemonEnsureResult) -> String {
    match result {
        DaemonEnsureResult::AlreadyRunning { pid } => {
            format!("Daemon already running (PID {pid})")
        }
        DaemonEnsureResult::Started { pid } => {
            format!("Daemon started in background (PID {pid})")
        }
    }
}

/// Stop a live daemon if one is present. Returns true if a process was signaled.
pub async fn stop_if_running() -> anyhow::Result<bool> {
    let Some(pid) =
        process_util::read_pid_file().filter(|&p| process_util::provider_process_alive(p))
    else {
        let _ = process_util::remove_stale_pid_file();
        return Ok(false);
    };

    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;
        let _ = kill(Pid::from_raw(pid as i32), Signal::SIGTERM);
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    let deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < deadline {
        if !process_util::process_alive(pid) {
            break;
        }
        sleep(Duration::from_millis(150)).await;
    }
    let _ = process_util::remove_stale_pid_file();
    Ok(true)
}

/// Stop a live daemon if one is present, then start a fresh background daemon.
pub async fn restart(config: &Path) -> anyhow::Result<DaemonEnsureResult> {
    let _ = stop_if_running().await;
    // Brief pause so the old process can release the metrics port / PID file.
    sleep(Duration::from_millis(500)).await;
    ensure_running(config).await
}

fn spawn_detached(config: &Path) -> anyhow::Result<()> {
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("provider-node"));
    let log_path = paths::log_file();
    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    let log_err = log.try_clone()?;

    let mut cmd = Command::new(&exe);
    cmd.arg("start")
        .arg("--config")
        .arg(config)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Detach from this console so the tunnel keeps running when the TUI/console exits.
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                // New session so the daemon survives when the console exits.
                if nix::unistd::setsid().is_err() {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }

    let child = cmd.spawn().map_err(|e| {
        anyhow::anyhow!("failed to spawn background daemon ({}): {e}", exe.display())
    })?;

    paths::append_log(&format!(
        "spawned background daemon pid={} config={}",
        child.id(),
        config.display()
    ));

    Ok(())
}

async fn wait_for_pid(timeout: Duration) -> Option<u32> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Some(pid) =
            process_util::read_pid_file().filter(|&p| process_util::provider_process_alive(p))
        {
            return Some(pid);
        }
        sleep(Duration::from_millis(200)).await;
    }
    None
}

async fn wait_for_metrics(port: u16, timeout: Duration) -> bool {
    let url = format!("http://127.0.0.1:{port}/stats");
    let deadline = Instant::now() + timeout;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1))
        .build()
        .ok();
    let Some(client) = client else {
        return false;
    };
    while Instant::now() < deadline {
        if client
            .get(&url)
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
        {
            return true;
        }
        sleep(Duration::from_millis(250)).await;
    }
    false
}
