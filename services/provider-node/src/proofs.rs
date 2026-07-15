use anyhow::{Context, Result};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const HEARTBEAT_MESSAGE_TYPE: &str = "PROXYHUB_PROVIDER_HEARTBEAT";
pub const PROOF_VERSION: &str = "v1";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProviderProofEnvelope {
    pub message_type: String,
    pub version: String,
    pub provider_node_id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub gateway_node_id: String,
    pub provider_hotkey: String,
    pub issued_at: i64,
    pub nonce: String,
    pub payload_hash: String,
    pub signature: String,
}

#[derive(Clone)]
pub struct ProviderSigner {
    signing_key: SigningKey,
    public_key: String,
}

pub struct GeneratedProviderKey {
    pub secret_base58: String,
    pub public_key: String,
}

pub struct HeartbeatPayload<'a> {
    pub provider_node_id: &'a str,
    pub gateway_node_id: &'a str,
    pub latency_ms: i32,
    pub active_connections: i32,
    pub uptime_percent: f64,
    pub issued_at: i64,
}

impl ProviderSigner {
    pub fn generate() -> Result<GeneratedProviderKey> {
        let mut seed = [0_u8; 32];
        getrandom::getrandom(&mut seed)
            .map_err(|err| anyhow::anyhow!("failed to generate provider signing seed: {err}"))?;
        let signer = Self::from_seed(seed);
        Ok(GeneratedProviderKey {
            secret_base58: bs58::encode(seed).into_string(),
            public_key: signer.public_key,
        })
    }

    fn from_seed(seed: [u8; 32]) -> Self {
        let signing_key = SigningKey::from_bytes(&seed);
        let public_key = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
        Self {
            signing_key,
            public_key,
        }
    }

    pub fn from_base58(secret: &str) -> Result<Self> {
        let bytes = bs58::decode(secret.trim())
            .into_vec()
            .context("provider signing key must be base58 encoded")?;
        let seed: [u8; 32] = match bytes.len() {
            32 => bytes
                .as_slice()
                .try_into()
                .context("invalid provider signing seed")?,
            64 => bytes[..32]
                .try_into()
                .context("invalid provider signing keypair")?,
            n => anyhow::bail!("provider signing key must be 32 or 64 bytes, got {n}"),
        };
        Ok(Self::from_seed(seed))
    }

    pub fn public_key(&self) -> &str {
        &self.public_key
    }

    pub fn sign_heartbeat(&self, payload: HeartbeatPayload<'_>) -> ProviderProofEnvelope {
        let payload_hash = hash_heartbeat_payload(&payload);
        let nonce = uuid::Uuid::new_v4().to_string();
        let envelope = ProviderProofEnvelope {
            message_type: HEARTBEAT_MESSAGE_TYPE.to_string(),
            version: PROOF_VERSION.to_string(),
            provider_node_id: payload.provider_node_id.to_string(),
            gateway_node_id: payload.gateway_node_id.to_string(),
            provider_hotkey: self.public_key.clone(),
            issued_at: payload.issued_at,
            nonce,
            payload_hash,
            signature: String::new(),
        };
        let message = build_provider_proof_message(&envelope);
        let signature = self.signing_key.sign(message.as_bytes());
        ProviderProofEnvelope {
            signature: bs58::encode(signature.to_bytes()).into_string(),
            ..envelope
        }
    }
}

pub fn build_provider_proof_message(envelope: &ProviderProofEnvelope) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}:{}:{}",
        envelope.message_type,
        envelope.version,
        envelope.provider_node_id,
        envelope.gateway_node_id,
        envelope.provider_hotkey,
        envelope.issued_at,
        envelope.nonce,
        envelope.payload_hash
    )
}

pub fn hash_heartbeat_payload(payload: &HeartbeatPayload<'_>) -> String {
    sha256_hex(&format!(
        "PROXYHUB_HEARTBEAT_PAYLOAD:v1:{}:{}:{}:{}:{:.6}:{}",
        payload.provider_node_id,
        payload.gateway_node_id,
        payload.latency_ms,
        payload.active_connections,
        payload.uptime_percent,
        payload.issued_at
    ))
}

fn sha256_hex(message: &str) -> String {
    let digest = Sha256::digest(message.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signs_heartbeat_with_base58_public_key() {
        let seed = [7_u8; 32];
        let signer = ProviderSigner::from_base58(&bs58::encode(seed).into_string()).unwrap();
        let proof = signer.sign_heartbeat(HeartbeatPayload {
            provider_node_id: "11111111-1111-1111-1111-111111111111",
            gateway_node_id: "node_provider",
            latency_ms: 12,
            active_connections: 2,
            uptime_percent: 100.0,
            issued_at: 1_777_675_904,
        });

        assert_eq!(proof.message_type, HEARTBEAT_MESSAGE_TYPE);
        assert_eq!(proof.version, PROOF_VERSION);
        assert_eq!(proof.provider_hotkey, signer.public_key());
        assert!(!proof.signature.is_empty());
    }

    #[test]
    fn generated_key_round_trips_through_signer() {
        let generated = ProviderSigner::generate().unwrap();
        let signer = ProviderSigner::from_base58(&generated.secret_base58).unwrap();

        assert_eq!(generated.public_key, signer.public_key());
        assert!(!generated.secret_base58.is_empty());
        assert!(!generated.public_key.is_empty());
    }
}
