//! ProxyHubb reputation program (BC-11 / Wave 4.2).
//!
//! Program ID (devnet keypair generated 2026-08-11):
//! `EnVE6ehKA2dYi69B3Lo8wt2wyDgzLw4tdtSEKoMYe5bF`
//!
//! Keypair (gitignored): `target/deploy/proxy_reputation-keypair.json`
//!
//! `verify_usage` is oracle-gated and requires non-empty `batch_root` +
//! `proof_hash`. Default build: oracle-attested score updates (batch existence
//! attested by oracle). With Cargo feature `onchain-groth16`: requires a live
//! proxyhub `ZKBatchPDA` account in remaining_accounts (fail-closed until
//! Groth16 verify writes that PDA — see BC11_GROTH16_PATH.md).
//!
//! **Deploy:** `scripts/deploy-reputation-devnet.ps1` after `anchor build`.
//! Do not claim mainnet readiness; `deploy_allowed` starts false until admin flip.

use anchor_lang::prelude::*;

declare_id!("EnVE6ehKA2dYi69B3Lo8wt2wyDgzLw4tdtSEKoMYe5bF");

/// Proxyhub escrow/settlement program that owns `zk_batch` PDAs.
pub const PROXYHUB_PROGRAM_ID: Pubkey =
    pubkey!("AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu");

