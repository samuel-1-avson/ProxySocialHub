//! Signs the listing offers its owner publishes on the website.
//!
//! An offer on the marketplace must be signed with this node's key (`provider_signing_key` in
//! provider.toml). A browser that did not set the node up does not have that key, and finding
//! provider.toml in an application-data folder to paste the key was where people got stuck. So
//! the website asks the node instead (control API: `listing_node_signatures.go`):
//!
//! 1. The website parks the offer at the control API.
//! 2. This loop long-polls `GET /v1/provider/nodes/<id>/offer-signatures`, rebuilds each offer's
//!    hash from its fields (never trusting the hash it is sent), signs it, and posts the proof to
//!    `POST /v1/provider/nodes/<id>/offer-signatures/<request>`.
//! 3. The website publishes the offer with that proof.
//!
//! The key never leaves this computer. Only offers for this node are signed, and every signature
//! is written to the node log so the owner can see what was signed.

use crate::proofs::{hash_listing_offer_payload, ListingOfferPayload, ProviderSigner};
use anyhow::{Context, Result};
use serde::Deserialize;
use std::time::Duration;
use tokio::sync::watch;
use tracing::{debug, info, warn};

/// How long the control API may hold one poll open (it caps this at 25 s).
const POLL_WAIT_SECS: u64 = 25;
/// Client timeout for a held poll: the wait plus room for a slow network.
const POLL_TIMEOUT: Duration = Duration::from_secs(POLL_WAIT_SECS + 15);
const ANSWER_TIMEOUT: Duration = Duration::from_secs(15);
/// Waits after a failed poll: doubled up to the cap, reset by a successful poll.
const RETRY_MIN: Duration = Duration::from_secs(5);
const RETRY_MAX: Duration = Duration::from_secs(120);
/// A control API without this feature answers 404 for the route; ask again rarely.
const UNSUPPORTED_RETRY: Duration = Duration::from_secs(15 * 60);
/// Least time between two polls that returned at once with nothing answered.
const MIN_POLL_SPACING: Duration = Duration::from_secs(2);

#[derive(Deserialize)]
struct PollResponse {
    #[serde(default)]
    requests: Vec<SignRequest>,
}

#[derive(Deserialize, Clone, Debug)]
pub(crate) struct SignRequest {
    pub id: String,
    pub payload: WireOffer,
    pub payload_hash: String,
}

/// The offer as the control API sends it. Numbers are decimal strings: parsed here they give
/// back exactly the server's float64, so both sides format the same digits.
#[derive(Deserialize, Clone, Debug)]
pub(crate) struct WireOffer {
    pub provider_node_id: String,
    #[serde(default)]
    pub gateway_node_id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub proxy_type: String,
    pub protocol: String,
    pub rotation_type: String,
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub isp: String,
    pub price_per_gb: String,
    pub min_purchase_gb: String,
    pub available_bandwidth_gb: String,
    pub max_concurrency: i64,
    pub status: String,
    #[serde(default)]
    pub expires_at: i64,
}

impl WireOffer {
    fn to_payload(&self) -> std::result::Result<ListingOfferPayload, String> {
        let num = |field: &str, raw: &str| -> std::result::Result<f64, String> {
            raw.trim()
                .parse::<f64>()
                .ok()
                .filter(|v| v.is_finite())
                .ok_or_else(|| format!("{field} is not a number ({raw:?})"))
        };
        Ok(ListingOfferPayload {
            provider_node_id: self.provider_node_id.clone(),
            gateway_node_id: self.gateway_node_id.clone(),
            title: self.title.clone(),
            description: self.description.clone(),
            proxy_type: self.proxy_type.clone(),
            protocol: self.protocol.clone(),
            rotation_type: self.rotation_type.clone(),
            country: self.country.clone(),
            isp: self.isp.clone(),
            price_per_gb: num("price_per_gb", &self.price_per_gb)?,
            min_purchase_gb: num("min_purchase_gb", &self.min_purchase_gb)?,
            available_bandwidth_gb: num("available_bandwidth_gb", &self.available_bandwidth_gb)?,
            max_concurrency: self.max_concurrency,
            status: self.status.clone(),
            expires_at: self.expires_at,
        })
    }
}

