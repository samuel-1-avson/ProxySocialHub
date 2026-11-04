use anyhow::{Context, Result};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const HEARTBEAT_MESSAGE_TYPE: &str = "PROXYHUB_PROVIDER_HEARTBEAT";
pub const LISTING_OFFER_MESSAGE_TYPE: &str = "PROXYHUB_LISTING_OFFER";
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

/// A marketplace listing offer, field for field what the control API hashes in
/// `HashListingOfferPayload` (control-api/internal/proofs/provider_signatures.go) and the
/// web in `hashListingOfferPayload` (apps/web/src/lib/proofs/listing-offer.ts).
#[derive(Clone, Debug, PartialEq)]
pub struct ListingOfferPayload {
    pub provider_node_id: String,
    pub gateway_node_id: String,
    pub title: String,
    pub description: String,
    pub proxy_type: String,
    pub protocol: String,
    pub rotation_type: String,
    pub country: String,
    pub isp: String,
    pub price_per_gb: f64,
    pub min_purchase_gb: f64,
    pub available_bandwidth_gb: f64,
    pub max_concurrency: i64,
    pub status: String,
    pub expires_at: i64,
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
        self.sign_envelope(envelope)
    }

    /// Sign a listing offer the way the website would with this key. `issued_at` is the
    /// signing time (Unix seconds); the control API accepts the proof for 10 minutes.
    pub fn sign_listing_offer(
        &self,
        payload: &ListingOfferPayload,
        issued_at: i64,
    ) -> ProviderProofEnvelope {
        let envelope = ProviderProofEnvelope {
            message_type: LISTING_OFFER_MESSAGE_TYPE.to_string(),
            version: PROOF_VERSION.to_string(),
            provider_node_id: payload.provider_node_id.clone(),
            gateway_node_id: payload.gateway_node_id.clone(),
            provider_hotkey: self.public_key.clone(),
            issued_at,
            nonce: uuid::Uuid::new_v4().to_string(),
            payload_hash: hash_listing_offer_payload(payload),
            signature: String::new(),
        };
        self.sign_envelope(envelope)
    }

    fn sign_envelope(&self, envelope: ProviderProofEnvelope) -> ProviderProofEnvelope {
        let message = build_provider_proof_message(&envelope);
        let signature = self.signing_key.sign(message.as_bytes());
        ProviderProofEnvelope {
            signature: bs58::encode(signature.to_bytes()).into_string(),
            ..envelope
        }
    }
}

/// SHA-256 (hex) of the canonical listing offer string. Numbers use 9 decimals, as Go's
/// `%.9f`; both round the exact binary value half-to-even, so equal floats give equal text.
pub fn hash_listing_offer_payload(p: &ListingOfferPayload) -> String {
    sha256_hex(&format!(
        "PROXYHUB_LISTING_OFFER_PAYLOAD:v1:{}:{}:{}:{}:{}:{}:{}:{}:{}:{:.9}:{:.9}:{:.9}:{}:{}:{}",
        p.provider_node_id,
        p.gateway_node_id,
        p.title,
        p.description,
        p.proxy_type,
        p.protocol,
        p.rotation_type,
        p.country,
        p.isp,
        p.price_per_gb,
        p.min_purchase_gb,
        p.available_bandwidth_gb,
        p.max_concurrency,
        p.status,
        p.expires_at
    ))
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

// Whitepaper v2 mutual receipts (settled on-chain by the proxyhub program). The node
// does not exchange receipts yet; these are exercised by the unit tests below.
#[allow(dead_code)]
pub const RECEIPT_VERSION: &str = "v1";

#[allow(dead_code)]
/// Mutual session receipt offer issued by the provider.
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

#[allow(dead_code)]
/// Mutual session receipt acknowledged and counter-signed by the buyer.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct MutualReceiptAck {
    pub offer: MutualReceiptOffer,
    pub buyer_signature: String,
}

#[allow(dead_code)]
/// Construct canonical message for mutual session receipt settlement:
/// `receipt:v1:{escrow}:{buyer}:{seller}:{bytes}:{seq}`
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

#[allow(dead_code)] // receipt and P2P signing: see the notes on RECEIPT_VERSION and P2P_ANNOUNCEMENT_PREFIX
impl ProviderSigner {
    /// Sign a mutual receipt offer to send to the buyer client.
    pub fn sign_receipt_offer(
        &self,
        escrow_pda: &str,
        buyer_pubkey: &str,
        bytes_used: u64,
        sequence_num: u64,
        session_timestamp: i64,
    ) -> MutualReceiptOffer {
        let msg = build_receipt_canonical_message(
            escrow_pda,
            buyer_pubkey,
            &self.public_key,
            bytes_used,
            sequence_num,
        );
        let sig = self.signing_key.sign(msg.as_bytes());
        MutualReceiptOffer {
            version: RECEIPT_VERSION.to_string(),
            escrow_pda: escrow_pda.to_string(),
            buyer_pubkey: buyer_pubkey.to_string(),
            seller_pubkey: self.public_key.clone(),
            bytes_used,
            sequence_num,
            session_timestamp,
            seller_signature: bs58::encode(sig.to_bytes()).into_string(),
        }
    }

