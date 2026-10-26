//! ProxyHubb bonded-gateway program (Wave 8).
//!
//! **Not** `programs/session`. Session `slash_gateway` is unconstrained admin
//! transfer and must stay undeployed.
//!
//! Keypair (gitignored): `target/deploy/proxy_gateway_bond-keypair.json`
//! Localnet program ID: `7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5`
//! `deploy_allowed` starts false. Not `programs/session`.

mod math;

pub use math::{
    auto_release_at, config_windows_ok, slash_lamports, window_elapsed, MAX_SLASH_BPS,
    MIN_CHALLENGE_WINDOW_SECS,
};

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5");

pub const SEED_CONFIG: &[u8] = b"gateway-bond-config";
pub const SEED_BOND: &[u8] = b"gateway-bond";
pub const SEED_CHALLENGE: &[u8] = b"gateway-challenge";

#[program]
pub mod proxy_gateway_bond {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        accuser: Pubkey,
        treasury: Pubkey,
        challenge_window_secs: i64,
        unbonding_secs: i64,
        min_stake_lamports: u64,
        max_slash_bps: u16,
    ) -> Result<()> {
        require!(
            config_windows_ok(challenge_window_secs, unbonding_secs),
            BondError::ChallengeWindowTooShort
        );
        require!(min_stake_lamports > 0, BondError::InvalidAmount);
        require!(
            max_slash_bps > 0 && max_slash_bps <= MAX_SLASH_BPS,
            BondError::InvalidSlashBps
        );
        require!(accuser != Pubkey::default(), BondError::InvalidAccuser);
        require!(treasury != Pubkey::default(), BondError::InvalidTreasury);

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.accuser = accuser;
        config.treasury = treasury;
        config.challenge_window_secs = challenge_window_secs;
        config.unbonding_secs = unbonding_secs;
        config.min_stake_lamports = min_stake_lamports;
        config.max_slash_bps = max_slash_bps;
        config.deploy_allowed = false;
        config.bump = ctx.bumps.config;
        msg!("gateway-bond config init deploy_allowed=false");
        Ok(())
    }

    pub fn set_deploy_allowed(ctx: Context<AdminConfig>, allowed: bool) -> Result<()> {
        ctx.accounts.config.deploy_allowed = allowed;
        msg!("gateway-bond deploy_allowed={}", allowed);
        Ok(())
    }

    pub fn set_accuser(ctx: Context<AdminConfig>, accuser: Pubkey) -> Result<()> {
        require!(accuser != Pubkey::default(), BondError::InvalidAccuser);
        ctx.accounts.config.accuser = accuser;
        Ok(())
    }

    pub fn bond(ctx: Context<Bond>, amount: u64) -> Result<()> {
        require!(ctx.accounts.config.deploy_allowed, BondError::DeployForbidden);
        require!(amount > 0, BondError::InvalidAmount);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.operator.to_account_info(),
                    to: ctx.accounts.bond.to_account_info(),
                },
            ),
            amount,
        )?;

        let operator = ctx.accounts.operator.key();
        let bump = ctx.bumps.bond;
        let min_stake = ctx.accounts.config.min_stake_lamports;
        let bond = &mut ctx.accounts.bond;
        if bond.operator == Pubkey::default() {
            bond.operator = operator;
            bond.bump = bump;
        }
        require_keys_eq!(bond.operator, operator, BondError::Unauthorized);
        bond.stake_lamports = bond
            .stake_lamports
            .checked_add(amount)
            .ok_or(BondError::InvalidAmount)?;
        require!(
            bond.stake_lamports >= min_stake,
            BondError::InsufficientStake
        );
        bond.bonded = true;
        bond.unbonding_at = 0;
        Ok(())
    }

    pub fn request_unbond(ctx: Context<RequestUnbond>) -> Result<()> {
        require!(ctx.accounts.config.deploy_allowed, BondError::DeployForbidden);
        let bond = &mut ctx.accounts.bond;
        require!(!bond.open_challenge, BondError::ChallengeOpen);
        // BC-HIGH-04: do not gate exit on `bonded`. resolve_slash clears it
        // when a partial slash drops stake below min_stake, which trapped
        // the remaining stake (request_unbond reverted NotBonded and
        // withdraw_bond needs unbonding_at). Exit depends on still holding
        // stake and not already unbonding.
        require!(bond.stake_lamports > 0, BondError::NotBonded);
        require!(bond.unbonding_at == 0, BondError::NotBonded);
        bond.bonded = false;
        bond.unbonding_at = Clock::get()?
            .unix_timestamp
            .checked_add(ctx.accounts.config.unbonding_secs)
            .ok_or(BondError::InvalidAmount)?;
        Ok(())
    }

    pub fn withdraw_bond(ctx: Context<WithdrawBond>) -> Result<()> {
        require!(ctx.accounts.config.deploy_allowed, BondError::DeployForbidden);
        let bond = &ctx.accounts.bond;
        require!(!bond.open_challenge, BondError::ChallengeOpen);
        require!(bond.unbonding_at > 0, BondError::NotUnbonding);
        require!(
            Clock::get()?.unix_timestamp >= bond.unbonding_at,
            BondError::UnbondingWindowOpen
        );
        Ok(())
    }

    pub fn accuse(ctx: Context<Accuse>, evidence_hash: [u8; 32], slash_bps: u16) -> Result<()> {
        require!(ctx.accounts.config.deploy_allowed, BondError::DeployForbidden);
        require!(evidence_hash != [0u8; 32], BondError::EmptyEvidence);
        require!(
            slash_bps > 0 && slash_bps <= ctx.accounts.config.max_slash_bps,
            BondError::InvalidSlashBps
        );
        let bond = &mut ctx.accounts.bond;
        require!(bond.stake_lamports > 0, BondError::InsufficientStake);
        require!(!bond.open_challenge, BondError::ChallengeOpen);

        let now = Clock::get()?.unix_timestamp;
        let resolve_after = now
            .checked_add(ctx.accounts.config.challenge_window_secs)
            .ok_or(BondError::InvalidAmount)?;

        let challenge = &mut ctx.accounts.challenge;
        challenge.operator = bond.operator;
        challenge.accuser = ctx.accounts.accuser.key();
        challenge.evidence_hash = evidence_hash;
        challenge.slash_bps = slash_bps;
        challenge.opened_at = now;
        challenge.resolve_after = resolve_after;
        challenge.status = ChallengeStatus::Open;
        challenge.bump = ctx.bumps.challenge;
        bond.open_challenge = true;
        Ok(())
    }

    pub fn resolve_slash(ctx: Context<ResolveSlash>) -> Result<()> {
        require!(ctx.accounts.config.deploy_allowed, BondError::DeployForbidden);
        let now = Clock::get()?.unix_timestamp;
        require!(
            window_elapsed(now, ctx.accounts.challenge.resolve_after),
            BondError::ChallengeWindowOpen
        );
        require!(
            ctx.accounts.challenge.status == ChallengeStatus::Open,
            BondError::InvalidChallengeStatus
        );

        let bps = ctx.accounts.challenge.slash_bps;
        let stake = ctx.accounts.bond.stake_lamports;
        let amount = slash_lamports(stake, bps).ok_or(BondError::InvalidSlashBps)?;
        require!(amount > 0, BondError::SlashRoundsToZero);

        transfer_from_pda(
            &ctx.accounts.bond.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            amount,
        )?;

        let bond = &mut ctx.accounts.bond;
        bond.stake_lamports = bond.stake_lamports.saturating_sub(amount);
        bond.slashed_lamports = bond.slashed_lamports.saturating_add(amount);
        bond.slash_count = bond.slash_count.saturating_add(1);
        bond.open_challenge = false;
        if bond.stake_lamports < ctx.accounts.config.min_stake_lamports {
            bond.bonded = false;
        }
        Ok(())
    }

    pub fn resolve_release(ctx: Context<ResolveRelease>) -> Result<()> {
        require!(ctx.accounts.config.deploy_allowed, BondError::DeployForbidden);
        require!(
            ctx.accounts.challenge.status == ChallengeStatus::Open,
            BondError::InvalidChallengeStatus
        );
        let now = Clock::get()?.unix_timestamp;
        let admin = ctx.accounts.signer.key() == ctx.accounts.config.admin;
        let auto_at = auto_release_at(
            ctx.accounts.challenge.opened_at,
            ctx.accounts.config.challenge_window_secs,
        )
        .ok_or(BondError::ChallengeWindowTooShort)?;
        let operator_auto =
            ctx.accounts.signer.key() == ctx.accounts.bond.operator && now >= auto_at;
        require!(admin || operator_auto, BondError::Unauthorized);
        ctx.accounts.bond.open_challenge = false;
        Ok(())
    }
}