/// What the node sends back for one request.
#[derive(Debug)]
pub(crate) enum Answer {
    Proof(crate::proofs::ProviderProofEnvelope),
    Refused(String),
}

/// Decide the answer for one request. Signs only offers for this node, and only when the hash
/// it computes itself equals the one the server will check (otherwise the signature could not
/// verify, and saying why is more useful than a silent failure).
pub(crate) fn answer_for(
    signer: &ProviderSigner,
    own_node_id: &str,
    req: &SignRequest,
    now_unix: i64,
) -> Answer {
    if !req
        .payload
        .provider_node_id
        .trim()
        .eq_ignore_ascii_case(own_node_id.trim())
    {
        return Answer::Refused(format!(
            "the offer is for node {}, this node is {}",
            req.payload.provider_node_id, own_node_id
        ));
    }
    let payload = match req.payload.to_payload() {
        Ok(payload) => payload,
        Err(why) => return Answer::Refused(why),
    };
    let hash = hash_listing_offer_payload(&payload);
    if !hash.eq_ignore_ascii_case(req.payload_hash.trim()) {
        return Answer::Refused(format!(
            "this node computed offer hash {hash}, the server expects {}; update provider-node",
            req.payload_hash
        ));
    }
    Answer::Proof(signer.sign_listing_offer(&payload, now_unix))
}

enum PollFailure {
    /// The token was refused; the heartbeat loop refreshes it.
    Unauthorized,
    /// The control API does not know this route (or this node).
    Unsupported,
    Other(anyhow::Error),
}

pub struct OfferSigner {
    client: reqwest::Client,
    control_api_url: String,
    node_id: String,
    signer: ProviderSigner,
    token: watch::Receiver<String>,
}

impl OfferSigner {
    /// `None` when there is nothing to sign with or no Control API node to sign for.
    pub fn new(
        control_api_url: &str,
        node_id: &str,
        signer: Option<ProviderSigner>,
        token: watch::Receiver<String>,
    ) -> Option<Self> {
        let signer = signer?;
        let node_id = node_id.trim();
        let control_api_url = control_api_url.trim().trim_end_matches('/');
        // The control API's routes take the provider_nodes UUID, not the gateway runtime id.
        if uuid::Uuid::parse_str(node_id).is_err() || control_api_url.is_empty() {
            return None;
        }
        let client = reqwest::Client::builder()
            .timeout(POLL_TIMEOUT)
            .build()
            .ok()?;
        Some(Self {
            client,
            control_api_url: control_api_url.to_string(),
            node_id: node_id.to_string(),
            signer,
            token,
        })
    }

    /// Poll and sign until the surrounding heartbeat task ends.
    pub async fn run(self) {
        info!(
            node_id = %self.node_id,
            "Listing offers published on the website will be signed by this node"
        );
        let mut retry = RETRY_MIN;
        loop {
            let started = std::time::Instant::now();
            match self.run_once(POLL_WAIT_SECS).await {
                Ok(answered) => {
                    retry = RETRY_MIN;
                    // A held poll takes up to 25 s. One that comes back at once with nothing
                    // done (a proxy dropping `wait`, every answer failing) must not spin.
                    if answered == 0 && started.elapsed() < MIN_POLL_SPACING {
                        tokio::time::sleep(MIN_POLL_SPACING).await;
                    }
                }
                Err(PollFailure::Unauthorized) => {
                    debug!("Offer signing poll unauthorized; waiting for a refreshed token");
                    tokio::time::sleep(Duration::from_secs(30)).await;
                }
                Err(PollFailure::Unsupported) => {
                    debug!("Control API has no offer signing for this node; checking again later");
                    tokio::time::sleep(UNSUPPORTED_RETRY).await;
                }
                Err(PollFailure::Other(e)) => {
                    debug!(error = %format!("{e:#}"), "Offer signing poll failed");
                    tokio::time::sleep(retry).await;
                    retry = (retry * 2).min(RETRY_MAX);
                }
            }
        }
    }