#[program]
pub mod proxy_reputation {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, oracle_authority: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.oracle_config;
        config.oracle_authority = oracle_authority;
        config.admin = ctx.accounts.admin.key();
        // Wave 4.2: real program ID is wired; keep false until operator explicitly enables.
        config.deploy_allowed = false;
        config.bump = ctx.bumps.oracle_config;
        msg!("reputation config initialized (deploy_allowed=false — call set_deploy_allowed)");
        Ok(())
    }

    pub fn set_deploy_allowed(ctx: Context<UpdateConfig>, allowed: bool) -> Result<()> {
        ctx.accounts.oracle_config.deploy_allowed = allowed;
        msg!("reputation deploy_allowed={}", allowed);
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
        require!(
            ctx.accounts.oracle_config.deploy_allowed,
            ReputationError::DeployForbidden
        );
        let reputation = &mut ctx.accounts.provider_reputation;
        reputation.provider = ctx.accounts.signer.key();
        reputation.score = 100;
        reputation.total_bytes_proven = 0;
        reputation.last_proof_timestamp = Clock::get()?.unix_timestamp;
        reputation.last_batch_root = [0u8; 32];
        reputation.last_proof_hash = [0u8; 32];
        reputation.bump = ctx.bumps.provider_reputation;
        Ok(())
    }

    /// Oracle-paid init for a provider wallet (Wave 4.2 consume path).
    /// Seeds `[b"reputation", provider]` so verify_usage can credit without
    /// requiring the provider to sign first.
    pub fn initialize_provider_for(ctx: Context<InitializeProviderFor>) -> Result<()> {
        require!(
            ctx.accounts.oracle_config.deploy_allowed,
            ReputationError::DeployForbidden
        );
        require_keys_eq!(
            ctx.accounts.oracle_signer.key(),
            ctx.accounts.oracle_config.oracle_authority,
            ReputationError::Unauthorized
        );
        let reputation = &mut ctx.accounts.provider_reputation;
        reputation.provider = ctx.accounts.provider.key();
        reputation.score = 100;
        reputation.total_bytes_proven = 0;
        reputation.last_proof_timestamp = Clock::get()?.unix_timestamp;
        reputation.last_batch_root = [0u8; 32];
        reputation.last_proof_hash = [0u8; 32];
        reputation.bump = ctx.bumps.provider_reputation;
        msg!(
            "reputation initialize_provider_for provider={}",
            ctx.accounts.provider.key()
        );
        Ok(())
    }

    pub fn stake_tokens(ctx: Context<StakeTokens>, amount: u64) -> Result<()> {
        require!(
            ctx.accounts.oracle_config.deploy_allowed,
            ReputationError::DeployForbidden
        );
        require!(amount > 0, ReputationError::InvalidAmount);
        let stake = &mut ctx.accounts.stake_account;
        stake.amount = stake.amount.saturating_add(amount);
        stake.owner = ctx.accounts.signer.key();
        Ok(())
    }

    pub fn slash_provider(ctx: Context<SlashProvider>, amount: u64) -> Result<()> {
        require!(
            ctx.accounts.oracle_config.deploy_allowed,
            ReputationError::DeployForbidden
        );
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

    /// Credit provider reputation after a usage batch.
    ///
    /// remaining_accounts[0] (required when built with `onchain-groth16`):
    /// proxyhub `ZKBatchPDA` for `batch_root` — owner must be PROXYHUB_PROGRAM_ID
    /// and account data must contain matching `batch_root`.
    pub fn verify_usage(
        ctx: Context<VerifyUsage>,
        batch_root: [u8; 32],
        proof_hash: [u8; 32],
        total_bytes: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.oracle_config.deploy_allowed,
            ReputationError::DeployForbidden
        );
        require_keys_eq!(
            ctx.accounts.oracle_signer.key(),
            ctx.accounts.oracle_config.oracle_authority,
            ReputationError::Unauthorized
        );
        require!(batch_root != [0u8; 32], ReputationError::EmptyBatchRoot);
        require!(proof_hash != [0u8; 32], ReputationError::EmptyProofHash);
        require!(total_bytes > 0, ReputationError::InvalidAmount);

        #[cfg(feature = "onchain-groth16")]
        {
            require!(
                !ctx.remaining_accounts.is_empty(),
                ReputationError::MissingZkBatchAccount
            );
            let zk_batch = &ctx.remaining_accounts[0];
            require_keys_eq!(
                *zk_batch.owner,
                PROXYHUB_PROGRAM_ID,
                ReputationError::InvalidZkBatchOwner
            );
            let data = zk_batch.try_borrow_data()?;
            // Anchor account: 8-byte disc + batch_root[32] + ...
            require!(data.len() >= 8 + 32, ReputationError::InvalidZkBatchData);
            let stored_root: [u8; 32] = data[8..40]
                .try_into()
                .map_err(|_| error!(ReputationError::InvalidZkBatchData))?;
            require!(stored_root == batch_root, ReputationError::ZkBatchRootMismatch);
            msg!("verify_usage: ZKBatchPDA root matched (onchain-groth16 gate)");
        }

        let reputation = &mut ctx.accounts.provider_reputation;
        reputation.score = reputation.score.saturating_add(1);
        reputation.total_bytes_proven = reputation
            .total_bytes_proven
            .saturating_add(total_bytes);
        reputation.last_proof_timestamp = Clock::get()?.unix_timestamp;
        reputation.last_batch_root = batch_root;
        reputation.last_proof_hash = proof_hash;

        msg!(
            "reputation verify_usage batch={:?} bytes={} score={}",
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
    #[account(seeds = [b"oracle_config"], bump = oracle_config.bump)]
    pub oracle_config: Account<'info, OracleConfig>,
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
    #[account(seeds = [b"oracle_config"], bump = oracle_config.bump)]
    pub oracle_config: Account<'info, OracleConfig>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeProviderFor<'info> {
    #[account(
        init,
        payer = oracle_signer,
        space = 8 + ProviderReputation::LEN,
        seeds = [b"reputation", provider.key().as_ref()],
        bump
    )]
    pub provider_reputation: Account<'info, ProviderReputation>,
    /// CHECK: provider wallet whose reputation PDA is created.
    pub provider: UncheckedAccount<'info>,
    #[account(mut)]
    pub oracle_signer: Signer<'info>,
    #[account(seeds = [b"oracle_config"], bump = oracle_config.bump)]
    pub oracle_config: Account<'info, OracleConfig>,
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
    #[msg("Mutations disabled until set_deploy_allowed(true)")]
    DeployForbidden,
    #[msg("onchain-groth16 build requires a Groth16-verified ZKBatchPDA")]
    Groth16BatchRequired,
    #[msg("missing zk_batch remaining account")]
    MissingZkBatchAccount,
    #[msg("zk_batch owner is not proxyhub program")]
    InvalidZkBatchOwner,
    #[msg("zk_batch account data too short or invalid")]
    InvalidZkBatchData,
    #[msg("zk_batch root does not match instruction batch_root")]
    ZkBatchRootMismatch,
}