fn transfer_from_pda(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    let rent_min = Rent::get()?.minimum_balance(from.data_len());
    let after = from
        .lamports()
        .checked_sub(amount)
        .ok_or(BondError::InsufficientStake)?;
    require!(after >= rent_min, BondError::WouldViolateRent);
    **from.try_borrow_mut_lamports()? -= amount;
    **to.try_borrow_mut_lamports()? += amount;
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ChallengeStatus {
    Open,
}

#[account]
pub struct BondConfig {
    pub admin: Pubkey,
    pub accuser: Pubkey,
    pub treasury: Pubkey,
    pub challenge_window_secs: i64,
    pub unbonding_secs: i64,
    pub min_stake_lamports: u64,
    pub max_slash_bps: u16,
    pub deploy_allowed: bool,
    pub bump: u8,
}

impl BondConfig {
    pub const LEN: usize = 32 + 32 + 32 + 8 + 8 + 8 + 2 + 1 + 1;
}

#[account]
pub struct OperatorBond {
    pub operator: Pubkey,
    pub stake_lamports: u64,
    pub bonded: bool,
    pub unbonding_at: i64,
    pub open_challenge: bool,
    pub slash_count: u8,
    pub slashed_lamports: u64,
    pub bump: u8,
}

impl OperatorBond {
    pub const LEN: usize = 32 + 8 + 1 + 8 + 1 + 1 + 8 + 1;
}

#[account]
pub struct Challenge {
    pub operator: Pubkey,
    pub accuser: Pubkey,
    pub evidence_hash: [u8; 32],
    pub slash_bps: u16,
    pub opened_at: i64,
    pub resolve_after: i64,
    pub status: ChallengeStatus,
    pub bump: u8,
}

impl Challenge {
    pub const LEN: usize = 32 + 32 + 32 + 2 + 8 + 8 + 1 + 1;
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + BondConfig::LEN,
        seeds = [SEED_CONFIG],
        bump
    )]
    pub config: Account<'info, BondConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminConfig<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin
    )]
    pub config: Account<'info, BondConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct Bond<'info> {
    #[account(
        init_if_needed,
        payer = operator,
        space = 8 + OperatorBond::LEN,
        seeds = [SEED_BOND, operator.key().as_ref()],
        bump
    )]
    pub bond: Account<'info, OperatorBond>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, BondConfig>,
    #[account(mut)]
    pub operator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestUnbond<'info> {
    #[account(
        mut,
        seeds = [SEED_BOND, operator.key().as_ref()],
        bump = bond.bump,
        has_one = operator
    )]
    pub bond: Account<'info, OperatorBond>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, BondConfig>,
    pub operator: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawBond<'info> {
    #[account(
        mut,
        close = operator,
        seeds = [SEED_BOND, operator.key().as_ref()],
        bump = bond.bump,
        has_one = operator
    )]
    pub bond: Account<'info, OperatorBond>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, BondConfig>,
    #[account(mut)]
    pub operator: Signer<'info>,
}