    /// Verify the buyer's counter-signature on an acknowledged mutual receipt.
    pub fn verify_buyer_receipt_ack(&self, ack: &MutualReceiptAck) -> Result<(), String> {
        let msg = build_receipt_canonical_message(
            &ack.offer.escrow_pda,
            &ack.offer.buyer_pubkey,
            &ack.offer.seller_pubkey,
            ack.offer.bytes_used,
            ack.offer.sequence_num,
        );

        let buyer_pubkey_bytes = bs58::decode(&ack.offer.buyer_pubkey)
            .into_vec()
            .map_err(|_| "invalid buyer pubkey base58".to_string())?;
        let buyer_pubkey_array: [u8; 32] = buyer_pubkey_bytes
            .as_slice()
            .try_into()
            .map_err(|_| "invalid buyer pubkey length".to_string())?;
        let verifying_key = ed25519_dalek::VerifyingKey::from_bytes(&buyer_pubkey_array)
            .map_err(|_| "invalid buyer verifying key".to_string())?;

        let sig_bytes = bs58::decode(&ack.buyer_signature)
            .into_vec()
            .map_err(|_| "invalid buyer signature base58".to_string())?;
        let sig_array: [u8; 64] = sig_bytes
            .as_slice()
            .try_into()
            .map_err(|_| "invalid buyer signature length".to_string())?;
        let signature = ed25519_dalek::Signature::from_bytes(&sig_array);

        verifying_key
            .verify_strict(msg.as_bytes(), &signature)
            .map_err(|_| "buyer signature verification failed".to_string())
    }

    /// Sign a P2P node announcement for decentralized discovery.
    #[allow(clippy::too_many_arguments)]
    pub fn sign_p2p_announcement(
        &self,
        node_id: &str,
        country_code: &str,
        region: &str,
        ip_type: &str,
        bandwidth_capacity_mbps: u32,
        price_per_gb_lamports: u64,
        tunnel_endpoint: &str,
        issued_at: i64,
        expires_at: i64,
    ) -> P2PNodeAnnouncement {
        let msg = build_p2p_announcement_canonical_message(
            node_id,
            &self.public_key,
            country_code,
            region,
            ip_type,
            bandwidth_capacity_mbps,
            price_per_gb_lamports,
            tunnel_endpoint,
            issued_at,
            expires_at,
        );
        let sig = self.signing_key.sign(msg.as_bytes());
        P2PNodeAnnouncement {
            version: "v1".to_string(),
            node_id: node_id.to_string(),
            provider_hotkey: self.public_key.clone(),
            country_code: country_code.to_string(),
            region: region.to_string(),
            ip_type: ip_type.to_string(),
            bandwidth_capacity_mbps,
            price_per_gb_lamports,
            tunnel_endpoint: tunnel_endpoint.to_string(),
            issued_at,
            expires_at,
            signature: bs58::encode(sig.to_bytes()).into_string(),
        }
    }
}

// Whitepaper v2 P2P discovery announcements; not wired into the node yet.
#[allow(dead_code)]
pub const P2P_ANNOUNCEMENT_PREFIX: &str = "PROXYHUB_P2P_ANNOUNCEMENT:v1:";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[allow(dead_code)]
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

#[allow(dead_code, clippy::too_many_arguments)]
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

