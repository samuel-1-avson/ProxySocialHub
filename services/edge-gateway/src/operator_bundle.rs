use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

const BUNDLE_TYPE: &str = "PROXYHUB_OPERATOR_MANIFEST_BUNDLE";
const MANIFEST_PREFIX: &str = "PROXYHUB_OPERATOR_MANIFEST:v1:";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ManifestBundle {
    #[serde(default)]
    pub message_type: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub issued_at: i64,
    #[serde(default)]
    pub operators: Vec<BundleOperator>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BundleOperator {
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub pubkey: String,
    #[serde(default)]
    pub host_id: String,
    #[serde(default)]
    pub org_id: String,
    #[serde(default)]
    pub buyer_base_url: String,
    #[serde(default)]
    pub health_url: String,
    #[serde(default)]
    pub tunnel_addrs: Vec<String>,
    #[serde(default)]
    pub peer_urls: Vec<String>,
    #[serde(default)]
    pub stake_account: String,
    #[serde(default)]
    pub min_stake_lamports: i64,
    #[serde(default)]
    pub bonded: bool,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub manifest_payload: String,
    #[serde(default)]
    pub manifest_signature: String,
    #[serde(default)]
    pub manifest_expires_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VerifiedOperator {
    pub slug: String,
    pub host_id: String,
    pub org_id: String,
    pub buyer_base_url: String,
    pub pubkey: String,
    pub verified: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoadedBundle {
    pub discovery_sot: String,
    pub source: String,
    pub operators: Vec<VerifiedOperator>,
    pub error: String,
}

impl LoadedBundle {
    fn empty() -> Self {
        Self {
            discovery_sot: "none".to_string(),
            source: String::new(),
            operators: Vec::new(),
            error: String::new(),
        }
    }

    /// Wave 11.A — verified bundle pubkeys may mint capabilities (not only the platform issuer).
    pub fn verified_issuer_pubkeys(&self) -> Vec<String> {
        let mut out = Vec::new();
        for op in &self.operators {
            let pk = op.pubkey.trim();
            if op.verified && !pk.is_empty() && !out.iter().any(|e| e == pk) {
                out.push(pk.to_string());
            }
        }
        out
    }
}

fn loaded() -> &'static Mutex<LoadedBundle> {
    static S: OnceLock<Mutex<LoadedBundle>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(LoadedBundle::empty()))
}

pub fn snapshot() -> LoadedBundle {
    loaded()
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| LoadedBundle::empty())
}

pub fn bundle_pin_configured() -> bool {
    env_nonempty("PROXYHUB_OPERATOR_BUNDLE_PATH")
        || env_nonempty("PROXYHUB_OPERATOR_BUNDLE_URL")
        || env_nonempty("PROXYHUB_OPERATOR_BUNDLE_CID")
}

