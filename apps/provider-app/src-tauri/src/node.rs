//! Drives the bundled `provider-node`. Only fixed subcommands are ever run: nothing the
//! webview sends is turned into an argument, so a compromised page cannot make this run
//! anything else.
//!
//! The parsing here is deliberately pure (text in, values out) so it is tested without a
//! node; process spawning is covered by the end-to-end run.

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Deserialize;

use crate::account::{parse_account, AccountFacts};
use crate::app_update::parse_latest_release;
use crate::diagnosis::{findings_from, parse_explain, Diagnosis, DoctorExplained};
use crate::disconnect::{friendly_unpair_error, parse_unpair, DisconnectResult};
use crate::node_settings::{parse_node_settings, NodeSettings};
use crate::rules::{parse_draft, parse_set, BlockedSitesReport, RulesDraft};
use crate::state::{Metrics, NodeFacts, RetryFacts};

/// The only place the app sends a person's browser.
const ALLOWED_LINK_PREFIX: &str = "https://proxyhubb.com/";

/// The node gives up on a hung server after 30 s by itself; this only bounds a process that
/// never returns, so a refresh can never hang the app.
const ACCOUNT_TIMEOUT: Duration = Duration::from_secs(45);
/// The doctor probes the network, each probe with its own timeout, one after another.
const DOCTOR_TIMEOUT: Duration = Duration::from_secs(90);
/// The support file runs the same checks, then reads the logs.
const BUNDLE_TIMEOUT: Duration = Duration::from_secs(120);
/// `unpair` waits up to 8 s for the node to stop, then moves two files.
const UNPAIR_TIMEOUT: Duration = Duration::from_secs(60);
/// Reading a settings file; nothing on the network.
const SETTINGS_TIMEOUT: Duration = Duration::from_secs(15);
/// One small request; the node gives up on its own after 20 s.
const LATEST_TIMEOUT: Duration = Duration::from_secs(30);
/// The rules assistant asks a model (10-25 s); the node gives up on its own after 75 s.
const RULES_DRAFT_TIMEOUT: Duration = Duration::from_secs(90);
/// `doctor --explain` runs the whole doctor first, then waits for the model.
const DOCTOR_EXPLAIN_TIMEOUT: Duration = Duration::from_secs(180);

/// How long `start --background` may take. It normally returns in about a second and waits at
/// most 20 s for the node to write its PID file; this only bounds a starter that never returns,
/// so a Resume can never hang.
const START_TIMEOUT: Duration = Duration::from_secs(45);

/// A console program started from a GUI app would flash a console window on Windows.
pub fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// The `provider-node` shipped next to this executable. Tauri copies `externalBin` entries
/// there without the target-triple suffix.
pub fn locate_sidecar() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe
        .parent()
        .ok_or("the app executable has no parent directory")?;
    let name = if cfg!(windows) {
        "provider-node.exe"
    } else {
        "provider-node"
    };
    let path = dir.join(name);
    if path.is_file() {
        Ok(path)
    } else {
        Err(format!(
            "bundled provider-node not found at {}",
            path.display()
        ))
    }
}

// ── status ───────────────────────────────────────────────────────────────────

// Only the fields the app reads; `provider-node`'s `status::contract_tests` pins them.
#[derive(Debug, Deserialize)]
struct StatusJson {
    #[serde(default)]
    config_path: String,
    process: ProcessJson,
    #[serde(default)]
    metrics: Option<MetricsJson>,
    #[serde(default)]
    runtime: Option<RuntimeJson>,
}

