//! ProxyHubb reputation program (BC-11 Sprint A rebuild).
//!
//! **DO NOT DEPLOY** while `declare_id!` is the placeholder
//! `Repu111111111111111111111111111111111111111`.
//! A real program ID must be generated and wired before any cluster deploy.
//!
//! `verify_usage` is oracle-gated and requires a non-empty proof_hash /
//! batch_root binding. It does **not** verify Halo2/Groth16 on-chain yet
//! (see docs/ops/BC11_GROTH16_PATH.md). Score updates are oracle-attested only.

use anchor_lang::prelude::*;

declare_id!("Repu111111111111111111111111111111111111111");

#[program]
pub mod proxy_reputation {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, oracle_authority: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.oracle_config;
        config.oracle_authority = oracle_authority;
        config.admin = ctx.accounts.admin.key();
        config.deploy_allowed = false; // flip only after real program ID + audit
        config.bump = ctx.bumps.oracle_config;
        msg!("reputation config initialized (deploy_allowed=false until real ID)");
        Ok(())
    }

    pub fn update_oracle_authority(
        ctx: Context<UpdateConfig>,
        new_oracle_authority: Pubkey,
    ) -> Result<()> {
        ctx.accounts.oracle_config.oracle_authority = new_oracle_authority;
        Ok(())
    }

    pub fn initialize_provider(ctx: Context<InitializeProvider>) -> Result<()> {
        let reputation = &mut ctx.accounts.provider_reputation;
        reputation.provider = ctx.accounts.signer.key();
        reputation.score = 100;
        reputation.total_bytes_proven = 0;
        reputation.last_proof_timestamp = Clock::get()?.unix_timestamp;
        reputation.last_batch_root = [0u8; 32];
        reputation.bump = ctx.bumps.provider_reputation;
        Ok(())
    }

    pub fn stake_tokens(ctx: Context<StakeTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, ReputationError::InvalidAmount);
        let stake = &mut ctx.accounts.stake_account;
        stake.amount = stake.amount.saturating_add(amount);
        stake.owner = ctx.accounts.signer.key();
        Ok(())
    }

    pub fn slash_provider(ctx: Context<SlashProvider>, amount: u64) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.oracle_signer.key(),
            ctx.accounts.oracle_config.oracle_authority,
            ReputationError::Unauthorized
        );
        let stake = &mut ctx.accounts.stake_account;
        let reputation = &mut ctx.accounts.provider_reputation;
        stake.amount = stake.amount.saturating_sub(amount);
        reputation.score = reputation.score.saturating_sub(1000);
        Ok(())
    }

    /// Oracle-attested usage credit. `proof_hash` must be non-zero (SHA-256 of
    /// off-chain proof blob or Sprint B Groth16 proof bytes). `batch_root` links
    /// to proxyhub `zk_batch` PDA seeds — existence is attested by the oracle
    /// until on-chain CPI/read is added in Sprint B/C.
    pub fn verify_usage(
        ctx: Context<VerifyUsage>,
        batch_root: [u8; 32],
        proof_hash: [u8; 32],
        total_bytes: u64,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.oracle_signer.key(),
            ctx.accounts.oracle_config.oracle_authority,
            ReputationError::Unauthorized
        );
        require!(batch_root != [0u8; 32], ReputationError::EmptyBatchRoot);
        require!(proof_hash != [0u8; 32], ReputationError::EmptyProofHash);
        require!(total_bytes > 0, ReputationError::InvalidAmount);

        let reputation = &mut ctx.accounts.provider_reputation;
        reputation.score = reputation.score.saturating_add(1);
        reputation.total_bytes_proven = reputation
            .total_bytes_proven
            .saturating_add(total_bytes);
        reputation.last_proof_timestamp = Clock::get()?.unix_timestamp;
        reputation.last_batch_root = batch_root;
        reputation.last_proof_hash = proof_hash;

        msg!(
            "reputation verify_usage oracle-attested batch={:?} bytes={} score={}",
            batch_root,
            total_bytes,
            reputation.score
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + OracleConfig::LEN,
        seeds = [b"oracle_config"],
        bump
    )]
    pub oracle_config: Account<'info, OracleConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [b"oracle_config"],
        bump = oracle_config.bump,
        has_one = admin
    )]
    pub oracle_config: Account<'info, OracleConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct StakeTokens<'info> {
    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + StakeAccount::LEN,
        seeds = [b"stake", signer.key().as_ref()],
        bump
    )]
    pub stake_account: Account<'info, StakeAccount>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SlashProvider<'info> {
    #[account(mut, seeds = [b"stake", provider_reputation.provider.as_ref()], bump)]
    pub stake_account: Account<'info, StakeAccount>,
    #[account(mut, seeds = [b"reputation", provider_reputation.provider.as_ref()], bump = provider_reputation.bump)]
    pub provider_reputation: Account<'info, ProviderReputation>,
    pub oracle_signer: Signer<'info>,
    #[account(seeds = [b"oracle_config"], bump = oracle_config.bump)]
    pub oracle_config: Account<'info, OracleConfig>,
}

#[derive(Accounts)]
pub struct VerifyUsage<'info> {
    #[account(mut, seeds = [b"reputation", provider_reputation.provider.as_ref()], bump = provider_reputation.bump)]
    pub provider_reputation: Account<'info, ProviderReputation>,
    pub oracle_signer: Signer<'info>,
    #[account(seeds = [b"oracle_config"], bump = oracle_config.bump)]
    pub oracle_config: Account<'info, OracleConfig>,
}

#[derive(Accounts)]
pub struct InitializeProvider<'info> {
    #[account(
        init,
        payer = signer,
        space = 8 + ProviderReputation::LEN,
        seeds = [b"reputation", signer.key().as_ref()],
        bump
    )]
    pub provider_reputation: Account<'info, ProviderReputation>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct OracleConfig {
    pub oracle_authority: Pubkey,
    pub admin: Pubkey,
    pub deploy_allowed: bool,
    pub bump: u8,
}

impl OracleConfig {
    pub const LEN: usize = 32 + 32 + 1 + 1;
}

#[account]
pub struct ProviderReputation {
    pub provider: Pubkey,
    pub score: u64,
    pub total_bytes_proven: u64,
    pub last_proof_timestamp: i64,
    pub last_batch_root: [u8; 32],
    pub last_proof_hash: [u8; 32],
    pub bump: u8,
}

impl ProviderReputation {
    pub const LEN: usize = 32 + 8 + 8 + 8 + 32 + 32 + 1;
}

#[account]
pub struct StakeAccount {
    pub owner: Pubkey,
    pub amount: u64,
}

impl StakeAccount {
    pub const LEN: usize = 32 + 8;
}

#[error_code]
pub enum ReputationError {
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("batch_root must be non-zero")]
    EmptyBatchRoot,
    #[msg("proof_hash must be non-zero (oracle-attested off-chain proof)")]
    EmptyProofHash,
    #[msg("Placeholder program ID — do not deploy")]
    DeployForbidden,
}
