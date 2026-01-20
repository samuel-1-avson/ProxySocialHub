use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize)]
struct AgentOutput {
    agent_id: String,
    content_hash: String,
    signature: String,
    metadata: serde_json::Value,
}

struct AgentSigner {
    signing_key: SigningKey,
}

impl AgentSigner {
    fn new(signing_key: SigningKey) -> Self {
        Self { signing_key }
    }

    fn from_bytes(bytes: &[u8; 32]) -> Self {
        let signing_key = SigningKey::from_bytes(bytes);
        Self { signing_key }
    }

    fn get_public_key(&self) -> String {
        hex::encode(self.signing_key.verifying_key().to_bytes())
    }

    fn sign_output(&self, content: &str, metadata: serde_json::Value) -> (String, String) {
        // 1. Hash the content
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        let hash = hasher.finalize();
        let hash_hex = hex::encode(hash);

        // 2. Sign the HASH
        let signature = self.signing_key.sign(&hash); // dalek sign takes bytes
        let signature_hex = hex::encode(signature.to_bytes());

        (hash_hex, signature_hex)
    }
}

fn main() {
    println!("🦀 Rust Agent Signer Example 🦀");

    // 1. Generate Keypair
    let mut csprng = OsRng;
    let signing_key = SigningKey::generate(&mut csprng);
    let agent = AgentSigner::new(signing_key);

    println!("Agent Public Key: {}", agent.get_public_key());

    // 2. Sign Work
    let output_text =
        "Market Analysis: Rust agents are highly efficient and secure for edge computing.";
    let metadata = json!({
        "timestamp": SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
        "model": "llama-3-rust-quantized",
        "confidence": 0.99
    });

    let (content_hash, signature) = agent.sign_output(output_text, metadata.clone());

    // 3. Construct Payload
    let payload = AgentOutput {
        agent_id: "[YOUR_AGENT_UUID]".to_string(),
        content_hash,
        signature,
        metadata,
    };

    println!("\n--- Payload for POST /registry/agents/verify/output ---");
    println!("{}", serde_json::to_string_pretty(&payload).unwrap());
}