#[derive(Debug, Deserialize)]
struct ProcessJson {
    running: bool,
    #[serde(default)]
    pid: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct MetricsJson {
    #[serde(default)]
    uptime_seconds: u64,
    #[serde(default)]
    bytes_up: u64,
    #[serde(default)]
    bytes_down: u64,
    #[serde(default)]
    active_connections: i32,
    #[serde(default)]
    rate_up_kbps: u32,
    #[serde(default)]
    rate_down_kbps: u32,
    #[serde(default)]
    total_connections: u64,
    #[serde(default)]
    failed_connections: u64,
    #[serde(default)]
    latency_ms: u64,
}

#[derive(Debug, Deserialize)]
struct RuntimeJson {
    #[serde(default)]
    tunnel_connected: bool,
    #[serde(default)]
    last_session_error: Option<String>,
    #[serde(default)]
    active_gateway: String,
    #[serde(default)]
    gateway_index: u32,
    #[serde(default)]
    gateway_total: u32,
    #[serde(default)]
    updated_at_unix: u64,
}

/// Turn `provider-node status --json --local` output into facts. `config_exists` answers
/// whether the path the node reported is a file, so the app never has to know where the
/// node keeps its config.
pub fn parse_status(
    text: &str,
    config_exists: impl Fn(&Path) -> bool,
) -> Result<NodeFacts, String> {
    // The report is a JSON object; tolerate anything printed before it.
    let start = text
        .find('{')
        .ok_or("provider-node status printed no JSON")?;
    let status: StatusJson = serde_json::from_str(&text[start..])
        .map_err(|e| format!("could not read provider-node status: {e}"))?;

    let tunnel_connected = status
        .runtime
        .as_ref()
        .map(|r| r.tunnel_connected)
        .unwrap_or(false);
    // runtime.json can be stale after a crash; the error is only meaningful while we are
    // trying to connect, and `derive_state` ignores the tunnel flag unless the node runs.
    let last_error = status
        .runtime
        .as_ref()
        .filter(|_| !tunnel_connected)
        .and_then(|r| r.last_session_error.clone())
        .filter(|e| !e.trim().is_empty());
    // Retry context rides with the error: only a sidecar new enough to report the
    // rotation (gateway_total > 0) yields it, so old output degrades to detail-only.
    let retry = status
        .runtime
        .as_ref()
        .filter(|_| !tunnel_connected)
        .filter(|r| r.gateway_total > 0)
        .map(|r| RetryFacts {
            active_gateway: r.active_gateway.clone(),
            gateway_index: r.gateway_index,
            gateway_total: r.gateway_total,
            updated_at_unix: r.updated_at_unix,
        });

    Ok(NodeFacts {
        config_present: !status.config_path.is_empty()
            && config_exists(Path::new(&status.config_path)),
        process_running: status.process.running,
        tunnel_connected,
        last_error,
        node_pid: status.process.pid,
        start_failed: None,
        metrics: status.metrics.map(|m| Metrics {
            uptime_seconds: m.uptime_seconds,
            bytes_up: m.bytes_up,
            bytes_down: m.bytes_down,
            active_connections: m.active_connections,
            rate_up_kbps: m.rate_up_kbps,
            rate_down_kbps: m.rate_down_kbps,
            total_connections: m.total_connections,
            failed_connections: m.failed_connections,
            latency_ms: m.latency_ms,
        }),
        // The engine marks adopted nodes; parsing alone cannot know who started what.
        externally_started: false,
        retry,
    })
}

// ── pairing events ───────────────────────────────────────────────────────────

/// One line of `provider-node pair --json`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PairEvent {
    Code {
        user_code: String,
        link: String,
        expires_in: u64,
    },
    Approved {
        node_id: String,
    },
    Denied,
    Expired,
    Error(String),
}

#[derive(Debug, Deserialize)]
struct EventJson {
    event: String,
    #[serde(default)]
    user_code: String,
    #[serde(default)]
    link: String,
    #[serde(default)]
    expires_in: u64,
    #[serde(default)]
    node_id: String,
    #[serde(default)]
    message: String,
}

/// Parse one stdout line. Anything that is not a recognised event is ignored: the stream is a
/// contract, but a stray line must never be able to fake an approval.
pub fn parse_event_line(line: &str) -> Option<PairEvent> {
    let e: EventJson = serde_json::from_str(line.trim()).ok()?;
    match e.event.as_str() {
        "code" if !e.user_code.is_empty() && !e.link.is_empty() => Some(PairEvent::Code {
            user_code: e.user_code,
            link: e.link,
            expires_in: e.expires_in,
        }),
        "approved" if !e.node_id.is_empty() => Some(PairEvent::Approved { node_id: e.node_id }),
        "denied" => Some(PairEvent::Denied),
        "expired" => Some(PairEvent::Expired),
        "error" => Some(PairEvent::Error(if e.message.is_empty() {
            "pairing failed".to_string()
        } else {
            e.message
        })),
        _ => None,
    }
}

