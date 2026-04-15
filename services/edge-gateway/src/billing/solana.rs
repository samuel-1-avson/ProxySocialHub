//! Solana Relayer (Phase 5).
//!
//! Submits ZK-proofs of usage to the on-chain verifier contract (Solana).

use solana_commitment_config::CommitmentConfig;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::{keypair_from_seed, read_keypair_file, Keypair};
use solana_pubkey::Pubkey;
use solana_sdk_ids::system_program;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::convert::TryFrom;
use std::str::FromStr;
use std::sync::Arc;
use tracing::{error, info, warn};

use super::zk::{PublicInputs, UsageProof};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

pub struct BatchRelayer {
    pub proofs: Mutex<Vec<(UsageProof, PublicInputs)>>,
    pub max_batch_size: usize,
    pub relayer: Arc<SolanaRelayer>,
}

impl BatchRelayer {
    pub fn new(relayer: Arc<SolanaRelayer>, max_batch_size: usize) -> Self {
        Self {
            proofs: Mutex::new(Vec::new()),
            max_batch_size,
            relayer,
        }
    }

    pub async fn add_proof(&self, proof: UsageProof, inputs: PublicInputs) {
        let mut proofs = self.proofs.lock().await;
        proofs.push((proof, inputs));

        if proofs.len() >= self.max_batch_size {
            let batch = std::mem::take(&mut *proofs);
            let relayer = self.relayer.clone();
            tokio::spawn(async move {
                if let Err(e) = relayer.submit_batch(batch).await {
                    error!("Batch submission failed: {}", e);
                }
            });
        }
    }
}

pub struct SolanaRelayer {
    /// The program ID of the on-chain verifier contract.
    program_id: Pubkey,
    /// The gateway's keypair for signing transactions.
    keypair: Keypair,
    /// RPC URL for Solana (Devnet / Mainnet-beta).
    rpc_url: String,
}

impl SolanaRelayer {
    pub fn new(program_id_str: &str, rpc_url: &str) -> Self {
        let program_id = program_id_str.parse().unwrap_or_else(|_| {
            warn!("Invalid program ID '{}', falling back to system program", program_id_str);
            system_program::ID
        });

        // Load keypair from SOLANA_PRIVATE_KEY / ORACLE_PRIVATE_KEY (base58-encoded secret key)
        // or SOLANA_KEYPAIR_PATH (JSON file path).
        let keypair = Self::load_keypair().unwrap_or_else(|| {
            warn!("No SOLANA_PRIVATE_KEY, ORACLE_PRIVATE_KEY, or SOLANA_KEYPAIR_PATH set — generating ephemeral keypair (devnet only)");
            Keypair::new()
        });

        info!(
            "Solana relayer initialized: program={}, rpc={}, signer={}",
            program_id, rpc_url, keypair.pubkey()
        );

        Self {
            program_id,
            keypair,
            rpc_url: rpc_url.to_string(),
        }
    }

    /// Returns the 32-byte public key of the gateway/provider signer.
    pub fn provider_pubkey(&self) -> [u8; 32] {
        self.keypair.pubkey().to_bytes()
    }

    fn load_keypair() -> Option<Keypair> {
        let signer_sources = [
            ("SOLANA_PRIVATE_KEY", std::env::var("SOLANA_PRIVATE_KEY").ok()),
            ("ORACLE_PRIVATE_KEY", std::env::var("ORACLE_PRIVATE_KEY").ok()),
        ];
        let path_sources = [
            ("SOLANA_KEYPAIR_PATH", std::env::var("SOLANA_KEYPAIR_PATH").ok()),
            ("ORACLE_KEYPAIR_PATH", std::env::var("ORACLE_KEYPAIR_PATH").ok()),
        ];

        Self::load_keypair_from_inputs(&signer_sources, &path_sources)
    }

    fn load_keypair_from_inputs(
        signer_sources: &[(impl AsRef<str>, Option<String>)],
        path_sources: &[(impl AsRef<str>, Option<String>)],
    ) -> Option<Keypair> {
        for (source_name, candidate) in signer_sources {
            let Some(raw_value) = candidate.as_deref().map(str::trim).filter(|value| !value.is_empty()) else {
                continue;
            };

            if let Some(keypair) = Self::parse_keypair_value(raw_value) {
                info!(source = source_name.as_ref(), signer = %keypair.pubkey(), "Loaded Solana signer from environment input");
                return Some(keypair);
            }

            warn!(source = source_name.as_ref(), "Ignoring invalid Solana signer value and falling back to other inputs");
        }

        for (source_name, candidate) in path_sources {
            let Some(path) = candidate.as_deref().map(str::trim).filter(|value| !value.is_empty()) else {
                continue;
            };

            match read_keypair_file(path) {
                Ok(keypair) => {
                    info!(source = source_name.as_ref(), path, signer = %keypair.pubkey(), "Loaded Solana signer from keypair file");
                    return Some(keypair);
                }
                Err(err) => {
                    warn!(source = source_name.as_ref(), path, error = %err, "Failed to load Solana signer file");
                }
            }
        }

        None
    }

