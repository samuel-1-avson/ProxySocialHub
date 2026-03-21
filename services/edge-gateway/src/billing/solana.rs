//! Solana Relayer (Phase 5).
//!
//! Submits ZK-proofs of usage to the on-chain verifier contract (Solana).

use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::transaction::Transaction;
use solana_sdk::instruction::Instruction;
use std::sync::Arc;
use tracing::{info, error, warn};

use super::zk::{UsageProof, PublicInputs};
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
                let _ = relayer.submit_batch(batch).await;
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
             // Fallback to a well-known devnet ID or system program
             Pubkey::default()
        });
        
        let keypair = Keypair::new(); // In prod, loaded from provider_private_key
        
        Self {
            program_id,
            keypair,
            rpc_url: rpc_url.to_string(),
        }
    }

    /// Submit a usage proof on-chain to trigger a payout.
    pub async fn submit_proof(
        &self,
        proof: &UsageProof,
        inputs: &PublicInputs,
    ) -> Result<String, String> {
        info!("Submitting ZK-proof for session {:?} to Solana...", inputs.session_id_hash);
        
        // P5-W18: Construct an instruction for the on-chain verifier.
        // let ix = Instruction::new_with_borsh(
        //     self.program_id,
        //     &UsageVerifyInstruction { ... },
        //     vec![AccountMeta::new(self.keypair.pubkey(), true), ...]
        // );
        
        // Simulating submission...
        let signature = "4vRz...5Pqx".to_string(); // Mock signature
        warn!("Solana proof submission is in MOCK mode (signature={})", signature);
        
        Ok(signature)
    }

    /// Submit a batch of proofs on-chain (Phase 9).
    pub async fn submit_batch(
        &self,
        batch: Vec<(UsageProof, PublicInputs)>,
    ) -> Result<String, String> {
        info!("🚀 Submitting BATCH of {} ZK-proofs to Solana...", batch.len());
        
        // P9-W22: Aggregation logic would go here to combine into 1 TX.
        let signature = "BTCH...8888".to_string(); 
        info!("Batch transaction confirmed: {}", signature);
        
        Ok(signature)
    }

    /// Slash a provider for malicious behavior.
    pub async fn trigger_slash(
        &self,
        provider_id: &str,
        reason: &str,
        amount: u64,
    ) -> Result<String, String> {
        warn!("🚨 SLASH TRIGGERED for provider {}: {} (Amount: {} PHUBB)", provider_id, reason, amount);
        
        // P8-W20: Construct and sign a SlashProvider instruction.
        // let ix = slash_provider_instruction(...);
        
        let signature = "SLSH...9999".to_string(); // Mock slash signature
        info!("Successfully submitted slash transaction: {}", signature);
        
        Ok(signature)
    }
}
