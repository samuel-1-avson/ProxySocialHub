use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const HEARTBEAT_MESSAGE_TYPE: &str = "PROXYHUB_PROVIDER_HEARTBEAT";
pub const PROOF_VERSION: &str = "v1";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProviderProofEnvelope {
    pub message_type: String,
    pub version: String,
    pub provider_node_id: String,
    #[serde(default)]
    pub gateway_node_id: String,
    pub provider_hotkey: String,
    pub issued_at: i64,
    pub nonce: String,
    pub payload_hash: String,
    pub signature: String,
}

pub struct HeartbeatPayload<'a> {
    pub provider_node_id: &'a str,
    pub gateway_node_id: &'a str,
    pub latency_ms: i32,
    pub active_connections: u32,
    pub uptime_percent: f64,
    pub issued_at: i64,
}

pub fn verify_heartbeat_proof(
    proof: &ProviderProofEnvelope,
    payload: HeartbeatPayload<'_>,
) -> Result<(), String> {
    if proof.message_type != HEARTBEAT_MESSAGE_TYPE {
        return Err("unexpected proof message type".to_string());
    }
    if proof.version != PROOF_VERSION {
        return Err("unsupported proof version".to_string());
    }
    if proof.provider_node_id != payload.provider_node_id {
        return Err("provider node id mismatch".to_string());
    }
    if proof.gateway_node_id != payload.gateway_node_id {
        return Err("gateway node id mismatch".to_string());
    }
    let expected_hash = hash_heartbeat_payload(&payload);
    if !proof.payload_hash.eq_ignore_ascii_case(&expected_hash) {
        return Err("payload hash mismatch".to_string());
    }
    let pubkey_bytes = bs58::decode(&proof.provider_hotkey)
        .into_vec()
        .map_err(|_| "invalid provider hotkey".to_string())?;
    let pubkey_array: [u8; 32] = pubkey_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "invalid provider hotkey length".to_string())?;
    let sig_bytes = bs58::decode(&proof.signature)
        .into_vec()
        .map_err(|_| "invalid provider signature".to_string())?;
    let sig_array: [u8; 64] = sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "invalid provider signature length".to_string())?;
    let verifying_key = VerifyingKey::from_bytes(&pubkey_array)
        .map_err(|_| "invalid provider verifying key".to_string())?;
    let signature = Signature::from_bytes(&sig_array);
    verifying_key
        .verify(build_provider_proof_message(proof).as_bytes(), &signature)
        .map_err(|_| "provider signature verification failed".to_string())
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
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn verifies_valid_heartbeat_proof() {
        let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
        let provider_hotkey = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
        let payload = HeartbeatPayload {
            provider_node_id: "11111111-1111-1111-1111-111111111111",
            gateway_node_id: "node_provider",
            latency_ms: 12,
            active_connections: 2,
            uptime_percent: 100.0,
            issued_at: 1_777_675_904,
        };
        let mut proof = ProviderProofEnvelope {
            message_type: HEARTBEAT_MESSAGE_TYPE.to_string(),
            version: PROOF_VERSION.to_string(),
            provider_node_id: payload.provider_node_id.to_string(),
            gateway_node_id: payload.gateway_node_id.to_string(),
            provider_hotkey,
            issued_at: payload.issued_at,
            nonce: "nonce".to_string(),
            payload_hash: hash_heartbeat_payload(&payload),
            signature: String::new(),
        };
        proof.signature = bs58::encode(
            signing_key
                .sign(build_provider_proof_message(&proof).as_bytes())
                .to_bytes(),
        )
        .into_string();

        assert!(verify_heartbeat_proof(&proof, payload).is_ok());
    }

    #[test]
    fn rejects_tampered_heartbeat_payload() {
        let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
        let provider_hotkey = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
        let payload = HeartbeatPayload {
            provider_node_id: "11111111-1111-1111-1111-111111111111",
            gateway_node_id: "node_provider",
            latency_ms: 12,
            active_connections: 2,
            uptime_percent: 100.0,
            issued_at: 1_777_675_904,
        };
        let mut proof = ProviderProofEnvelope {
            message_type: HEARTBEAT_MESSAGE_TYPE.to_string(),
            version: PROOF_VERSION.to_string(),
            provider_node_id: payload.provider_node_id.to_string(),
            gateway_node_id: payload.gateway_node_id.to_string(),
            provider_hotkey,
            issued_at: payload.issued_at,
            nonce: "nonce".to_string(),
            payload_hash: hash_heartbeat_payload(&payload),
            signature: String::new(),
        };
        proof.signature = bs58::encode(
            signing_key
                .sign(build_provider_proof_message(&proof).as_bytes())
                .to_bytes(),
        )
        .into_string();

        let tampered = HeartbeatPayload {
            active_connections: 99,
            ..payload
        };
        assert!(verify_heartbeat_proof(&proof, tampered).is_err());
    }
}
