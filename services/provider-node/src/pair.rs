//! Device pairing: get provider credentials by approving a short code in the dashboard,
//! instead of downloading a setup script with a token written into it.
//!
//! The server side is `services/control-api/internal/api/provider_pairing.go`:
//!   POST /v1/provider/pair/start  -> device_code (secret, stays here) + user_code (shown)
//!   POST /v1/provider/pair/poll   -> pending | slow_down | approved(api_key,node_id) | ...
//! The raw `api_key` comes back exactly once, in the poll that sees the approval.

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// Never poll faster than the server asked; also a floor if it sends 0.
const MIN_POLL_INTERVAL: Duration = Duration::from_secs(1);
/// Keep waiting this long past the advertised expiry before giving up locally.
const EXPIRY_SLACK: Duration = Duration::from_secs(15);
/// Consecutive network failures tolerated while polling (a flaky connection is normal).
const MAX_CONSECUTIVE_POLL_ERRORS: u32 = 6;
/// Consecutive 5xx answers tolerated while polling. The server redeems an approval inside one
/// transaction, so a failed attempt consumes nothing and the next poll can still succeed (a
/// redeploy or a database hiccup are the usual causes). About a minute at the default interval.
const MAX_CONSECUTIVE_SERVER_ERRORS: u32 = 12;
/// Tries at `pair/start` before giving up on the network. Lost packets and failed DNS lookups
/// are normal on a home connection and `poll` already rides them out; one unlucky first request
/// must not end the pairing. Only a failed connection or a 5xx is retried: a 4xx is the server
/// saying no.
const START_ATTEMPTS: u32 = 4;
/// Each try gets this long, so the worst case is a bounded wait rather than minutes.
const START_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(10);
/// The pause before try n+1 is this times n.
const START_RETRY_WAIT: Duration = Duration::from_secs(1);

/// What a successful pairing hands back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Granted {
    pub api_key: String,
    pub node_id: String,
}

#[derive(Debug, Deserialize)]
struct StartResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    #[serde(default)]
    verification_uri_complete: Option<String>,
    expires_in: u64,
    interval: u64,
}

#[derive(Debug, Deserialize)]
struct PollBody {
    #[serde(default)]
    status: String,
    #[serde(default)]
    interval: Option<u64>,
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    node_id: Option<String>,
    #[serde(default)]
    error: Option<String>,
    /// Which part of redeeming an approval failed, and the database error class, when the
    /// server says (see `redeemProviderPairing`). Only ever present on a 5xx.
    #[serde(default)]
    step: Option<String>,
    #[serde(default)]
    sqlstate: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum PollOutcome {
    Pending {
        interval: Option<u64>,
    },
    SlowDown {
        interval: Option<u64>,
    },
    Approved(Granted),
    Denied,
    Expired,
    /// The key was already handed out (an earlier response never reached us).
    Redeemed,
    /// The server failed (5xx). Says nothing about the approval, so the caller retries.
    ServerError(String),
    Rejected(String),
}

/// Why a pairing ended without credentials, when the reason is one a caller acts on (the
/// `--json` mode maps these to distinct events). The messages are what people read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PairFailure {
    Denied,
    Expired,
}

impl std::fmt::Display for PairFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PairFailure::Denied => write!(
                f,
                "The request was denied in the dashboard. Nothing was changed on this computer."
            ),
            PairFailure::Expired => write!(
                f,
                "The code expired before it was approved. Run `provider-node pair` again."
            ),
        }
    }
}

impl std::error::Error for PairFailure {}

/// One line of `pair --json` output. Exactly one terminal event (`approved`, `denied`,
/// `expired` or `error`) is written, and `approved` only after `provider.toml` is on disk.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
    /// The code to show the person, and the link where they approve it.
    Code {
        user_code: String,
        link: String,
        expires_in: u64,
    },
    Approved {
        node_id: String,
        config_path: String,
    },
    Denied,
    Expired,
    Error {
        message: String,
    },
}

/// Write one event as a single JSON line and flush, so a reader on a pipe sees it at once.
pub fn emit(out: &mut impl Write, event: &Event) -> std::io::Result<()> {
    let line = serde_json::to_string(event).map_err(std::io::Error::other)?;
    writeln!(out, "{line}")?;
    out.flush()
}

