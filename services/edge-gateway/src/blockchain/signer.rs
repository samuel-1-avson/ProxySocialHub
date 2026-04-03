//! P2-A9: Event Signing for Fraud Prevention
//!
//! Implements Ed25519 cryptographic signatures for usage events.
//! This prevents replay attacks and ensures event authenticity.

use super::{SignedBatch, SignedUsageEvent, UsageEvent};
use crate::error::{Error, Result};

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};

/// Event signer using Ed25519 for fraud prevention
pub struct EventSigner {
    /// Signing key - kept secret, never exposed
    signing_key: SigningKey,

    /// Public key for verification (distributed to validators)
    verifying_key: VerifyingKey,
}

impl EventSigner {
    /// Create a new signer with a random keypair
    pub fn new() -> Self {
        let mut csprng = OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
        let verifying_key = signing_key.verifying_key();

        tracing::info!(
            public_key = hex::encode(verifying_key.as_bytes()),
            "EventSigner initialized with new keypair"
        );

        Self {
            signing_key,
            verifying_key,
        }
    }

    /// Create a signer from a hex-encoded private key
    pub fn from_hex(private_key_hex: &str) -> Result<Self> {
        if private_key_hex.is_empty() {
            // Generate new key if not provided
            return Ok(Self::new());
        }

        let private_key_bytes = hex::decode(private_key_hex)
            .map_err(|e| Error::Configuration(format!("Invalid private key hex: {}", e)))?;

        if private_key_bytes.len() != 32 {
            return Err(Error::Configuration(format!(
                "Private key must be 32 bytes, got {}",
                private_key_bytes.len()
            )));
        }

        let signing_key = SigningKey::from_bytes(&private_key_bytes.try_into().unwrap());
        let verifying_key = signing_key.verifying_key();

        tracing::info!(
            public_key = hex::encode(verifying_key.as_bytes()),
            "EventSigner initialized from provided key"
        );

        Ok(Self {
            signing_key,
            verifying_key,
        })
    }

    /// Get the public key for distribution to validators
    pub fn public_key(&self) -> &VerifyingKey {
        &self.verifying_key
    }

    /// Get the public key as hex string
    pub fn public_key_hex(&self) -> String {
        hex::encode(self.verifying_key.as_bytes())
    }

    /// Sign a usage event
    ///
    /// The signature covers:
    /// - session_id
    /// - user_id  
    /// - provider_id
    /// - node_id
    /// - bytes_up
    /// - bytes_down
    /// - timestamp_ms
    /// - nonce (unique per event for replay protection)
    pub fn sign_event(&self, event: &UsageEvent) -> SignedUsageEvent {
        let nonce = Self::generate_nonce();

        // Create canonical message for signing
        let message = self.create_event_message(event, nonce);

        // Sign with Ed25519
        let signature = self.signing_key.sign(&message);

        SignedUsageEvent {
            event: event.clone(),
            signature: signature.to_bytes().to_vec(),
            nonce,
        }
    }

    /// Sign a batch of events
    pub fn sign_batch(&self, events: &[UsageEvent]) -> SignedBatch {
        let mut signed_events = Vec::with_capacity(events.len());

        for event in events {
            signed_events.push(self.sign_event(event));
        }

        // Create merkle root from event signatures
        let merkle_root = self.compute_merkle_root(&signed_events);

        // Sign the merkle root
        let batch_signature = self.signing_key.sign(&merkle_root);

        SignedBatch {
            events: signed_events,
            batch_signature: batch_signature.to_bytes().to_vec(),
            merkle_root: merkle_root.to_vec(),
        }
    }

