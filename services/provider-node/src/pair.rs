//! Device pairing: get provider credentials by approving a short code in the dashboard,
//! instead of downloading a setup script with a token written into it.
//!
//! The server side is `services/control-api/internal/api/provider_pairing.go`:
//!   POST /v1/provider/pair/start  -> device_code (secret, stays here) + user_code (shown)
//!   POST /v1/provider/pair/poll   -> pending | slow_down | approved(api_key,node_id) | ...
//! The raw `api_key` comes back exactly once, in the poll that sees the approval.

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// Never poll faster than the server asked; also a floor if it sends 0.
const MIN_POLL_INTERVAL: Duration = Duration::from_secs(1);
/// Keep waiting this long past the advertised expiry before giving up locally.
const EXPIRY_SLACK: Duration = Duration::from_secs(15);
/// Consecutive network failures tolerated while polling (a flaky connection is normal).
const MAX_CONSECUTIVE_POLL_ERRORS: u32 = 6;

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
    Rejected(String),
}

/// Run the whole flow: start, show the code, wait for the owner to approve it.
pub async fn run(
    api_url: &str,
    device_name: Option<String>,
    open_browser: bool,
) -> Result<Granted> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(format!("provider-node/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .context("failed to build HTTP client")?;
    let base = api_url.trim_end_matches('/');

    let started = start(&client, base, device_name).await?;
    announce(&started, open_browser);

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
    let name = device_name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .or_else(sysinfo::System::host_name)
        .unwrap_or_else(|| "Unnamed device".to_string());

    let resp = client
        .post(format!("{base}/v1/provider/pair/start"))
        .json(&serde_json::json!({
            "device_name": name,
            "platform": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "client_version": env!("CARGO_PKG_VERSION"),
        }))
        .send()
        .await
        .with_context(|| format!("could not reach the Control API at {base}"))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let detail = serde_json::from_str::<PollBody>(&text)
            .ok()
            .and_then(|b| b.error)
            .unwrap_or_else(|| text.chars().take(200).collect());
        bail!("pairing could not start ({status}): {detail}");
    }
    serde_json::from_str(&text).context("unexpected response when starting pairing")
}

fn announce(started: &StartResponse, open_browser: bool) {
    let link = started
        .verification_uri_complete
        .clone()
        .unwrap_or_else(|| started.verification_uri.clone());
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

    loop {
        if Instant::now() >= deadline {
            bail!("The code expired before it was approved. Run `provider-node pair` again.");
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

        match parse_poll(code, &text) {
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
            PollOutcome::Denied => bail!(
                "The request was denied in the dashboard. Nothing was changed on this computer."
            ),
            PollOutcome::Expired => {
                bail!("The code expired before it was approved. Run `provider-node pair` again.")
            }
            PollOutcome::Redeemed => bail!(
                "This pairing was already completed, but its key never reached this computer. \
                 Run `provider-node pair` again (you can remove the unused node in the dashboard)."
            ),
            PollOutcome::Rejected(why) => bail!("pairing failed: {why}"),
        }
    }
}

fn parse_poll(http_status: u16, body: &str) -> PollOutcome {
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
        assert!(matches!(
            parse_poll(502, "<html>bad gateway</html>"),
            PollOutcome::Rejected(_)
        ));
        assert!(matches!(parse_poll(200, ""), PollOutcome::Rejected(_)));
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
}