#[derive(Accounts)]
pub struct Accuse<'info> {
    /// CHECK: operator pubkey; seeds the bond + challenge PDAs
    pub operator: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [SEED_BOND, operator.key().as_ref()],
        bump = bond.bump,
        has_one = operator
    )]
    pub bond: Account<'info, OperatorBond>,
    #[account(
        init,
        payer = accuser,
        space = 8 + Challenge::LEN,
        seeds = [SEED_CHALLENGE, operator.key().as_ref()],
        bump
    )]
    pub challenge: Account<'info, Challenge>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, BondConfig>,
    #[account(mut, address = config.accuser)]
    pub accuser: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveSlash<'info> {
    /// CHECK: operator pubkey; seeds the bond + challenge PDAs
    pub operator: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [SEED_BOND, operator.key().as_ref()],
        bump = bond.bump,
        has_one = operator
    )]
    pub bond: Account<'info, OperatorBond>,
    #[account(
        mut,
        close = accuser_rent,
        seeds = [SEED_CHALLENGE, operator.key().as_ref()],
        bump = challenge.bump,
        constraint = challenge.operator == operator.key()
    )]
    pub challenge: Account<'info, Challenge>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = admin, has_one = treasury)]
    pub config: Account<'info, BondConfig>,
    pub admin: Signer<'info>,
    /// CHECK: must match config.treasury (has_one)
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: rent refund to the accuser who paid to open the challenge
    #[account(mut, address = challenge.accuser)]
    pub accuser_rent: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ResolveRelease<'info> {
    /// CHECK: operator pubkey; seeds the bond + challenge PDAs
    pub operator: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [SEED_BOND, operator.key().as_ref()],
        bump = bond.bump,
        has_one = operator
    )]
    pub bond: Account<'info, OperatorBond>,
    #[account(
        mut,
        close = accuser_rent,
        seeds = [SEED_CHALLENGE, operator.key().as_ref()],
        bump = challenge.bump,
        constraint = challenge.operator == operator.key()
    )]
    pub challenge: Account<'info, Challenge>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, BondConfig>,
    pub signer: Signer<'info>,
    /// CHECK: rent refund to accuser
    #[account(mut, address = challenge.accuser)]
    pub accuser_rent: UncheckedAccount<'info>,
}

#[error_code]
pub enum BondError {
    #[msg("Mutations disabled until set_deploy_allowed(true)")]
    DeployForbidden,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Insufficient stake")]
    InsufficientStake,
    #[msg("Invalid slash bps")]
    InvalidSlashBps,
    #[msg("Slash amount rounds to zero")]
    SlashRoundsToZero,
    #[msg("Challenge window must be >= 3600s and unbonding >= window")]
    ChallengeWindowTooShort,
    #[msg("Challenge window has not elapsed")]
    ChallengeWindowOpen,
    #[msg("A challenge is already open")]
    ChallengeOpen,
    #[msg("Invalid challenge status")]
    InvalidChallengeStatus,
    #[msg("Operator is not bonded")]
    NotBonded,
    #[msg("Operator has not requested unbond")]
    NotUnbonding,
    #[msg("Unbonding delay has not elapsed")]
    UnbondingWindowOpen,
    #[msg("Transfer would drop the bond PDA below rent-exempt")]
    WouldViolateRent,
    #[msg("evidence_hash must be non-zero")]
    EmptyEvidence,
    #[msg("accuser pubkey required")]
    InvalidAccuser,
    #[msg("treasury pubkey required")]
    InvalidTreasury,
}