    /// One poll, then an answer for every request it returned. Returns how many were answered.
    async fn run_once(&self, wait_secs: u64) -> std::result::Result<usize, PollFailure> {
        let token = self.token.borrow().clone();
        let url = format!(
            "{}/v1/provider/nodes/{}/offer-signatures?wait={wait_secs}",
            self.control_api_url, self.node_id
        );
        let resp = self
            .client
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .context("offer signing poll")
            .map_err(PollFailure::Other)?;
        match resp.status().as_u16() {
            200 => {}
            401 => return Err(PollFailure::Unauthorized),
            404 | 405 => return Err(PollFailure::Unsupported),
            code => {
                return Err(PollFailure::Other(anyhow::anyhow!(
                    "offer signing poll answered HTTP {code}"
                )))
            }
        }
        let body: PollResponse = resp
            .json()
            .await
            .context("offer signing poll body")
            .map_err(PollFailure::Other)?;

        let mut answered = 0;
        for req in &body.requests {
            let answer = answer_for(&self.signer, &self.node_id, req, unix_now());
            if let Err(e) = self.send_answer(&token, req, &answer).await {
                warn!(error = %format!("{e:#}"), request = %req.id, "Could not send offer signature");
                continue;
            }
            answered += 1;
            match &answer {
                Answer::Proof(_) => {
                    let line = format!(
                        "signed listing offer \"{}\" for the website: {} USD/GB, {} GB available, {} {}",
                        req.payload.title,
                        req.payload.price_per_gb,
                        req.payload.available_bandwidth_gb,
                        req.payload.proxy_type,
                        req.payload.protocol
                    );
                    info!("{line}");
                    crate::paths::append_log(&line);
                }
                Answer::Refused(why) => {
                    let line = format!(
                        "declined to sign listing offer \"{}\": {why}",
                        req.payload.title
                    );
                    warn!("{line}");
                    crate::paths::append_log(&line);
                }
            }
        }
        Ok(answered)
    }

    async fn send_answer(&self, token: &str, req: &SignRequest, answer: &Answer) -> Result<()> {
        let url = format!(
            "{}/v1/provider/nodes/{}/offer-signatures/{}",
            self.control_api_url, self.node_id, req.id
        );
        let body = match answer {
            Answer::Proof(proof) => serde_json::json!({ "proof": proof }),
            Answer::Refused(why) => serde_json::json!({ "refused": why }),
        };
        let resp = self
            .client
            .post(&url)
            .bearer_auth(token)
            .json(&body)
            .timeout(ANSWER_TIMEOUT)
            .send()
            .await
            .context("offer signature answer")?;
        let status = resp.status();
        if status.is_success() {
            return Ok(());
        }
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("HTTP {status}: {text}")
    }
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    const NODE: &str = "11111111-2222-4333-8444-555555555555";
    // Shared vector: see proofs::tests::listing_offer_hash_matches_the_shared_vector.
    const VECTOR_HASH: &str = "f4b6a6b64c4ab8f9da2ef33b4d72d349f1de9c2c13ae4376b63380b8dfbb4938";

    fn signer() -> ProviderSigner {
        ProviderSigner::from_base58(&bs58::encode([5_u8; 32]).into_string()).unwrap()
    }