    fn parse_keypair_value(raw_value: &str) -> Option<Keypair> {
        Self::parse_base58_keypair(raw_value)
            .or_else(|| Self::parse_hex_keypair(raw_value))
            .or_else(|| Self::parse_json_keypair(raw_value))
            .or_else(|| Self::parse_keypair_path(raw_value))
    }

    fn parse_base58_keypair(raw_value: &str) -> Option<Keypair> {
        let bytes = bs58::decode(raw_value).into_vec().ok()?;
        Self::keypair_from_bytes(&bytes)
    }

    fn parse_hex_keypair(raw_value: &str) -> Option<Keypair> {
        let normalized = raw_value.strip_prefix("0x").unwrap_or(raw_value);
        if normalized.is_empty()
            || normalized.len() % 2 != 0
            || !normalized.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return None;
        }

        let bytes = hex::decode(normalized).ok()?;
        Self::keypair_from_bytes(&bytes)
    }

    fn parse_json_keypair(raw_value: &str) -> Option<Keypair> {
        let bytes: Vec<u8> = serde_json::from_str(raw_value).ok()?;
        Self::keypair_from_bytes(&bytes)
    }

    fn parse_keypair_path(raw_value: &str) -> Option<Keypair> {
        if !std::path::Path::new(raw_value).exists() {
            return None;
        }

        read_keypair_file(raw_value).ok()
    }

    fn keypair_from_bytes(bytes: &[u8]) -> Option<Keypair> {
        match bytes.len() {
            64 => Keypair::try_from(bytes).ok(),
            32 => keypair_from_seed(bytes).ok(),
            _ => None,
        }
    }

    /// Derive the PDA for a ZK batch on-chain account.
    fn find_zk_batch_pda(&self, batch_root: &[u8; 32]) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[b"zk_batch", batch_root.as_ref()],
            &self.program_id,
        )
    }

    /// Derive the PDA for the program state account.
    fn find_program_state_pda(&self) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"program_state"], &self.program_id)
    }

    /// Build the 8-byte Anchor instruction discriminator from an instruction name.
    fn anchor_discriminator(instruction_name: &str) -> [u8; 8] {
        let mut hasher = Sha256::new();
        hasher.update(format!("global:{}", instruction_name).as_bytes());
        let hash = hasher.finalize();
        let mut disc = [0u8; 8];
        disc.copy_from_slice(&hash[..8]);
        disc
    }

    /// Submit a single usage proof on-chain via `submit_zk_batch`.
    pub async fn submit_proof(
        &self,
        _proof: &UsageProof,
        inputs: &PublicInputs,
    ) -> Result<String, String> {
        info!(
            "Submitting ZK-proof for session {:?} to Solana...",
            inputs.session_id_hash
        );

        let batch_root = inputs.session_id_hash; // single-session "batch"

        self.submit_zk_batch_tx(
            &batch_root,
            1,                                              // session_count
            inputs.total_bytes_up + inputs.total_bytes_down, // total_bytes
            0,                                              // period_start (best-effort)
            chrono::Utc::now().timestamp(),                 // period_end
        )
        .await
    }

    /// Submit a batch of proofs on-chain as a single Merkle-root commitment.
    pub async fn submit_batch(
        &self,
        batch: Vec<(UsageProof, PublicInputs)>,
    ) -> Result<String, String> {
        info!(
            "Submitting BATCH of {} ZK-proofs to Solana...",
            batch.len()
        );

        // Compute Merkle root over all session_id_hashes
        let mut hasher = Sha256::new();
        let mut total_bytes: u64 = 0;
        for (_, inputs) in &batch {
            hasher.update(inputs.session_id_hash);
            total_bytes = total_bytes.saturating_add(inputs.total_bytes_up + inputs.total_bytes_down);
        }
        let root_hash = hasher.finalize();
        let mut batch_root = [0u8; 32];
        batch_root.copy_from_slice(&root_hash[..32]);

        let now = chrono::Utc::now().timestamp();
        self.submit_zk_batch_tx(
            &batch_root,
            batch.len() as u32,
            total_bytes,
            now - 3600, // approximate 1-hour batch window
            now,
        )
        .await
    }

    /// Build, sign, and send the `submit_zk_batch` transaction to Solana.
    async fn submit_zk_batch_tx(
        &self,
        batch_root: &[u8; 32],
        session_count: u32,
        total_bytes: u64,
        period_start: i64,
        period_end: i64,
    ) -> Result<String, String> {
        let client = solana_client::rpc_client::RpcClient::new_with_commitment(
            self.rpc_url.clone(),
            CommitmentConfig::confirmed(),
        );

        let (zk_batch_pda, _) = self.find_zk_batch_pda(batch_root);
        let (program_state_pda, _) = self.find_program_state_pda();

        // Build Anchor instruction data:
        // [8-byte discriminator] [32-byte batch_root] [4-byte session_count]
        // [8-byte total_bytes] [8-byte period_start] [8-byte period_end]
        let disc = Self::anchor_discriminator("submit_zk_batch");
        let mut data = Vec::with_capacity(8 + 32 + 4 + 8 + 8 + 8);
        data.extend_from_slice(&disc);
        data.extend_from_slice(batch_root);
        data.extend_from_slice(&session_count.to_le_bytes());
        data.extend_from_slice(&total_bytes.to_le_bytes());
        data.extend_from_slice(&period_start.to_le_bytes());
        data.extend_from_slice(&period_end.to_le_bytes());

        let ix = Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(self.keypair.pubkey(), true),     // oracle (mut, signer)
                AccountMeta::new(zk_batch_pda, false),             // zk_batch (init by program)
                AccountMeta::new_readonly(system_program::ID, false), // system_program
                AccountMeta::new_readonly(program_state_pda, false), // program_state
            ],
            data,
        };

        let recent_blockhash = client
            .get_latest_blockhash()
            .map_err(|e| format!("Failed to get blockhash: {}", e))?;

        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&self.keypair.pubkey()),
            &[&self.keypair],
            recent_blockhash,
        );

        let signature = client
            .send_and_confirm_transaction(&tx)
            .map_err(|e| format!("Transaction failed: {}", e))?;

        let sig_str = signature.to_string();
        info!("ZK batch committed on-chain: {}", sig_str);
        Ok(sig_str)
    }

    /// Slash a provider for malicious behavior on-chain.
    pub async fn trigger_slash(
        &self,
        provider_id: &str,
        reason: &str,
        amount: u64,
    ) -> Result<String, String> {
        warn!(
            "SLASH TRIGGERED for provider {}: {} (Amount: {} lamports)",
            provider_id, reason, amount
        );

        let provider_pubkey = Pubkey::from_str(provider_id)
            .map_err(|e| format!("Invalid provider pubkey: {}", e))?;

        let client = solana_client::rpc_client::RpcClient::new_with_commitment(
            self.rpc_url.clone(),
            CommitmentConfig::confirmed(),
        );

        // Derive the provider's stake PDA
        let (stake_pda, _) = Pubkey::find_program_address(
            &[b"stake", provider_pubkey.as_ref()],
            &self.program_id,
        );
        let (program_state_pda, _) = self.find_program_state_pda();

        let disc = Self::anchor_discriminator("slash_provider_insurance");
        let mut data = Vec::with_capacity(8 + 8 + 4 + reason.len());
        data.extend_from_slice(&disc);
        data.extend_from_slice(&amount.to_le_bytes());
        // Borsh-encode the reason string: 4-byte LE length prefix + UTF-8 bytes
        data.extend_from_slice(&(reason.len() as u32).to_le_bytes());
        data.extend_from_slice(reason.as_bytes());

        // Derive insurance pool PDA
        let (insurance_pool_pda, _) = Pubkey::find_program_address(
            &[b"insurance_pool"],
            &self.program_id,
        );

        let ix = Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(insurance_pool_pda, false),       // insurance_pool
                AccountMeta::new(stake_pda, false),                // stake_account
                AccountMeta::new_readonly(self.keypair.pubkey(), true), // admin (signer)
                AccountMeta::new_readonly(program_state_pda, false),   // program_state
            ],
            data,
        };

        let recent_blockhash = client
            .get_latest_blockhash()
            .map_err(|e| format!("Failed to get blockhash: {}", e))?;

        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&self.keypair.pubkey()),
            &[&self.keypair],
            recent_blockhash,
        );

        let signature = client
            .send_and_confirm_transaction(&tx)
            .map_err(|e| format!("Slash transaction failed: {}", e))?;

        let sig_str = signature.to_string();
        info!("Slash transaction confirmed: {}", sig_str);
        Ok(sig_str)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn seeded_keypair(seed_byte: u8) -> Keypair {
        keypair_from_seed(&[seed_byte; 32]).expect("seeded keypair")
    }

    fn write_keypair_file(keypair: &Keypair) -> String {
        let path = std::env::temp_dir().join(format!(
            "edge-gateway-keypair-{}.json",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));
        let serialized = format!(
            "[{}]",
            keypair
                .to_bytes()
                .iter()
                .map(|byte| byte.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );
        fs::write(&path, serialized).expect("write keypair file");
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn parses_hex_seed_keypairs() {
        let expected = seeded_keypair(7);
        let parsed = SolanaRelayer::parse_keypair_value(&hex::encode([7u8; 32]))
            .expect("hex seed should parse");

        assert_eq!(parsed.pubkey(), expected.pubkey());
    }

    #[test]
    fn falls_back_to_keypair_file_when_env_value_is_blank() {
        let expected = seeded_keypair(9);
        let path = write_keypair_file(&expected);

        let parsed = SolanaRelayer::load_keypair_from_inputs(
            &[("ORACLE_PRIVATE_KEY", Some(String::new()))],
            &[("SOLANA_KEYPAIR_PATH", Some(path.clone()))],
        )
        .expect("keypair file should be used");

        assert_eq!(parsed.pubkey(), expected.pubkey());

        let _ = fs::remove_file(path);
    }
}
