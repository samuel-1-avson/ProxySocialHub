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

pub const RECEIPT_VERSION: &str = "v1";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct MutualReceiptOffer {
    pub version: String,
    pub escrow_pda: String,
    pub buyer_pubkey: String,
    pub seller_pubkey: String,
    pub bytes_used: u64,
    pub sequence_num: u64,
    pub session_timestamp: i64,
    pub seller_signature: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct MutualReceiptAck {
    pub offer: MutualReceiptOffer,
    pub buyer_signature: String,
}

pub fn build_receipt_canonical_message(
    escrow: &str,
    buyer: &str,
    seller: &str,
    bytes_used: u64,
    sequence_num: u64,
) -> String {
    format!(
        "receipt:v1:{}:{}:{}:{}:{}",
        escrow, buyer, seller, bytes_used, sequence_num
    )
}

pub fn verify_mutual_receipt(ack: &MutualReceiptAck) -> Result<(), String> {
    let msg = build_receipt_canonical_message(
        &ack.offer.escrow_pda,
        &ack.offer.buyer_pubkey,
        &ack.offer.seller_pubkey,
        ack.offer.bytes_used,
        ack.offer.sequence_num,
    );

    // Verify Seller Signature
    let seller_pubkey_bytes = bs58::decode(&ack.offer.seller_pubkey)
        .into_vec()
        .map_err(|_| "invalid seller pubkey base58".to_string())?;
    let seller_pubkey_array: [u8; 32] = seller_pubkey_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "invalid seller pubkey length".to_string())?;
    let seller_verifying_key = VerifyingKey::from_bytes(&seller_pubkey_array)
        .map_err(|_| "invalid seller verifying key".to_string())?;

    let seller_sig_bytes = bs58::decode(&ack.offer.seller_signature)
        .into_vec()
        .map_err(|_| "invalid seller signature base58".to_string())?;
    let seller_sig_array: [u8; 64] = seller_sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "invalid seller signature length".to_string())?;
    let seller_sig = Signature::from_bytes(&seller_sig_array);

    seller_verifying_key
        .verify(msg.as_bytes(), &seller_sig)
        .map_err(|_| "seller signature verification failed".to_string())?;

    // Verify Buyer Signature
    let buyer_pubkey_bytes = bs58::decode(&ack.offer.buyer_pubkey)
        .into_vec()
        .map_err(|_| "invalid buyer pubkey base58".to_string())?;
    let buyer_pubkey_array: [u8; 32] = buyer_pubkey_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "invalid buyer pubkey length".to_string())?;
    let buyer_verifying_key = VerifyingKey::from_bytes(&buyer_pubkey_array)
        .map_err(|_| "invalid buyer verifying key".to_string())?;

    let buyer_sig_bytes = bs58::decode(&ack.buyer_signature)
        .into_vec()
        .map_err(|_| "invalid buyer signature base58".to_string())?;
    let buyer_sig_array: [u8; 64] = buyer_sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "invalid buyer signature length".to_string())?;
    let buyer_sig = Signature::from_bytes(&buyer_sig_array);

    buyer_verifying_key
        .verify(msg.as_bytes(), &buyer_sig)
        .map_err(|_| "buyer signature verification failed".to_string())
}

pub const P2P_ANNOUNCEMENT_PREFIX: &str = "PROXYHUB_P2P_ANNOUNCEMENT:v1:";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct P2PNodeAnnouncement {
    pub version: String,
    pub node_id: String,
    pub provider_hotkey: String,
    pub country_code: String,
    pub region: String,
    pub ip_type: String,
    pub bandwidth_capacity_mbps: u32,
    pub price_per_gb_lamports: u64,
    pub tunnel_endpoint: String,
    pub issued_at: i64,
    pub expires_at: i64,
    pub signature: String,
}

#[allow(clippy::too_many_arguments)]
pub fn build_p2p_announcement_canonical_message(
    node_id: &str,
    provider_hotkey: &str,
    country_code: &str,
    region: &str,
    ip_type: &str,
    bandwidth_capacity_mbps: u32,
    price_per_gb_lamports: u64,
    tunnel_endpoint: &str,
    issued_at: i64,
    expires_at: i64,
) -> String {
    format!(
        "{}{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
        P2P_ANNOUNCEMENT_PREFIX,
        node_id.trim(),
        provider_hotkey.trim(),
        country_code.trim(),
        region.trim(),
        ip_type.trim(),
        bandwidth_capacity_mbps,
        price_per_gb_lamports,
        tunnel_endpoint.trim(),
        issued_at,
        expires_at
    )
}

pub fn verify_p2p_announcement(announcement: &P2PNodeAnnouncement) -> Result<(), String> {
    if announcement.provider_hotkey.trim().is_empty() {
        return Err("missing provider hotkey".to_string());
    }
    if announcement.signature.trim().is_empty() {
        return Err("unsigned announcement".to_string());
    }

    let msg = build_p2p_announcement_canonical_message(
        &announcement.node_id,
        &announcement.provider_hotkey,
        &announcement.country_code,
        &announcement.region,
        &announcement.ip_type,
        announcement.bandwidth_capacity_mbps,
        announcement.price_per_gb_lamports,
        &announcement.tunnel_endpoint,
        announcement.issued_at,
        announcement.expires_at,
    );

    let pubkey_bytes = bs58::decode(&announcement.provider_hotkey)
        .into_vec()
        .map_err(|_| "invalid provider hotkey base58".to_string())?;
    let pubkey_array: [u8; 32] = pubkey_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "invalid provider hotkey length".to_string())?;
    let verifying_key = VerifyingKey::from_bytes(&pubkey_array)
        .map_err(|_| "invalid provider verifying key".to_string())?;

    let sig_bytes = bs58::decode(&announcement.signature)
        .into_vec()
        .map_err(|_| "invalid signature base58".to_string())?;
    let sig_array: [u8; 64] = sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "invalid signature length".to_string())?;
    let signature = Signature::from_bytes(&sig_array);

    verifying_key
        .verify(msg.as_bytes(), &signature)
        .map_err(|_| "announcement signature verification failed".to_string())
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
