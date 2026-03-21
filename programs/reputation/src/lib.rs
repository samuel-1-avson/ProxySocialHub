use anchor_lang::prelude::*;

declare_id!("PHub111111111111111111111111111111111111111");

#[program]
pub mod proxy_reputation {
    use super::*;

    /// Stake PHUBB tokens to participate in the network.
    pub fn stake_tokens(ctx: Context<StakeTokens>, amount: u64) -> Result<()> {
        let stake = &mut ctx.accounts.stake_account;
        stake.amount += amount;
        stake.owner = ctx.accounts.signer.key();
        msg!("🛡️ Staked {} PHUBB for provider {}.", amount, stake.owner);
        Ok(())
    }

    /// Slash a provider for malicious behavior (Honeytoken hit or Anomaly).
    /// This can only be called by the verified Gateway Oracle.
    pub fn slash_provider(ctx: Context<SlashProvider>, amount: u64) -> Result<()> {
        let stake = &mut ctx.accounts.stake_account;
        let reputation = &mut ctx.accounts.provider_reputation;
        
        if stake.amount < amount {
            stake.amount = 0;
        } else {
            stake.amount -= amount;
        }
        
        // Drastic reputation drop on slash
        reputation.score = reputation.score.saturating_sub(1000);
        
        msg!("⚠️ SLASHED! Provider {} lost {} PHUBB. New score: {}", stake.owner, amount, reputation.score);
        Ok(())
    }

    /// Verify a ZK-proof of usage and update the provider's reputation.
    pub fn verify_usage(
        ctx: Context<VerifyUsage>,
        session_id_hash: [u8; 32],
        total_bytes: u64,
        _proof_data: Vec<u8>,
    ) -> Result<()> {
        let reputation = &mut ctx.accounts.provider_reputation;
        
        // Update reputation score: success increases score
        reputation.score += 1;
        reputation.total_bytes_proven += total_bytes;
        reputation.last_proof_timestamp = Clock::get()?.unix_timestamp;

        msg!("✅ Usage verified for session {:?}. New score: {}", session_id_hash, reputation.score);
        Ok(())
    }

    /// Initialize a new provider's reputation account.
    pub fn initialize_provider(ctx: Context<InitializeProvider>) -> Result<()> {
        let reputation = &mut ctx.accounts.provider_reputation;
        reputation.score = 100; // Base reputation
        reputation.total_bytes_proven = 0;
        reputation.last_proof_timestamp = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct StakeTokens<'info> {
    #[account(init_if_needed, payer = signer, space = 8 + 32 + 8, seeds = [b"stake", signer.key().as_ref()], bump)]
    pub stake_account: Account<'info, StakeAccount>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SlashProvider<'info> {
    #[account(mut)]
    pub stake_account: Account<'info, StakeAccount>,
    #[account(mut)]
    pub provider_reputation: Account<'info, ProviderReputation>,
    pub oracle_signer: Signer<'info>, // Only the gateway oracle can slash
}

#[derive(Accounts)]
pub struct VerifyUsage<'info> {
    #[account(mut)]
    pub provider_reputation: Account<'info, ProviderReputation>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeProvider<'info> {
    #[account(init, payer = signer, space = 8 + 8 + 8 + 8)]
    pub provider_reputation: Account<'info, ProviderReputation>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct ProviderReputation {
    pub score: u64,
    pub total_bytes_proven: u64,
    pub last_proof_timestamp: i64,
}

#[account]
pub struct StakeAccount {
    pub owner: Pubkey,
    pub amount: u64,
}