    fn request_json(node: &str, hash: &str) -> String {
        format!(
            r#"{{"id":"req-1","payload":{{"provider_node_id":"{node}","gateway_node_id":"gw-test",
            "title":"Accra home fibre","description":"Residential line: weekdays only",
            "proxy_type":"residential","protocol":"http,https,socks5","rotation_type":"rotating",
            "country":"GH","isp":"","price_per_gb":"0.792","min_purchase_gb":"1",
            "available_bandwidth_gb":"13","max_concurrency":10,"status":"active","expires_at":0}},
            "payload_hash":"{hash}","requested_at":1}}"#
        )
    }

    fn request(node: &str, hash: &str) -> SignRequest {
        serde_json::from_str(&request_json(node, hash)).unwrap()
    }

    #[test]
    fn signs_an_offer_for_this_node_with_the_hash_it_computes_itself() {
        let s = signer();
        match answer_for(&s, NODE, &request(NODE, VECTOR_HASH), 1_777_675_904) {
            Answer::Proof(proof) => {
                assert_eq!(proof.payload_hash, VECTOR_HASH);
                assert_eq!(proof.provider_node_id, NODE);
                assert_eq!(proof.gateway_node_id, "gw-test");
                assert_eq!(proof.provider_hotkey, s.public_key());
                assert_eq!(proof.issued_at, 1_777_675_904);
            }
            other => panic!("expected a proof, got {other:?}"),
        }
    }

    #[test]
    fn refuses_an_offer_for_another_node() {
        let other = "99999999-2222-4333-8444-555555555555";
        match answer_for(&signer(), NODE, &request(other, VECTOR_HASH), 1) {
            Answer::Refused(why) => assert!(why.contains(other), "{why}"),
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn refuses_when_the_server_hash_is_not_what_the_fields_say() {
        // A server (or an older build) that hashes differently must not get a signature over a
        // hash this node did not compute, and the website should hear why.
        match answer_for(&signer(), NODE, &request(NODE, &"0".repeat(64)), 1) {
            Answer::Refused(why) => assert!(why.contains("update provider-node"), "{why}"),
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn refuses_an_unreadable_number() {
        let mut req = request(NODE, VECTOR_HASH);
        req.payload.price_per_gb = "cheap".into();
        match answer_for(&signer(), NODE, &req, 1) {
            Answer::Refused(why) => assert!(why.contains("price_per_gb"), "{why}"),
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn number_strings_parse_to_the_same_digits_the_server_formats() {
        // Go sends strconv.FormatFloat(v, 'f', -1, 64): the shortest string that round-trips.
        for (wire, nine) in [
            ("0.792", "0.792000000"),
            ("0.30000000000000004", "0.300000000"),
            ("0.0000001", "0.000000100"),
            ("123456.789", "123456.789000000"),
        ] {
            let v: f64 = wire.parse().unwrap();
            assert_eq!(format!("{v:.9}"), nine);
        }
    }

    #[test]
    fn needs_a_key_and_a_node_id() {
        let (_tx, rx) = watch::channel(String::new());
        assert!(OfferSigner::new("http://x", NODE, None, rx.clone()).is_none());
        assert!(OfferSigner::new("http://x", "  ", Some(signer()), rx.clone()).is_none());
        assert!(
            OfferSigner::new("http://x", "node_provider", Some(signer()), rx.clone()).is_none()
        );
        assert!(OfferSigner::new("", NODE, Some(signer()), rx.clone()).is_none());
        assert!(OfferSigner::new("http://x", NODE, Some(signer()), rx).is_some());
    }

    type Seen = Arc<Mutex<Vec<(String, String)>>>;

    /// Answers GET .../offer-signatures with `poll_body` (status `poll_code`) and records every
    /// request line, its Authorization header and body.
    async fn mock_api(poll_code: u16, poll_body: String) -> (String, Seen) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let seen: Seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                let (poll_body, log) = (poll_body.clone(), log.clone());
                tokio::spawn(async move {
                    let mut data = Vec::new();
                    let mut buf = [0u8; 4096];
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
                    let req = String::from_utf8_lossy(&data).to_string();
                    let first = req.lines().next().unwrap_or_default().to_string();
                    let body = req.split("\r\n\r\n").nth(1).unwrap_or_default().to_string();
                    let auth = req
                        .lines()
                        .find(|l| l.to_ascii_lowercase().starts_with("authorization:"))
                        .unwrap_or_default()
                        .to_string();
                    log.lock()
                        .unwrap()
                        .push((format!("{first} | {auth}"), body));
                    let (code, out) = if first.starts_with("GET ") {
                        (poll_code, poll_body)
                    } else {
                        (200, r#"{"status":"signed"}"#.to_string())
                    };
                    let resp = format!(
                        "HTTP/1.1 {code} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{out}",
                        out.len()
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                    let _ = sock.shutdown().await;
                });
            }
        });
        (base, seen)
    }

    #[tokio::test]
    async fn polls_with_the_current_token_and_posts_the_proof_back() {
        let poll = format!(r#"{{"requests":[{}]}}"#, request_json(NODE, VECTOR_HASH));
        let (base, seen) = mock_api(200, poll).await;
        let (tx, rx) = watch::channel("first-token".to_string());
        let s = signer();
        let offers = OfferSigner::new(&base, NODE, Some(s.clone()), rx).unwrap();
        // A refreshed token is used from the next poll on.
        tx.send("fresh-token".to_string()).unwrap();

        let answered = offers.run_once(0).await.ok().unwrap();
        assert_eq!(answered, 1);

        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 2, "{seen:?}");
        assert!(seen[0].0.starts_with(&format!(
            "GET /v1/provider/nodes/{NODE}/offer-signatures?wait=0"
        )));
        assert!(seen[0].0.contains("Bearer fresh-token"), "{}", seen[0].0);
        assert!(seen[1].0.starts_with(&format!(
            "POST /v1/provider/nodes/{NODE}/offer-signatures/req-1"
        )));
        let posted: serde_json::Value = serde_json::from_str(&seen[1].1).unwrap();
        assert_eq!(posted["proof"]["payload_hash"], VECTOR_HASH);
        assert_eq!(posted["proof"]["provider_hotkey"], s.public_key());
        assert_eq!(posted["proof"]["message_type"], "PROXYHUB_LISTING_OFFER");
    }

    #[tokio::test]
    async fn posts_a_refusal_for_an_offer_it_will_not_sign() {
        let poll = format!(
            r#"{{"requests":[{}]}}"#,
            request_json(NODE, &"0".repeat(64))
        );
        let (base, seen) = mock_api(200, poll).await;
        let (_tx, rx) = watch::channel("t".to_string());
        let offers = OfferSigner::new(&base, NODE, Some(signer()), rx).unwrap();
        assert_eq!(offers.run_once(0).await.ok().unwrap(), 1);
        let seen = seen.lock().unwrap();
        let posted: serde_json::Value = serde_json::from_str(&seen[1].1).unwrap();
        assert!(posted["refused"].as_str().unwrap().contains("update"));
        assert!(posted.get("proof").is_none());
    }

    #[tokio::test]
    async fn an_old_control_api_is_reported_as_unsupported() {
        let (base, _) = mock_api(404, "404 page not found".into()).await;
        let (_tx, rx) = watch::channel("t".to_string());
        let offers = OfferSigner::new(&base, NODE, Some(signer()), rx).unwrap();
        assert!(matches!(
            offers.run_once(0).await,
            Err(PollFailure::Unsupported)
        ));
    }

    #[tokio::test]
    async fn an_empty_poll_answers_nothing() {
        let (base, seen) = mock_api(200, r#"{"requests":[]}"#.into()).await;
        let (_tx, rx) = watch::channel("t".to_string());
        let offers = OfferSigner::new(&base, NODE, Some(signer()), rx).unwrap();
        assert_eq!(offers.run_once(0).await.ok().unwrap(), 0);
        assert_eq!(seen.lock().unwrap().len(), 1);
    }
}