impl PairEvent {
    /// Denied, expired and error end the pairing; approved does too, once the config is saved.
    pub fn is_terminal(&self) -> bool {
        !matches!(self, PairEvent::Code { .. })
    }
}

/// Only links to the ProxyHubb dashboard may be opened from the app.
pub fn is_allowed_link(link: &str) -> bool {
    link.starts_with(ALLOWED_LINK_PREFIX)
        && link.len() <= 2048
        && link
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._~:/?#[]@!$&'()*+,;=%".contains(c))
}

/// Plain-language reasons for the node failing to start. The raw text goes to the log, not
/// to the person.
pub fn friendly_start_error(stderr: &str) -> String {
    let s = stderr.to_ascii_lowercase();
    if s.contains("config not found") {
        "This computer is not connected to an account yet.".to_string()
    } else if s.contains("did not write a live pid file") {
        "The node did not start. Please try again.".to_string()
    } else if s.contains("failed to spawn") {
        "The node could not be launched on this computer.".to_string()
    } else {
        "The node could not start. Please try again.".to_string()
    }
}

/// Plain words for a check that could not run or did not finish.
fn friendly_check_error(e: &std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::TimedOut {
        "The check took too long and was stopped. Please try again.".to_string()
    } else {
        "The check could not be run on this computer.".to_string()
    }
}

// ── running it ───────────────────────────────────────────────────────────────

/// Handle to the bundled `provider-node`.
#[derive(Debug, Clone)]
pub struct Sidecar {
    path: PathBuf,
}

impl Sidecar {
    pub fn new(path: PathBuf) -> Self {
        Sidecar { path }
    }

    fn cmd(&self, args: &[&str]) -> Command {
        let mut cmd = Command::new(&self.path);
        cmd.args(args).stdin(Stdio::null());
        quiet(&mut cmd);
        cmd
    }

    /// `status --json --local`: fast, offline-safe, no Control API call.
    pub fn status(&self) -> Result<NodeFacts, String> {
        let out = self
            .cmd(&["status", "--json", "--local"])
            .output()
            .map_err(|e| format!("could not run provider-node: {e}"))?;
        parse_status(&String::from_utf8_lossy(&out.stdout), |p| p.is_file())
    }