/// The terminal event for a pairing that did not succeed.
pub fn failure_event(err: &anyhow::Error) -> Event {
    match err.downcast_ref::<PairFailure>() {
        Some(PairFailure::Denied) => Event::Denied,
        Some(PairFailure::Expired) => Event::Expired,
        None => Event::Error {
            message: format!("{err:#}"),
        },
    }
}

fn http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(format!("provider-node/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .context("failed to build HTTP client")
}

fn link_for(started: &StartResponse) -> String {
    started
        .verification_uri_complete
        .clone()
        .unwrap_or_else(|| started.verification_uri.clone())
}

/// Run the whole flow: start, show the code, wait for the owner to approve it.
pub async fn run(
    api_url: &str,
    device_name: Option<String>,
    open_browser: bool,
) -> Result<Granted> {
    let client = http_client()?;
    let base = api_url.trim_end_matches('/');

    let started = start(&client, base, device_name).await?;
    announce(&started, open_browser);

    let deadline = Instant::now() + Duration::from_secs(started.expires_in) + EXPIRY_SLACK;
    tokio::select! {
        granted = poll_until_done(&client, base, &started, deadline, MIN_POLL_INTERVAL) => granted,
        _ = tokio::signal::ctrl_c() => bail!("Cancelled. Nothing was changed on this computer."),
    }
}

/// The same flow for a program driving this one (the desktop app): the code is written to
/// `out` as an event instead of printed, no browser is opened, and nothing else touches stdout.
/// The caller writes the terminal event, because only it knows whether the config was saved.
pub async fn run_json(
    api_url: &str,
    device_name: Option<String>,
    out: &mut impl Write,
) -> Result<Granted> {
    let client = http_client()?;
    let base = api_url.trim_end_matches('/');

    let started = start(&client, base, device_name).await?;
    emit(
        out,
        &Event::Code {
            user_code: started.user_code.clone(),
            link: link_for(&started),
            expires_in: started.expires_in,
        },
    )?;

    let deadline = Instant::now() + Duration::from_secs(started.expires_in) + EXPIRY_SLACK;
    tokio::select! {
        granted = poll_until_done(&client, base, &started, deadline, MIN_POLL_INTERVAL) => granted,
        _ = tokio::signal::ctrl_c() => bail!("Cancelled. Nothing was changed on this computer."),
    }
}

async fn start(
    client: &reqwest::Client,
    base: &str,
    device_name: Option<String>,
) -> Result<StartResponse> {
    start_with(client, base, device_name, START_RETRY_WAIT).await
}

/// `start`, with the pause between tries injectable so tests do not sleep.
async fn start_with(
    client: &reqwest::Client,
    base: &str,
    device_name: Option<String>,
    retry_wait: Duration,
) -> Result<StartResponse> {
    let name = device_name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .or_else(sysinfo::System::host_name)
        .unwrap_or_else(|| "Unnamed device".to_string());
    let body = serde_json::json!({
        "device_name": name,
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "client_version": env!("CARGO_PKG_VERSION"),
    });
    let url = format!("{base}/v1/provider/pair/start");

    let mut attempt = 0u32;
    loop {
        attempt += 1;
        let resp = match client
            .post(&url)
            .json(&body)
            .timeout(START_ATTEMPT_TIMEOUT)
            .send()
            .await
        {
            Ok(resp) => resp,
            // Transient: lost packets, a failed lookup, a timeout.
            Err(_) if attempt < START_ATTEMPTS => {
                tokio::time::sleep(retry_wait * attempt).await;
                continue;
            }
            Err(e) => {
                return Err(anyhow!(e)).with_context(|| {
                    format!(
                        "could not reach the Control API at {base} after {attempt} tries \
                         (check your internet connection)"
                    )
                });
            }
        };

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if status.is_server_error() && attempt < START_ATTEMPTS {
            tokio::time::sleep(retry_wait * attempt).await;
            continue;
        }
        if !status.is_success() {
            let detail = serde_json::from_str::<PollBody>(&text)
                .ok()
                .and_then(|b| b.error)
                .unwrap_or_else(|| text.chars().take(200).collect());
            bail!("pairing could not start ({status}): {detail}");
        }
        return serde_json::from_str(&text).context("unexpected response when starting pairing");
    }
}

fn announce(started: &StartResponse, open_browser: bool) {
    let link = link_for(started);
    println!();
    println!("  To connect this computer, approve it in your ProxyHubb dashboard:");
    println!();
    println!("      {link}");
    println!();
    println!("  Code:  {}", started.user_code);
    println!(
        "  Check that the device name and system on that page match this computer. It expires in {} minutes.",
        started.expires_in.div_ceil(60)
    );
    println!();
    if open_browser {
        if is_safe_browser_url(&link) && open_in_browser(&link) {
            println!("  (Opened your browser. Sign in if asked.)");
        } else {
            println!("  Open the link above in your browser.");
        }
    }
    println!("  Waiting for approval...  (Ctrl-C to cancel)");
}

async fn poll_until_done(
    client: &reqwest::Client,
    base: &str,
    started: &StartResponse,
    deadline: Instant,
    floor: Duration,
) -> Result<Granted> {
    let mut interval = Duration::from_secs(started.interval).max(floor);
    let mut consecutive_errors = 0u32;
    let mut consecutive_server_errors = 0u32;

    loop {
        if Instant::now() >= deadline {
            return Err(PairFailure::Expired.into());
        }
        tokio::time::sleep(interval).await;

        let resp = client
            .post(format!("{base}/v1/provider/pair/poll"))
            .json(&serde_json::json!({ "device_code": started.device_code }))
            .send()
            .await;
        let (code, text) = match resp {
            Ok(r) => {
                let code = r.status().as_u16();
                match r.text().await {
                    Ok(t) => (code, t),
                    Err(e) => {
                        consecutive_errors += 1;
                        if consecutive_errors >= MAX_CONSECUTIVE_POLL_ERRORS {
                            return Err(anyhow!(e))
                                .context("lost connection while waiting for approval");
                        }
                        continue;
                    }
                }
            }
            Err(e) => {
                consecutive_errors += 1;
                if consecutive_errors >= MAX_CONSECUTIVE_POLL_ERRORS {
                    return Err(anyhow!(e)).context("lost connection while waiting for approval");
                }
                continue;
            }
        };
        consecutive_errors = 0;

        let outcome = parse_poll(code, &text);
        if !matches!(outcome, PollOutcome::ServerError(_)) {
            consecutive_server_errors = 0;
        }
        match outcome {
            PollOutcome::ServerError(why) => {
                consecutive_server_errors += 1;
                if consecutive_server_errors >= MAX_CONSECUTIVE_SERVER_ERRORS {
                    bail!(
                        "pairing failed: the server could not finish it after \
                         {consecutive_server_errors} tries ({why}). Run `provider-node pair` again."
                    );
                }
            }
            PollOutcome::Pending { interval: server } => {
                if let Some(s) = server {
                    interval = Duration::from_secs(s).max(floor);
                }
            }
            PollOutcome::SlowDown { interval: server } => {
                // The server's number is a minimum; never go below what we already use.
                interval = Duration::from_secs(server.unwrap_or(0)).max(interval);
            }
            PollOutcome::Approved(granted) => return Ok(granted),
            PollOutcome::Denied => return Err(PairFailure::Denied.into()),
            PollOutcome::Expired => return Err(PairFailure::Expired.into()),
            PollOutcome::Redeemed => bail!(
                "This pairing was already completed, but its key never reached this computer. \
                 Run `provider-node pair` again (you can remove the unused node in the dashboard)."
            ),
            PollOutcome::Rejected(why) => bail!("pairing failed: {why}"),
        }
    }
}

/// What to show for a 5xx: the server's message, and the failing step and database error class
/// when it sent them. A gateway error page (not JSON) just reports the HTTP status.
fn describe_server_error(http_status: u16, body: &str) -> String {
    let Ok(b) = serde_json::from_str::<PollBody>(body) else {
        return format!("the server answered HTTP {http_status}");
    };
    let mut msg = b
        .error
        .filter(|e| !e.trim().is_empty())
        .unwrap_or_else(|| format!("the server answered HTTP {http_status}"));
    let mut detail = Vec::new();
    if let Some(step) = b.step.filter(|s| !s.is_empty()) {
        detail.push(format!("step: {step}"));
    }
    if let Some(state) = b.sqlstate.filter(|s| !s.is_empty()) {
        detail.push(format!("database error {state}"));
    }
    if !detail.is_empty() {
        msg = format!("{msg}; {}", detail.join(", "));
    }
    msg
}

fn parse_poll(http_status: u16, body: &str) -> PollOutcome {
    if http_status >= 500 {
        return PollOutcome::ServerError(describe_server_error(http_status, body));
    }
    let Ok(b) = serde_json::from_str::<PollBody>(body) else {
        return PollOutcome::Rejected(format!("unexpected response (HTTP {http_status})"));
    };
    match b.status.as_str() {
        "pending" => PollOutcome::Pending {
            interval: b.interval,
        },
        "slow_down" => PollOutcome::SlowDown {
            interval: b.interval,
        },
        "denied" => PollOutcome::Denied,
        "expired" => PollOutcome::Expired,
        "redeemed" => PollOutcome::Redeemed,
        "approved" => match (b.api_key, b.node_id) {
            (Some(api_key), Some(node_id)) if !api_key.is_empty() && !node_id.is_empty() => {
                PollOutcome::Approved(Granted { api_key, node_id })
            }
            _ => PollOutcome::Rejected("approval arrived without a key".to_string()),
        },
        _ => PollOutcome::Rejected(
            b.error
                .unwrap_or_else(|| format!("unexpected response (HTTP {http_status})")),
        ),
    }
}

/// Only http(s) links made of plain URL characters are handed to the OS opener. The link
/// comes from the server, so this keeps a hostile or broken response from opening a
/// `file:` path or smuggling anything into a command line.
fn is_safe_browser_url(url: &str) -> bool {
    let scheme_ok = url.starts_with("https://")
        || url.starts_with("http://localhost")
        || url.starts_with("http://127.0.0.1");
    scheme_ok
        && url.len() <= 2048
        && url
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._~:/?#[]@!$&'()*+,;=%".contains(c))
}

/// Best-effort; returns whether an opener could be started. No shell is involved, so the
/// URL is a single argument and is never parsed by `cmd` or `sh`.
fn open_in_browser(url: &str) -> bool {
    #[cfg(windows)]
    let spawned = Command::new("explorer.exe")
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    #[cfg(target_os = "macos")]
    let spawned = Command::new("open")
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = Command::new("xdg-open")
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    #[cfg(not(any(windows, unix)))]
    let spawned: std::io::Result<std::process::Child> = Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "no opener",
    ));
    spawned.is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn parse_poll_maps_every_server_status() {
        use PollOutcome::*;
        assert_eq!(
            parse_poll(200, r#"{"status":"pending","interval":5}"#),
            Pending { interval: Some(5) }
        );
        assert_eq!(
            parse_poll(429, r#"{"status":"slow_down","interval":5}"#),
            SlowDown { interval: Some(5) }
        );
        assert_eq!(parse_poll(403, r#"{"status":"denied"}"#), Denied);
        assert_eq!(parse_poll(410, r#"{"status":"expired"}"#), Expired);
        assert_eq!(parse_poll(410, r#"{"status":"redeemed"}"#), Redeemed);
        assert_eq!(
            parse_poll(200, r#"{"status":"approved","api_key":"k","node_id":"n"}"#),
            Approved(Granted {
                api_key: "k".into(),
                node_id: "n".into()
            })
        );
    }

    #[test]
    fn parse_poll_never_approves_without_a_key() {
        for body in [
            r#"{"status":"approved"}"#,
            r#"{"status":"approved","api_key":"","node_id":"n"}"#,
            r#"{"status":"approved","api_key":"k"}"#,
        ] {
            assert!(
                matches!(parse_poll(200, body), PollOutcome::Rejected(_)),
                "{body}"
            );
        }
    }

    #[test]
    fn parse_poll_surfaces_errors_and_garbage() {
        assert_eq!(
            parse_poll(400, r#"{"status":"invalid","error":"unknown device_code"}"#),
            PollOutcome::Rejected("unknown device_code".into())
        );
        assert!(matches!(parse_poll(200, ""), PollOutcome::Rejected(_)));
    }

    #[test]
    fn a_5xx_is_a_server_error_not_a_rejection() {
        // A gateway error page and a JSON error body are both the server failing, which says
        // nothing about the approval, so neither may end the pairing.
        assert_eq!(
            parse_poll(502, "<html>bad gateway</html>"),
            PollOutcome::ServerError("the server answered HTTP 502".into())
        );
        assert_eq!(
            parse_poll(500, r#"{"error":"failed to complete pairing"}"#),
            PollOutcome::ServerError("failed to complete pairing".into())
        );
        assert_eq!(
            parse_poll(
                500,
                r#"{"error":"failed to complete pairing","step":"registration","sqlstate":"23503"}"#
            ),
            PollOutcome::ServerError(
                "failed to complete pairing; step: registration, database error 23503".into()
            )
        );
    }

    #[test]
    fn only_plain_web_links_reach_the_opener() {
        for ok in [
            "https://proxyhubb.com/dashboard/provider/pair?code=BCDF-GHJK",
            "http://localhost:3000/dashboard/provider/pair?code=BCDF-GHJK",
            "http://127.0.0.1:3009/x",
        ] {
            assert!(is_safe_browser_url(ok), "{ok}");
        }
        for bad in [
            "file:///C:/Windows/System32/calc.exe",
            "javascript:alert(1)",
            "ftp://example.com",
            "http://evil.example/x",
            "https://example.com/a b",
            "https://example.com/\"&calc",
            "https://example.com/`id`",
            "https://example.com/a\nb",
            "https://example.com/a\\b",
            "https://example.com/<x>",
            "",
        ] {
            assert!(!is_safe_browser_url(bad), "{bad:?}");
        }
    }

    // ── a scripted HTTP server standing in for control-api ──────────────────

    type Script = Arc<Mutex<VecDeque<(u16, String)>>>;

    /// Read one full HTTP request (headers plus Content-Length body). Answering while bytes
    /// are still unread would let the close reset the connection and lose our response.
    async fn read_request(sock: &mut tokio::net::TcpStream) -> String {
        let mut data = Vec::new();
        let mut buf = [0u8; 2048];
        loop {
            let n = sock.read(&mut buf).await.unwrap_or(0);
            if n == 0 {
                break;
            }
            data.extend_from_slice(&buf[..n]);
            if let Some(pos) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&data[..pos]).to_lowercase();
                let len = head
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length:"))
                    .and_then(|v| v.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                if data.len() >= pos + 4 + len {
                    break;
                }
            }
        }
        String::from_utf8_lossy(&data).to_string()
    }

    /// Serves POST /start once and then hands out `poll_script` for each POST /poll.
    /// Returns the base URL and how many polls it saw.
    async fn mock_control_api(
        start_body: String,
        poll_script: Vec<(u16, &'static str)>,
    ) -> (String, Arc<Mutex<u32>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let polls = Arc::new(Mutex::new(0u32));
        let script: Script = Arc::new(Mutex::new(
            poll_script
                .into_iter()
                .map(|(c, b)| (c, b.to_string()))
                .collect(),
        ));
        let polls_seen = polls.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                let (start_body, script, polls_seen) =
                    (start_body.clone(), script.clone(), polls_seen.clone());
                tokio::spawn(async move {
                    let req = read_request(&mut sock).await;
                    let (code, body) = if req.starts_with("POST /v1/provider/pair/start") {
                        (201, start_body)
                    } else if req.starts_with("POST /v1/provider/pair/poll") {
                        *polls_seen.lock().unwrap() += 1;
                        script
                            .lock()
                            .unwrap()
                            .pop_front()
                            .unwrap_or((500, "{}".to_string()))
                    } else {
                        (404, "{}".to_string())
                    };
                    let resp = format!(
                        "HTTP/1.1 {code} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                    let _ = sock.shutdown().await;
                });
            }
        });
        (base, polls)
    }

    fn start_json() -> String {
        r#"{"device_code":"d","user_code":"BCDF-GHJK","verification_uri":"https://x.test/pair",
            "verification_uri_complete":"https://x.test/pair?code=BCDF-GHJK","expires_in":600,"interval":0}"#
            .to_string()
    }

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap()
    }

    #[tokio::test]
    async fn waits_through_pending_and_slow_down_then_returns_the_key() {
        let (base, polls) = mock_control_api(
            start_json(),
            vec![
                (200, r#"{"status":"pending","interval":0}"#),
                (429, r#"{"status":"slow_down","interval":0}"#),
                (
                    200,
                    r#"{"status":"approved","api_key":"the-key","node_id":"the-node"}"#,
                ),
            ],
        )
        .await;
        let client = test_client();
        let started = start(&client, &base, Some("My PC".into())).await.unwrap();
        assert_eq!(started.user_code, "BCDF-GHJK");

        let got = poll_until_done(
            &client,
            &base,
            &started,
            Instant::now() + Duration::from_secs(10),
            Duration::ZERO,
        )
        .await
        .unwrap();
        assert_eq!(
            got,
            Granted {
                api_key: "the-key".into(),
                node_id: "the-node".into()
            }
        );
        assert_eq!(*polls.lock().unwrap(), 3);
    }

    #[tokio::test]
    async fn a_denial_stops_polling_with_no_key() {
        let (base, polls) = mock_control_api(
            start_json(),
            vec![
                (200, r#"{"status":"pending"}"#),
                (403, r#"{"status":"denied"}"#),
            ],
        )
        .await;
        let client = test_client();
        let started = start(&client, &base, None).await.unwrap();
        let err = poll_until_done(
            &client,
            &base,
            &started,
            Instant::now() + Duration::from_secs(10),
            Duration::ZERO,
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("denied"), "{err}");
        assert_eq!(*polls.lock().unwrap(), 2, "must stop at the denial");
    }

    const REDEEM_FAILED: &str =
        r#"{"error":"failed to complete pairing","step":"registration","sqlstate":"23503"}"#;

    #[tokio::test]
    async fn a_server_error_does_not_burn_the_approval() {
        // The first two polls hit a failing server (a redeploy, a database hiccup); the third
        // succeeds. Before, the first 5xx ended the pairing even though nothing was consumed.
        let (base, polls) = mock_control_api(
            start_json(),
            vec![
                (500, REDEEM_FAILED),
                (502, "<html>bad gateway</html>"),
                (
                    200,
                    r#"{"status":"approved","api_key":"the-key","node_id":"the-node"}"#,
                ),
            ],
        )
        .await;
        let client = test_client();
        let started = start(&client, &base, None).await.unwrap();
        let got = poll_until_done(
            &client,
            &base,
            &started,
            Instant::now() + Duration::from_secs(10),
            Duration::ZERO,
        )
        .await
        .unwrap();
        assert_eq!(got.node_id, "the-node");
        assert_eq!(*polls.lock().unwrap(), 3);
    }

    #[tokio::test]
    async fn a_server_that_keeps_failing_ends_the_pairing_and_names_the_step() {
        let (base, polls) = mock_control_api(
            start_json(),
            vec![(500, REDEEM_FAILED); MAX_CONSECUTIVE_SERVER_ERRORS as usize + 3],
        )
        .await;
        let client = test_client();
        let started = start(&client, &base, None).await.unwrap();
        let err = poll_until_done(
            &client,
            &base,
            &started,
            Instant::now() + Duration::from_secs(10),
            Duration::ZERO,
        )
        .await
        .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("step: registration"), "{msg}");
        assert!(msg.contains("23503"), "{msg}");
        assert_eq!(
            *polls.lock().unwrap(),
            MAX_CONSECUTIVE_SERVER_ERRORS,
            "must retry, but not forever"
        );
    }

    #[tokio::test]
    async fn the_server_error_count_restarts_after_a_good_answer() {
        // MAX-1 failures, a pending answer, then MAX-1 more failures, then approval: the run of
        // consecutive failures never reaches the limit, so it must still succeed.
        let n = MAX_CONSECUTIVE_SERVER_ERRORS as usize - 1;
        let mut script: Vec<(u16, &'static str)> = vec![(500, REDEEM_FAILED); n];
        script.push((200, r#"{"status":"pending"}"#));
        script.extend(vec![(500, REDEEM_FAILED); n]);
        script.push((
            200,
            r#"{"status":"approved","api_key":"the-key","node_id":"the-node"}"#,
        ));
        let (base, _) = mock_control_api(start_json(), script).await;
        let client = test_client();
        let started = start(&client, &base, None).await.unwrap();
        let got = poll_until_done(
            &client,
            &base,
            &started,
            Instant::now() + Duration::from_secs(30),
            Duration::ZERO,
        )
        .await
        .unwrap();
        assert_eq!(got.api_key, "the-key");
    }

    #[tokio::test]
    async fn gives_up_at_the_deadline_instead_of_polling_forever() {
        let (base, _) =
            mock_control_api(start_json(), vec![(200, r#"{"status":"pending"}"#); 50]).await;
        let client = test_client();
        let started = start(&client, &base, None).await.unwrap();
        let err = poll_until_done(
            &client,
            &base,
            &started,
            Instant::now() + Duration::from_millis(200),
            Duration::from_millis(20),
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("expired"), "{err}");
    }

    #[tokio::test]
    async fn start_failure_reports_the_servers_reason() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let _ = read_request(&mut sock).await;
            let body =
                r#"{"error":"too many pairing requests from this address; try again later"}"#;
            let resp = format!(
                "HTTP/1.1 429 X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = sock.write_all(resp.as_bytes()).await;
        });
        let err = start(&test_client(), &base, None).await.unwrap_err();
        assert!(
            err.to_string().contains("too many pairing requests"),
            "{err}"
        );
    }

    // ── starting over a flaky connection ─────────────────────────────────────

    /// What the server does to each request to /start, in order. Once the script runs out it
    /// answers normally.
    enum StartAnswer {
        /// Read the request, then close the connection without answering (a lost connection).
        Drop,
        Status(u16, &'static str),
    }

    /// Serves POST /start from a script and counts the requests it saw.
    async fn scripted_start(script: Vec<StartAnswer>) -> (String, Arc<Mutex<u32>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(0u32));
        let script = Arc::new(Mutex::new(VecDeque::from(script)));
        let seen_in = seen.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                let (script, seen) = (script.clone(), seen_in.clone());
                tokio::spawn(async move {
                    let _ = read_request(&mut sock).await;
                    *seen.lock().unwrap() += 1;
                    let next = script.lock().unwrap().pop_front();
                    let (code, body) = match next {
                        Some(StartAnswer::Drop) => return,
                        Some(StartAnswer::Status(c, b)) => (c, b.to_string()),
                        None => (201, start_json()),
                    };
                    let resp = format!(
                        "HTTP/1.1 {code} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                    let _ = sock.shutdown().await;
                });
            }
        });
        (base, seen)
    }

    #[tokio::test]
    async fn a_lost_connection_while_starting_is_retried() {
        let (base, seen) = scripted_start(vec![StartAnswer::Drop, StartAnswer::Drop]).await;
        let started = start_with(&test_client(), &base, None, Duration::ZERO)
            .await
            .unwrap();
        assert_eq!(started.user_code, "BCDF-GHJK");
        assert_eq!(*seen.lock().unwrap(), 3, "two lost, then it got through");
    }

    #[tokio::test]
    async fn a_server_error_while_starting_is_retried() {
        let (base, seen) = scripted_start(vec![
            StartAnswer::Status(503, "<html>unavailable</html>"),
            StartAnswer::Status(500, r#"{"error":"try again"}"#),
        ])
        .await;
        let started = start_with(&test_client(), &base, None, Duration::ZERO)
            .await
            .unwrap();
        assert_eq!(started.user_code, "BCDF-GHJK");
        assert_eq!(*seen.lock().unwrap(), 3);
    }

    #[tokio::test]
    async fn a_connection_that_never_works_gives_up_after_a_bounded_number_of_tries() {
        let (base, seen) =
            scripted_start((0..START_ATTEMPTS + 3).map(|_| StartAnswer::Drop).collect()).await;
        let err = start_with(&test_client(), &base, None, Duration::ZERO)
            .await
            .unwrap_err();
        let msg = format!("{err:#}");
        assert!(msg.contains("could not reach the Control API"), "{msg}");
        assert!(msg.contains("check your internet connection"), "{msg}");
        assert!(
            msg.contains(&format!("after {START_ATTEMPTS} tries")),
            "{msg}"
        );
        assert_eq!(
            *seen.lock().unwrap(),
            START_ATTEMPTS,
            "retried, but not forever"
        );
    }

    #[tokio::test]
    async fn a_refusal_is_never_retried() {
        for (code, body) in [
            (
                429,
                r#"{"error":"too many pairing requests from this address"}"#,
            ),
            (400, r#"{"error":"bad request"}"#),
        ] {
            let (base, seen) = scripted_start(vec![StartAnswer::Status(code, body)]).await;
            let err = start_with(&test_client(), &base, None, Duration::ZERO)
                .await
                .unwrap_err();
            assert!(err.to_string().contains("pairing could not start"), "{err}");
            assert_eq!(
                *seen.lock().unwrap(),
                1,
                "{code} is the server saying no; asking again changes nothing"
            );
        }
    }

    #[tokio::test]
    async fn repeated_network_failures_end_the_wait_with_a_clear_error() {
        // Nothing is listening on this port once the listener is dropped.
        let base = {
            let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
            format!("http://{}", l.local_addr().unwrap())
        };
        let started: StartResponse = serde_json::from_str(&start_json()).unwrap();
        let err = poll_until_done(
            &test_client(),
            &base,
            &started,
            Instant::now() + Duration::from_secs(30),
            Duration::ZERO,
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("lost connection"), "{err}");
    }

    // ── `--json`: the contract the desktop app reads ─────────────────────────

    fn lines(buf: &[u8]) -> Vec<serde_json::Value> {
        String::from_utf8_lossy(buf)
            .lines()
            .map(|l| serde_json::from_str(l).unwrap_or_else(|e| panic!("not JSON: {l:?}: {e}")))
            .collect()
    }

    #[test]
    fn every_event_is_one_json_line_with_a_stable_shape() {
        let cases: Vec<(Event, serde_json::Value)> = vec![
            (
                Event::Code {
                    user_code: "BCDF-GHJK".into(),
                    link: "https://x.test/pair?code=BCDF-GHJK".into(),
                    expires_in: 600,
                },
                serde_json::json!({"event":"code","user_code":"BCDF-GHJK","link":"https://x.test/pair?code=BCDF-GHJK","expires_in":600}),
            ),
            (
                Event::Approved {
                    node_id: "n".into(),
                    config_path: "C:\\p\\provider.toml".into(),
                },
                serde_json::json!({"event":"approved","node_id":"n","config_path":"C:\\p\\provider.toml"}),
            ),
            (Event::Denied, serde_json::json!({"event":"denied"})),
            (Event::Expired, serde_json::json!({"event":"expired"})),
            (
                Event::Error {
                    message: "m".into(),
                },
                serde_json::json!({"event":"error","message":"m"}),
            ),
        ];
        for (event, want) in cases {
            let mut buf = Vec::new();
            emit(&mut buf, &event).unwrap();
            let text = String::from_utf8(buf).unwrap();
            assert!(
                text.ends_with('\n') && !text[..text.len() - 1].contains('\n'),
                "{text:?}"
            );
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&text).unwrap(),
                want
            );
        }
    }

    #[test]
    fn a_failed_pairing_maps_to_exactly_one_terminal_event() {
        let denied: anyhow::Error = PairFailure::Denied.into();
        let expired: anyhow::Error = PairFailure::Expired.into();
        assert_eq!(failure_event(&denied), Event::Denied);
        assert_eq!(failure_event(&expired), Event::Expired);
        // Anything else keeps its whole explanation, including the cause chain.
        let other = anyhow!("socket closed").context("lost connection while waiting for approval");
        match failure_event(&other) {
            Event::Error { message } => {
                assert!(message.contains("lost connection"), "{message}");
                assert!(message.contains("socket closed"), "{message}");
            }
            e => panic!("{e:?}"),
        }
    }

    #[tokio::test]
    async fn run_json_writes_only_the_code_event_and_returns_the_grant() {
        let (base, _) = mock_control_api(
            start_json(),
            vec![(
                200,
                r#"{"status":"approved","api_key":"the-key","node_id":"the-node"}"#,
            )],
        )
        .await;
        let mut out = Vec::new();
        let got = run_json(&base, Some("My PC".into()), &mut out)
            .await
            .unwrap();
        assert_eq!(
            got,
            Granted {
                api_key: "the-key".into(),
                node_id: "the-node".into()
            }
        );
        let events = lines(&out);
        assert_eq!(events.len(), 1, "only the code event: {events:?}");
        assert_eq!(events[0]["event"], "code");
        assert_eq!(events[0]["user_code"], "BCDF-GHJK");
        // The complete link (code filled in) is what the person is sent to.
        assert_eq!(events[0]["link"], "https://x.test/pair?code=BCDF-GHJK");
        assert_eq!(events[0]["expires_in"], 600);
        // The secret never appears in the stream.
        assert!(!String::from_utf8_lossy(&out).contains("the-key"));
    }

    #[tokio::test]
    async fn run_json_reports_a_denial_as_a_typed_failure() {
        let (base, _) = mock_control_api(start_json(), vec![(403, r#"{"status":"denied"}"#)]).await;
        let mut out = Vec::new();
        let err = run_json(&base, None, &mut out).await.unwrap_err();
        assert_eq!(
            err.downcast_ref::<PairFailure>(),
            Some(&PairFailure::Denied)
        );
        assert_eq!(
            lines(&out).len(),
            1,
            "the code event only; the caller writes the terminal one"
        );
        assert_eq!(failure_event(&err), Event::Denied);
    }
}