    /// Verify a signed event
    pub fn verify_event(&self, signed: &SignedUsageEvent) -> Result<bool> {
        let message = self.create_event_message(&signed.event, signed.nonce);

        let signature_bytes: [u8; 64] = signed
            .signature
            .as_slice()
            .try_into()
            .map_err(|_| Error::Validation("Invalid signature length".to_string()))?;

        let signature = Signature::from_bytes(&signature_bytes);

        match self.verifying_key.verify(&message, &signature) {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    /// Verify a signed batch
    pub fn verify_batch(&self, batch: &SignedBatch) -> Result<bool> {
        // First verify all individual events
        for signed in &batch.events {
            if !self.verify_event(signed)? {
                return Ok(false);
            }
        }

        // Then verify merkle root
        let computed_root = self.compute_merkle_root(&batch.events);
        if computed_root != batch.merkle_root.as_slice() {
            return Ok(false);
        }

        // Finally verify batch signature
        let signature_bytes: [u8; 64] = batch
            .batch_signature
            .as_slice()
            .try_into()
            .map_err(|_| Error::Validation("Invalid batch signature length".to_string()))?;

        let signature = Signature::from_bytes(&signature_bytes);

        match self.verifying_key.verify(&batch.merkle_root, &signature) {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    /// Create canonical message for event signing
    fn create_event_message(&self, event: &UsageEvent, nonce: u64) -> Vec<u8> {
        let mut hasher = Sha256::new();

        // Add all event fields in deterministic order
        hasher.update(event.session_id.as_bytes());
        hasher.update(b"|");
        hasher.update(event.user_id.as_bytes());
        hasher.update(b"|");
        hasher.update(event.provider_id.as_bytes());
        hasher.update(b"|");
        hasher.update(event.node_id.as_bytes());
        hasher.update(b"|");
        hasher.update(&event.bytes_up.to_le_bytes());
        hasher.update(b"|");
        hasher.update(&event.bytes_down.to_le_bytes());
        hasher.update(b"|");
        hasher.update(&event.timestamp_ms.to_le_bytes());
        hasher.update(b"|");
        hasher.update(&nonce.to_le_bytes());

        hasher.finalize().to_vec()
    }

    /// Generate a unique nonce for replay protection
    fn generate_nonce() -> u64 {
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::time::{SystemTime, UNIX_EPOCH};

        static COUNTER: AtomicU64 = AtomicU64::new(0);

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let counter = COUNTER.fetch_add(1, Ordering::SeqCst);

        // Combine timestamp and counter for unique nonce
        (timestamp << 16) | (counter & 0xFFFF)
    }

    /// Compute merkle root from event signatures
    fn compute_merkle_root(&self, events: &[SignedUsageEvent]) -> Vec<u8> {
        if events.is_empty() {
            return vec![0u8; 32];
        }

        // Collect hashes
        let mut hashes: Vec<Vec<u8>> = events
            .iter()
            .map(|e| {
                let mut hasher = Sha256::new();
                hasher.update(&e.signature);
                hasher.finalize().to_vec()
            })
            .collect();

        // Build merkle tree
        while hashes.len() > 1 {
            let mut next_level = Vec::new();

            for chunk in hashes.chunks(2) {
                let mut hasher = Sha256::new();
                hasher.update(&chunk[0]);
                if chunk.len() > 1 {
                    hasher.update(&chunk[1]);
                } else {
                    // Odd number - duplicate last
                    hasher.update(&chunk[0]);
                }
                next_level.push(hasher.finalize().to_vec());
            }

            hashes = next_level;
        }

        hashes.into_iter().next().unwrap_or_else(|| vec![0u8; 32])
    }

    /// Create protobuf batch from signed events
    pub fn create_proto_batch(
        &self,
        events: &[SignedUsageEvent],
    ) -> super::grpc_stream::UsageEventBatch {
        let proto_events: Vec<super::grpc_stream::UsageEvent> = events
            .iter()
            .map(|e| super::grpc_stream::UsageEvent {
                session_id: e.event.session_id.clone(),
                user_id: e.event.user_id.clone(),
                provider_id: e.event.provider_id.clone(),
                node_id: e.event.node_id.clone(),
                bytes_up: e.event.bytes_up,
                bytes_down: e.event.bytes_down,
                timestamp_ms: e.event.timestamp_ms,
                duration_seconds: e.event.duration_seconds,
                country_code: e.event.country_code.clone(),
                latency_ms: e.event.latency_ms,
                packet_loss_percent: e.event.packet_loss_percent,
                signature: e.signature.clone(),
                nonce: e.nonce,
            })
            .collect();

        // Compute batch signature
        let merkle_root = self.compute_merkle_root(events);
        let batch_sig = self.signing_key.sign(&merkle_root);

        super::grpc_stream::UsageEventBatch {
            events: proto_events,
            batch_timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            batch_signature: batch_sig.to_bytes().to_vec(),
        }
    }
}

impl Default for EventSigner {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_event() -> UsageEvent {
        UsageEvent {
            session_id: "session-123".to_string(),
            user_id: "user-456".to_string(),
            provider_id: "provider-789".to_string(),
            node_id: "node-abc".to_string(),
            bytes_up: 1024,
            bytes_down: 2048,
            timestamp_ms: 1234567890,
            duration_seconds: 60,
            country_code: "US".to_string(),
            latency_ms: 50,
            packet_loss_percent: 0,
        }
    }

    #[test]
    fn test_sign_and_verify_event() {
        let signer = EventSigner::new();
        let event = create_test_event();

        let signed = signer.sign_event(&event);

        assert!(signer.verify_event(&signed).unwrap());

        // Tamper with event - should fail verification
        let mut tampered = signed.clone();
        tampered.event.bytes_up = 9999;
        assert!(!signer.verify_event(&tampered).unwrap());
    }

    #[test]
    fn test_sign_and_verify_batch() {
        let signer = EventSigner::new();
        let events = vec![
            create_test_event(),
            create_test_event(),
            create_test_event(),
        ];

        let batch = signer.sign_batch(&events);

        assert!(signer.verify_batch(&batch).unwrap());

        // Tamper with batch - should fail
        let mut tampered = batch.clone();
        tampered.events[0].event.bytes_up = 9999;
        assert!(!signer.verify_batch(&tampered).unwrap());
    }

    #[test]
    fn test_hex_key_import() {
        // Generate a key
        let signer = EventSigner::new();
        let hex_key = hex::encode(signer.signing_key.as_bytes());

        // Import it
        let signer2 = EventSigner::from_hex(&hex_key).unwrap();

        // Should produce same signatures
        let event = create_test_event();
        let signed1 = signer.sign_event(&event);
        let signed2 = signer2.sign_event(&event);

        // Different nonces, so signatures will differ
        // But both should verify with their respective signers
        assert!(signer.verify_event(&signed1).unwrap());
        assert!(signer2.verify_event(&signed2).unwrap());

        // Both have same public key
        assert_eq!(signer.public_key_hex(), signer2.public_key_hex());
    }

    #[test]
    fn test_nonce_uniqueness() {
        let mut nonces = std::collections::HashSet::new();

        for _ in 0..1000 {
            let nonce = EventSigner::generate_nonce();
            assert!(nonces.insert(nonce), "Duplicate nonce generated!");
        }
    }
}