fn env_nonempty(key: &str) -> bool {
    std::env::var(key)
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

pub fn canonical_manifest_bytes(op: &BundleOperator) -> Vec<u8> {
    let exp = op.manifest_expires_at.unwrap_or(0);
    let bonded = if op.bonded { "1" } else { "0" };
    let tunnels = normalize_join(&op.tunnel_addrs);
    let peers = normalize_join(&op.peer_urls);
    format!(
        "{MANIFEST_PREFIX}{}|{}|{}|{}|{}|{}|{}|{}|{}|{exp}",
        op.slug.trim(),
        op.pubkey.trim(),
        op.host_id.trim(),
        op.buyer_base_url.trim(),
        tunnels,
        peers,
        op.stake_account.trim(),
        op.min_stake_lamports,
        bonded,
    )
    .into_bytes()
}

fn normalize_join(items: &[String]) -> String {
    items
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(",")
}

fn verify_ed25519_b58(pubkey_b58: &str, message: &[u8], signature_b58: &str) -> bool {
    let pk = match bs58::decode(pubkey_b58.trim()).into_vec() {
        Ok(v) => v,
        Err(_) => return false,
    };
    let sig = match bs58::decode(signature_b58.trim()).into_vec() {
        Ok(v) => v,
        Err(_) => return false,
    };
    let vk = match VerifyingKey::try_from(pk.as_slice()) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let signature = match Signature::try_from(sig.as_slice()) {
        Ok(s) => s,
        Err(_) => return false,
    };
    vk.verify(message, &signature).is_ok()
}

pub fn verify_operator(op: &BundleOperator) -> (bool, String) {
    if op.manifest_signature.trim().is_empty() {
        return (false, "unsigned".to_string());
    }
    if op.pubkey.trim().is_empty() {
        return (false, "missing pubkey".to_string());
    }
    if let Some(exp) = op.manifest_expires_at {
        let now = chrono::Utc::now().timestamp();
        if now > exp {
            return (false, "expired".to_string());
        }
    }
    let msg = canonical_manifest_bytes(op);
    if !verify_ed25519_b58(&op.pubkey, &msg, &op.manifest_signature) {
        return (false, "bad signature".to_string());
    }
    (true, String::new())
}

pub fn verify_bundle(bundle: &ManifestBundle) -> Vec<VerifiedOperator> {
    bundle
        .operators
        .iter()
        .map(|op| {
            let (verified, reason) = verify_operator(op);
            VerifiedOperator {
                slug: op.slug.clone(),
                host_id: op.host_id.clone(),
                org_id: op.org_id.clone(),
                buyer_base_url: op.buyer_base_url.clone(),
                pubkey: op.pubkey.clone(),
                verified,
                reason,
            }
        })
        .collect()
}

fn parse_bundle(raw: &[u8]) -> Result<ManifestBundle, String> {
    let b: ManifestBundle =
        serde_json::from_slice(raw).map_err(|e| format!("operator bundle json: {e}"))?;
    if !b.message_type.is_empty() && b.message_type != BUNDLE_TYPE {
        return Err(format!("unexpected message_type {}", b.message_type));
    }
    Ok(b)
}

/// Load a pinned bundle (file / URL / CID). When a pin is set, do **not** GET control-api.
pub async fn load_from_env() {
    let mut out = LoadedBundle::empty();
    if let Ok(path) = std::env::var("PROXYHUB_OPERATOR_BUNDLE_PATH") {
        let path = path.trim().to_string();
        if !path.is_empty() {
            out.source = format!("path:{path}");
            out.discovery_sot = "bundle".to_string();
            match std::fs::read(&path) {
                Ok(raw) => apply_bytes(&mut out, &raw),
                Err(e) => out.error = format!("read {path}: {e}"),
            }
            store(out);
            return;
        }
    }
    if let Ok(url) = std::env::var("PROXYHUB_OPERATOR_BUNDLE_URL") {
        let url = url.trim().to_string();
        if !url.is_empty() {
            out.source = format!("url:{url}");
            out.discovery_sot = "bundle".to_string();
            match fetch_bytes(&url).await {
                Ok(raw) => apply_bytes(&mut out, &raw),
                Err(e) => out.error = e,
            }
            store(out);
            return;
        }
    }
    if let Ok(cid) = std::env::var("PROXYHUB_OPERATOR_BUNDLE_CID") {
        let cid = cid.trim().to_string();
        if !cid.is_empty() {
            let gw = std::env::var("IPFS_GATEWAY")
                .unwrap_or_else(|_| "https://ipfs.io/ipfs/".to_string());
            let gw = if gw.ends_with('/') {
                gw
            } else {
                format!("{gw}/")
            };
            let url = format!("{gw}{cid}");
            out.source = format!("cid:{cid}");
            out.discovery_sot = "bundle".to_string();
            match fetch_bytes(&url).await {
                Ok(raw) => apply_bytes(&mut out, &raw),
                Err(e) => out.error = e,
            }
            store(out);
            return;
        }
    }
    // No pin: optional live directory GET (best-effort). Bundle pin skips this.
    let api = std::env::var("CONTROL_API_URL").unwrap_or_default();
    let api = api.trim().trim_end_matches('/').to_string();
    if api.is_empty() {
        store(out);
        return;
    }
    let url = format!("{api}/v1/gateways/operators/bundle");
    out.source = format!("control_api:{url}");
    out.discovery_sot = "control_api".to_string();
    match fetch_bytes(&url).await {
        Ok(raw) => apply_bytes(&mut out, &raw),
        Err(e) => {
            out.error = e;
            tracing::info!("operator bundle: live directory GET skipped/failed (pin unset)");
        }
    }
    store(out);
}

fn apply_bytes(out: &mut LoadedBundle, raw: &[u8]) {
    match parse_bundle(raw) {
        Ok(b) => out.operators = verify_bundle(&b),
        Err(e) => out.error = e,
    }
}

fn store(out: LoadedBundle) {
    if let Ok(mut g) = loaded().lock() {
        *g = out;
    }
}

#[cfg(test)]
pub fn store_for_test(out: LoadedBundle) {
    store(out);
}

async fn fetch_bytes(url: &str) -> Result<Vec<u8>, String> {
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("GET {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GET {url}: {}", resp.status()));
    }
    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("GET {url} body: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn canonical_manifest_matches_control_api() {
        let op = BundleOperator {
            slug: "edge-b".into(),
            pubkey: "opk".into(),
            host_id: "gce-w6-b".into(),
            buyer_base_url: "http://203.0.113.10:8090".into(),
            tunnel_addrs: vec!["203.0.113.10:3128".into()],
            peer_urls: vec!["edge-a@http://10.0.0.1:8090".into()],
            bonded: true,
            min_stake_lamports: 0,
            manifest_expires_at: Some(1_700_000_000),
            ..Default::default()
        };
        let got = canonical_manifest_bytes(&op);
        let want = b"PROXYHUB_OPERATOR_MANIFEST:v1:edge-b|opk|gce-w6-b|http://203.0.113.10:8090|203.0.113.10:3128|edge-a@http://10.0.0.1:8090||0|1|1700000000";
        assert_eq!(got, want);
    }

    #[test]
    fn verify_operator_local_ed25519() {
        let signing_key = SigningKey::from_bytes(&[9_u8; 32]);
        let pubkey = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
        let mut op = BundleOperator {
            slug: "edge-a".into(),
            pubkey: pubkey.clone(),
            host_id: "gce-a".into(),
            buyer_base_url: "http://10.0.0.1:8090".into(),
            bonded: true,
            manifest_expires_at: Some(chrono::Utc::now().timestamp() + 3600),
            ..Default::default()
        };
        let msg = canonical_manifest_bytes(&op);
        op.manifest_signature = bs58::encode(signing_key.sign(&msg).to_bytes()).into_string();
        let (ok, reason) = verify_operator(&op);
        assert!(ok, "{reason}");
        op.buyer_base_url = "http://evil".into();
        let (ok, _) = verify_operator(&op);
        assert!(!ok);
    }

    #[test]
    fn bundle_pin_skips_when_path_set() {
        std::env::set_var("PROXYHUB_OPERATOR_BUNDLE_PATH", "/tmp/operators.json");
        assert!(bundle_pin_configured());
        std::env::remove_var("PROXYHUB_OPERATOR_BUNDLE_PATH");
    }

    #[test]
    fn verified_issuer_pubkeys_skips_unverified() {
        let b = LoadedBundle {
            operators: vec![
                VerifiedOperator {
                    slug: "ok".into(),
                    host_id: "h".into(),
                    org_id: "o".into(),
                    buyer_base_url: String::new(),
                    pubkey: "VerifiedOp111111111111111111111111111".into(),
                    verified: true,
                    reason: String::new(),
                },
                VerifiedOperator {
                    slug: "bad".into(),
                    host_id: "h".into(),
                    org_id: "o".into(),
                    buyer_base_url: String::new(),
                    pubkey: "Unverified22222222222222222222222222".into(),
                    verified: false,
                    reason: "unsigned".into(),
                },
            ],
            ..LoadedBundle::empty()
        };
        let keys = b.verified_issuer_pubkeys();
        assert_eq!(
            keys,
            vec!["VerifiedOp111111111111111111111111111".to_string()]
        );
    }
}