    /// Run `provider-node <args>` and wait for that process, and only that process, to exit.
    /// Returns its status and everything it printed.
    ///
    /// This is not `Command::output()`. `start --background` leaves the node running as a
    /// background daemon, and on Windows that daemon keeps the pipes `output()` reads until
    /// they close, so `output()` returned only when the node itself stopped: Resume never
    /// finished while sharing, the page stayed busy and Pause was greyed out. The output goes
    /// to a file instead, so nothing waits on a handle the daemon may hold.
    fn run_to_exit(
        &self,
        args: &[&str],
        timeout: Duration,
    ) -> std::io::Result<(ExitStatus, String)> {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "proxyhubb-provider-{}-{nanos}.out",
            std::process::id()
        ));
        let out = File::create(&path)?;
        let err = out.try_clone()?;
        let mut cmd = self.cmd(args);
        cmd.stdout(Stdio::from(out)).stderr(Stdio::from(err));

        let waited = (|| {
            let mut child = cmd.spawn()?;
            let deadline = Instant::now() + timeout;
            loop {
                if let Some(status) = child.try_wait()? {
                    return Ok(status);
                }
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "provider-node did not finish in time",
                    ));
                }
                thread::sleep(Duration::from_millis(100));
            }
        })();
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        let _ = std::fs::remove_file(&path);
        waited.map(|status| (status, text))
    }

    /// `start --background`: returns once the detached daemon is running. It does not wait for
    /// the node to connect, so the caller is free again within a second or two.
    pub fn start(&self) -> Result<(), String> {
        match self.run_to_exit(&["start", "--background"], START_TIMEOUT) {
            Ok((status, _)) if status.success() => Ok(()),
            Ok((_, printed)) => Err(friendly_start_error(&printed)),
            Err(e) => Err(friendly_start_error(&e.to_string())),
        }
    }

    /// `account --json`: what ProxyHubb's servers say about this computer, and its earnings. It
    /// asks the network, so it is run every few minutes, not every few seconds.
    pub fn account(&self) -> Result<AccountFacts, String> {
        let (_status, printed) = self
            .run_to_exit(&["account", "--json"], ACCOUNT_TIMEOUT)
            .map_err(|e| format!("could not run provider-node: {e}"))?;
        parse_account(&printed)
    }

    /// `doctor --json`, in plain words. The doctor exits 1 when a check fails, which is the
    /// answer and not a failure, so only unreadable output is an error.
    /// `doctor --explain --json`: the checks plus the assistant's checked explanation. The
    /// node sends only check ids, severities and codes, with its own token. Changes nothing.
    pub fn explain_doctor(&self, text: Option<&str>) -> Result<DoctorExplained, String> {
        let text_arg = text.map(|t| format!("--text={t}"));
        let mut args = vec!["doctor", "--json", "--explain"];
        if let Some(arg) = text_arg.as_deref() {
            args.push(arg);
        }
        let (_status, printed) = self
            .run_to_exit(&args, DOCTOR_EXPLAIN_TIMEOUT)
            .map_err(|e| friendly_check_error(&e))?;
        parse_explain(&printed).map_err(|_| "The check gave no usable answer.".to_string())
    }

    pub fn diagnose(&self) -> Result<Diagnosis, String> {
        let (_status, printed) = self
            .run_to_exit(&["doctor", "--json"], DOCTOR_TIMEOUT)
            .map_err(|e| friendly_check_error(&e))?;
        findings_from(&printed).map_err(|_| "The check gave no usable answer.".to_string())
    }

    /// `support bundle --output <path>`: a file with the settings (keys removed), the checks,
    /// the node's state and the end of its log, for sending to support.
    pub fn support_bundle(&self, output: &Path) -> Result<(), String> {
        let path = output
            .to_str()
            .ok_or("The support file's location cannot be written down.")?;
        let (status, _printed) = self
            .run_to_exit(&["support", "bundle", "--output", path], BUNDLE_TIMEOUT)
            .map_err(|e| friendly_check_error(&e))?;
        if status.success() && output.is_file() {
            Ok(())
        } else {
            Err("The support file could not be made.".to_string())
        }
    }

    /// `unpair --json`: stop the node and move its settings aside. Only after the node reports
    /// success is this computer disconnected; every failure here means nothing was changed.
    pub fn unpair(&self) -> Result<DisconnectResult, String> {
        let (status, printed) = self
            .run_to_exit(&["unpair", "--json"], UNPAIR_TIMEOUT)
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::TimedOut {
                    "The disconnect took too long and was stopped. Please try again.".to_string()
                } else {
                    "This computer could not be disconnected. Nothing was changed.".to_string()
                }
            })?;
        if !status.success() {
            return Err(friendly_unpair_error(&printed));
        }
        parse_unpair(&printed).map_err(|_| {
            "The disconnect could not be confirmed. Please check and try again.".to_string()
        })
    }

    /// `config show --json`: this computer's node settings, for reading. Nothing on the network.
    pub fn settings(&self) -> Result<NodeSettings, String> {
        let (_status, printed) = self
            .run_to_exit(&["config", "show", "--json"], SETTINGS_TIMEOUT)
            .map_err(|_| "This computer's settings could not be read.".to_string())?;
        parse_node_settings(&printed)
            .map_err(|_| "This computer's settings could not be read.".to_string())
    }

    /// `latest-release --package desktop --json`: the version of the newest published installer.
    pub fn latest_release(&self) -> Result<String, String> {
        let (_status, printed) = self
            .run_to_exit(
                &["latest-release", "--package", "desktop", "--json"],
                LATEST_TIMEOUT,
            )
            .map_err(|e| format!("could not run provider-node: {e}"))?;
        parse_latest_release(&printed).map(|r| r.version)
    }

    /// `rules draft --json`: the node asks the rules assistant with its own token. Changes nothing.
    pub fn draft_rules(&self, text: &str) -> Result<RulesDraft, String> {
        let arg = format!("--text={text}");
        let (_status, printed) = self
            .run_to_exit(&["rules", "draft", &arg, "--json"], RULES_DRAFT_TIMEOUT)
            .map_err(|e| format!("could not run provider-node: {e}"))?;
        parse_draft(&printed)
    }

    /// `config set-blocked-sites --from-file <list> --json`. The list goes through a file because
    /// a long one would not fit on a Windows command line.
    pub fn set_blocked_sites(&self, sites: &[String]) -> Result<BlockedSitesReport, String> {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let list = std::env::temp_dir().join(format!(
            "proxyhubb-provider-sites-{}-{nanos}.json",
            std::process::id()
        ));
        let body = serde_json::to_string(sites).map_err(|e| e.to_string())?;
        std::fs::write(&list, body).map_err(|e| format!("could not write the site list: {e}"))?;
        let list_arg = list.to_string_lossy().into_owned();
        let ran = self.run_to_exit(
            &["config", "set-blocked-sites", "--from-file", &list_arg, "--json"],
            SETTINGS_TIMEOUT,
        );
        let _ = std::fs::remove_file(&list);
        let (_status, printed) = ran.map_err(|e| format!("could not run provider-node: {e}"))?;
        parse_set(&printed)
    }

    /// `stop`: ends the detached daemon if one is running.
    pub fn stop(&self) -> Result<(), String> {
        self.cmd(&["stop"])
            .output()
            .map(|_| ())
            .map_err(|e| format!("could not run provider-node: {e}"))
    }

    /// `pair --json`: spawn it. The process handle is kept to cancel; the events come back on
    /// the receiver, which the caller drains.
    pub fn pair(&self) -> Result<(PairingProcess, Receiver<PairEvent>), String> {
        let mut cmd = self.cmd(&["pair", "--json"]);
        cmd.stdout(Stdio::piped()).stderr(Stdio::null());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("could not run provider-node: {e}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or("could not read provider-node output")?;

        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let mut saw_terminal = false;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(event) = parse_event_line(&line) {
                    saw_terminal |= event.is_terminal();
                    if tx.send(event).is_err() {
                        return;
                    }
                }
            }
            // The process ended without a terminal event (crashed, or was killed).
            if !saw_terminal {
                let _ = tx.send(PairEvent::Error("pairing stopped unexpectedly".to_string()));
            }
        });
        Ok((PairingProcess { child: Some(child) }, rx))
    }
}