#[allow(dead_code)]
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
    let verifying_key = ed25519_dalek::VerifyingKey::from_bytes(&pubkey_array)
        .map_err(|_| "invalid provider verifying key".to_string())?;

    let sig_bytes = bs58::decode(&announcement.signature)
        .into_vec()
        .map_err(|_| "invalid signature base58".to_string())?;
    let sig_array: [u8; 64] = sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "invalid signature length".to_string())?;
    let signature = ed25519_dalek::Signature::from_bytes(&sig_array);

    verifying_key
        .verify_strict(msg.as_bytes(), &signature)
        .map_err(|_| "announcement signature verification failed".to_string())
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

    fn vector_offer() -> ListingOfferPayload {
        ListingOfferPayload {
            provider_node_id: "11111111-2222-4333-8444-555555555555".into(),
            gateway_node_id: "gw-test".into(),
            title: "Accra home fibre".into(),
            description: "Residential line: weekdays only".into(),
            proxy_type: "residential".into(),
            protocol: "http,https,socks5".into(),
            rotation_type: "rotating".into(),
            country: "GH".into(),
            isp: String::new(),
            price_per_gb: 0.792,
            min_purchase_gb: 1.0,
            available_bandwidth_gb: 13.0,
            max_concurrency: 10,
            status: "active".into(),
            expires_at: 0,
        }
    }

    // Same vector as the web's formula (apps/web/src/lib/proofs/listing-offer.ts) and
    // the control API test TestListingOfferHashVector: all three must agree byte for byte.
    #[test]
    fn listing_offer_hash_matches_the_shared_vector() {
        assert_eq!(
            hash_listing_offer_payload(&vector_offer()),
            "f4b6a6b64c4ab8f9da2ef33b4d72d349f1de9c2c13ae4376b63380b8dfbb4938"
        );
    }

    #[test]
    fn signed_listing_offer_verifies_with_the_node_hotkey() {
        let signer = ProviderSigner::from_base58(&bs58::encode([9_u8; 32]).into_string()).unwrap();
        let offer = vector_offer();
        let proof = signer.sign_listing_offer(&offer, 1_777_675_904);

        assert_eq!(proof.message_type, LISTING_OFFER_MESSAGE_TYPE);
        assert_eq!(proof.version, PROOF_VERSION);
        assert_eq!(proof.provider_node_id, offer.provider_node_id);
        assert_eq!(proof.gateway_node_id, offer.gateway_node_id);
        assert_eq!(proof.provider_hotkey, signer.public_key());
        assert_eq!(proof.payload_hash, hash_listing_offer_payload(&offer));
        assert_eq!(proof.issued_at, 1_777_675_904);

        let key: [u8; 32] = bs58::decode(&proof.provider_hotkey)
            .into_vec()
            .unwrap()
            .try_into()
            .unwrap();
        let sig: [u8; 64] = bs58::decode(&proof.signature)
            .into_vec()
            .unwrap()
            .try_into()
            .unwrap();
        ed25519_dalek::VerifyingKey::from_bytes(&key)
            .unwrap()
            .verify_strict(
                build_provider_proof_message(&proof).as_bytes(),
                &ed25519_dalek::Signature::from_bytes(&sig),
            )
            .expect("signature verifies");
    }

    #[test]
    fn generated_key_round_trips_through_signer() {
        let generated = ProviderSigner::generate().unwrap();
        let signer = ProviderSigner::from_base58(&generated.secret_base58).unwrap();

        assert_eq!(generated.public_key, signer.public_key());
        assert!(!generated.secret_base58.is_empty());
        assert!(!generated.public_key.is_empty());
    }

    #[test]
    fn signs_and_verifies_mutual_receipt_round_trip() {
        let provider_seed = [3_u8; 32];
        let provider_signer =
            ProviderSigner::from_base58(&bs58::encode(provider_seed).into_string()).unwrap();

        let buyer_seed = [4_u8; 32];
        let buyer_signing_key = SigningKey::from_bytes(&buyer_seed);
        let buyer_pubkey = bs58::encode(buyer_signing_key.verifying_key().as_bytes()).into_string();

        let escrow_pda = "8LZji5mK3B7YfG9M2W7o7v2gV3yqK7v4jK2L5mN8P9Q";
        let bytes_used = 10_485_760_u64; // 10 MB
        let sequence_num = 1_u64;
        let session_timestamp = 1_777_676_000_i64;

        // 1. Provider signs receipt offer
        let offer = provider_signer.sign_receipt_offer(
            escrow_pda,
            &buyer_pubkey,
            bytes_used,
            sequence_num,
            session_timestamp,
        );
        assert_eq!(offer.seller_pubkey, provider_signer.public_key());
        assert_eq!(offer.bytes_used, bytes_used);
        assert_eq!(offer.sequence_num, sequence_num);

        // 2. Buyer counter-signs
        let canonical_msg = build_receipt_canonical_message(
            escrow_pda,
            &buyer_pubkey,
            &offer.seller_pubkey,
            bytes_used,
            sequence_num,
        );
        let buyer_sig = buyer_signing_key.sign(canonical_msg.as_bytes());
        let ack = MutualReceiptAck {
            offer,
            buyer_signature: bs58::encode(buyer_sig.to_bytes()).into_string(),
        };

        // 3. Provider verifies buyer ack
        let verify_res = provider_signer.verify_buyer_receipt_ack(&ack);
        assert!(verify_res.is_ok(), "Verification failed: {:?}", verify_res);
    }

    #[test]
    fn rejects_tampered_bytes_in_mutual_receipt() {
        let provider_seed = [3_u8; 32];
        let provider_signer =
            ProviderSigner::from_base58(&bs58::encode(provider_seed).into_string()).unwrap();

        let buyer_seed = [4_u8; 32];
        let buyer_signing_key = SigningKey::from_bytes(&buyer_seed);
        let buyer_pubkey = bs58::encode(buyer_signing_key.verifying_key().as_bytes()).into_string();

        let escrow_pda = "8LZji5mK3B7YfG9M2W7o7v2gV3yqK7v4jK2L5mN8P9Q";

        let mut offer = provider_signer.sign_receipt_offer(
            escrow_pda,
            &buyer_pubkey,
            10_000_000,
            1,
            1_777_676_000,
        );

        let canonical_msg = build_receipt_canonical_message(
            escrow_pda,
            &buyer_pubkey,
            &offer.seller_pubkey,
            10_000_000,
            1,
        );
        let buyer_sig = buyer_signing_key.sign(canonical_msg.as_bytes());

        // Tamper with bytes
        offer.bytes_used = 20_000_000;

        let ack = MutualReceiptAck {
            offer,
            buyer_signature: bs58::encode(buyer_sig.to_bytes()).into_string(),
        };

        let verify_res = provider_signer.verify_buyer_receipt_ack(&ack);
        assert!(verify_res.is_err());
    }
}