/// A running `pair --json`, kept so it can be cancelled.
pub struct PairingProcess {
    /// `None` for a test double.
    child: Option<Child>,
}

impl PairingProcess {
    /// A handle with no process behind it, for tests.
    #[cfg(test)]
    pub fn detached() -> Self {
        PairingProcess { child: None }
    }

    /// Stop waiting. Nothing is written to disk before an approval, so killing it is clean.
    pub fn cancel(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for PairingProcess {
    fn drop(&mut self) {
        self.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUNNING_AND_CONNECTED: &str = r#"{
      "config_path": "/c/provider.toml",
      "process": {"running": true, "pid": 4242, "pid_file": "/c/provider.pid"},
      "metrics": {"active_connections": 3, "total_connections": 10, "bytes_up": 111,
                  "bytes_down": 222, "rate_up_kbps": 1, "rate_down_kbps": 2,
                  "uptime_seconds": 90, "last_heartbeat_ago_ms": 5, "latency_ms": 20,
                  "connection_type": "residential"},
      "control_api": {"url": "https://x", "reachable": false, "nodes": []},
      "runtime": {"provider_run_id": "r", "active_gateway": "g", "gateway_index": 0,
                  "gateway_total": 1, "transport": "tcp", "tunnel_connected": true,
                  "last_session_error": null, "updated_at_unix": 1}
    }"#;

    fn exists(_: &Path) -> bool {
        true
    }
    fn missing(_: &Path) -> bool {
        false
    }

    #[test]
    fn a_running_connected_node_yields_sharing_facts() {
        let f = parse_status(RUNNING_AND_CONNECTED, exists).unwrap();
        assert!(f.config_present && f.process_running && f.tunnel_connected);
        assert_eq!(f.last_error, None);
        let m = f.metrics.unwrap();
        assert_eq!(
            (
                m.uptime_seconds,
                m.bytes_up,
                m.bytes_down,
                m.active_connections
            ),
            (90, 111, 222, 3)
        );
    }

    #[test]
    fn speed_delay_and_connection_counts_come_from_the_local_metrics() {
        let text = RUNNING_AND_CONNECTED
            .replace(r#""rate_up_kbps": 1"#, r#""rate_up_kbps": 400"#)
            .replace(r#""rate_down_kbps": 2"#, r#""rate_down_kbps": 9000"#)
            .replace(r#""total_connections": 10"#, r#""total_connections": 120"#)
            .replace(r#""latency_ms": 20"#, r#""latency_ms": 35"#)
            .replace(
                r#""bytes_down": 222,"#,
                r#""bytes_down": 222, "failed_connections": 4,"#,
            );
        let m = parse_status(&text, exists).unwrap().metrics.unwrap();
        assert_eq!((m.rate_up_kbps, m.rate_down_kbps), (400, 9000));
        assert_eq!((m.total_connections, m.failed_connections), (120, 4));
        assert_eq!(m.latency_ms, 35);
    }

    #[test]
    fn an_older_node_without_the_new_metrics_still_parses_with_zeros() {
        let text = r#"{"config_path":"/c/p.toml","process":{"running":true,"pid":1,"pid_file":"/c/p.pid"},
                        "metrics":{"uptime_seconds":5,"bytes_up":1,"bytes_down":2,"active_connections":0},
                        "control_api":{"url":"x","reachable":false,"nodes":[]}}"#;
        let m = parse_status(text, exists).unwrap().metrics.unwrap();
        assert_eq!(
            (m.rate_up_kbps, m.total_connections, m.latency_ms),
            (0, 0, 0)
        );
    }

    #[test]
    fn config_presence_comes_from_the_path_the_node_reports() {
        let f = parse_status(RUNNING_AND_CONNECTED, missing).unwrap();
        assert!(!f.config_present);
        let seen = std::cell::RefCell::new(None);
        parse_status(RUNNING_AND_CONNECTED, |p: &Path| {
            *seen.borrow_mut() = Some(p.to_path_buf());
            true
        })
        .unwrap();
        assert_eq!(seen.into_inner(), Some(PathBuf::from("/c/provider.toml")));
    }

    #[test]
    fn the_nodes_last_error_is_surfaced_only_while_not_connected() {
        let down = RUNNING_AND_CONNECTED
            .replace(
                r#""tunnel_connected": true"#,
                r#""tunnel_connected": false"#,
            )
            .replace(
                r#""last_session_error": null"#,
                r#""last_session_error": "gateway unreachable""#,
            );
        assert_eq!(
            parse_status(&down, exists).unwrap().last_error.as_deref(),
            Some("gateway unreachable")
        );
        // Connected: an old error must not show.
        let up = RUNNING_AND_CONNECTED.replace(
            r#""last_session_error": null"#,
            r#""last_session_error": "old""#,
        );
        assert_eq!(parse_status(&up, exists).unwrap().last_error, None);
    }

    #[test]
    fn pid_and_retry_context_parse_from_status() {
        let down = RUNNING_AND_CONNECTED.replace(
            r#""tunnel_connected": true"#,
            r#""tunnel_connected": false"#,
        );
        let f = parse_status(&down, exists).unwrap();
        assert_eq!(f.node_pid, Some(4242));
        let r = f.retry.expect("retry context while disconnected");
        assert_eq!(r.active_gateway, "g");
        assert_eq!((r.gateway_index, r.gateway_total), (0, 1));
        assert_eq!(r.updated_at_unix, 1);
        // Connected nodes carry no retry context.
        let up = parse_status(RUNNING_AND_CONNECTED, exists).unwrap();
        assert_eq!(up.retry, None);
        assert_eq!(up.node_pid, Some(4242));
    }

    #[test]
    fn old_sidecar_output_without_retry_fields_degrades_gracefully() {
        let text = r#"{"config_path":"/c/provider.toml","process":{"running":true,"pid":7,"pid_file":"/c/p.pid"},
                        "metrics":null,"control_api":{"url":"x","reachable":false,"nodes":[]},
                        "runtime":{"tunnel_connected":false,"last_session_error":"boom"}}"#;
        let f = parse_status(text, exists).unwrap();
        assert_eq!(f.node_pid, Some(7));
        assert_eq!(f.last_error.as_deref(), Some("boom"));
        assert_eq!(f.retry, None);
    }

    #[test]
    fn a_node_that_never_ran_has_no_runtime_or_metrics() {
        let text = r#"{"config_path":"/c/provider.toml","process":{"running":false,"pid":null,"pid_file":"/c/p.pid"},
                        "metrics":null,"control_api":{"url":"x","reachable":false,"nodes":[]}}"#;
        let f = parse_status(text, exists).unwrap();
        assert!(!f.process_running && !f.tunnel_connected);
        assert_eq!(f.metrics, None);
        assert_eq!(f.last_error, None);
    }

    #[test]
    fn text_before_the_json_is_tolerated_and_garbage_is_an_error() {
        let noisy = format!("2026-10-28 INFO something\n{RUNNING_AND_CONNECTED}");
        assert!(parse_status(&noisy, exists).unwrap().process_running);
        for bad in ["", "no json here", "{", r#"{"process": 5}"#] {
            assert!(parse_status(bad, exists).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn pairing_events_parse_and_stray_lines_are_ignored() {
        assert_eq!(
            parse_event_line(
                r#"{"event":"code","user_code":"BCDF-GHJK","link":"https://proxyhubb.com/p?code=BCDF-GHJK","expires_in":600}"#
            ),
            Some(PairEvent::Code {
                user_code: "BCDF-GHJK".into(),
                link: "https://proxyhubb.com/p?code=BCDF-GHJK".into(),
                expires_in: 600
            })
        );
        assert_eq!(
            parse_event_line(r#"{"event":"approved","node_id":"n","config_path":"/c"}"#),
            Some(PairEvent::Approved {
                node_id: "n".into()
            })
        );
        assert_eq!(
            parse_event_line(r#"{"event":"denied"}"#),
            Some(PairEvent::Denied)
        );
        assert_eq!(
            parse_event_line(r#"{"event":"expired"}"#),
            Some(PairEvent::Expired)
        );
        assert_eq!(
            parse_event_line(r#"{"event":"error","message":"boom"}"#),
            Some(PairEvent::Error("boom".into()))
        );
        assert_eq!(
            parse_event_line(r#"{"event":"error"}"#),
            Some(PairEvent::Error("pairing failed".into()))
        );
        for stray in ["", "hello", "{}", r#"{"event":"surprise"}"#, "[1]"] {
            assert_eq!(parse_event_line(stray), None, "{stray:?}");
        }
    }

    #[test]
    fn an_incomplete_event_can_never_fake_an_approval_or_a_code() {
        for incomplete in [
            r#"{"event":"approved"}"#,
            r#"{"event":"approved","node_id":""}"#,
            r#"{"event":"code","user_code":"X"}"#,
            r#"{"event":"code","link":"https://proxyhubb.com/"}"#,
        ] {
            assert_eq!(parse_event_line(incomplete), None, "{incomplete}");
        }
    }

    #[test]
    fn only_a_code_is_non_terminal() {
        let code = PairEvent::Code {
            user_code: "a".into(),
            link: "b".into(),
            expires_in: 1,
        };
        assert!(!code.is_terminal());
        for e in [
            PairEvent::Approved {
                node_id: "n".into(),
            },
            PairEvent::Denied,
            PairEvent::Expired,
            PairEvent::Error("e".into()),
        ] {
            assert!(e.is_terminal(), "{e:?}");
        }
    }

    #[test]
    fn only_dashboard_links_are_allowed() {
        for ok in [
            "https://proxyhubb.com/dashboard/provider/pair?code=BCDF-GHJK",
            "https://proxyhubb.com/dashboard",
        ] {
            assert!(is_allowed_link(ok), "{ok}");
        }
        for bad in [
            "",
            "http://proxyhubb.com/x",
            "https://proxyhubb.com.evil.example/x",
            "https://evil.example/https://proxyhubb.com/",
            "https://app.proxyhubb.com/x",
            "file:///C:/Windows/System32/calc.exe",
            "javascript:alert(1)",
            "https://proxyhubb.com/a b",
            "https://proxyhubb.com/\"&calc",
            "https://proxyhubb.com/a\nb",
        ] {
            assert!(!is_allowed_link(bad), "{bad:?}");
        }
    }

    #[test]
    fn start_failures_are_explained_in_plain_language_without_leaking_internals() {
        for (raw, needle) in [
            (
                "config not found at C:\\x\\provider.toml",
                "not connected to an account",
            ),
            (
                "daemon did not write a live PID file — check C:\\log",
                "did not start",
            ),
            (
                "failed to spawn background daemon (C:\\x.exe): os error 2",
                "could not be launched",
            ),
            ("something unexpected", "could not start"),
        ] {
            let msg = friendly_start_error(raw);
            assert!(msg.contains(needle), "{raw:?} -> {msg:?}");
            assert!(!msg.contains('\\') && !msg.contains(".exe"), "{msg}");
        }
    }

    // ── waiting for the starter, not for what it leaves running ──────────────
    // `cmd` and `ping` stand in for `provider-node start --background`: a starter that returns
    // at once and leaves a long-lived child behind holding the handles it was given.

    #[cfg(windows)]
    #[test]
    fn a_child_left_running_does_not_keep_the_call_open() {
        let sidecar = Sidecar::new(PathBuf::from("cmd.exe"));
        let began = Instant::now();
        let (status, _) = sidecar
            .run_to_exit(
                &["/C", "start", "/B", "ping", "-n", "6", "127.0.0.1"],
                Duration::from_secs(30),
            )
            .unwrap();
        assert!(status.success());
        assert!(
            began.elapsed() < Duration::from_secs(3),
            "waited {:?} for a child that was meant to be left running",
            began.elapsed()
        );
    }

    #[cfg(windows)]
    #[test]
    fn what_the_starter_printed_and_its_exit_code_come_back() {
        let sidecar = Sidecar::new(PathBuf::from("cmd.exe"));
        let (status, printed) = sidecar
            .run_to_exit(
                &["/C", "echo hello & echo oops 1>&2 & exit 3"],
                Duration::from_secs(10),
            )
            .unwrap();
        assert_eq!(status.code(), Some(3));
        assert!(
            printed.contains("hello") && printed.contains("oops"),
            "{printed:?}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_starter_that_never_returns_is_given_up_on_after_the_timeout() {
        let sidecar = Sidecar::new(PathBuf::from("cmd.exe"));
        let began = Instant::now();
        let err = sidecar
            .run_to_exit(
                &["/C", "ping", "-n", "8", "127.0.0.1"],
                Duration::from_millis(700),
            )
            .unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::TimedOut);
        assert!(began.elapsed() < Duration::from_secs(4));
    }

    #[cfg(windows)]
    #[test]
    fn a_starter_that_cannot_be_launched_is_an_error_not_a_hang() {
        let sidecar = Sidecar::new(PathBuf::from("Z:\\no\\such\\provider-node.exe"));
        assert!(sidecar.start().is_err());
    }
}
