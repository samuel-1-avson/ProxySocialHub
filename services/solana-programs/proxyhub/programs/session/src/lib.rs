use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("8TP21JyrghboxZqXMozx2sVzrDrNSZyN2hkf1D7dQGmb");

/// Pro-rata escrow split in integer lamports (no f64).
/// Returns `(provider_payout, buyer_refund)`.
pub fn compute_session_payout(escrow_amount: u64, bytes_used: u64, bytes_limit: u64) -> (u64, u64) {
    let billed_bytes = std::cmp::min(bytes_used, bytes_limit);
    let provider_payout = if bytes_limit > 0 {
        (escrow_amount as u128)
            .saturating_mul(billed_bytes as u128)
            .checked_div(bytes_limit as u128)
            .unwrap_or(0) as u64
    } else {
        0
    };
    let buyer_refund = escrow_amount.saturating_sub(provider_payout);
    (provider_payout, buyer_refund)
}

/// Session status - tracks the lifecycle of a proxy session
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum SessionStatus {
    Created,    // Session initialized, awaiting activation
    Active,     // Session in use (traffic flowing)
    Paused,     // Temporarily paused
    Completed,  // Successfully finished
    Cancelled,  // Cancelled before completion
    Disputed,   // Under dispute resolution
}

impl Default for SessionStatus {
    fn default() -> Self {
        SessionStatus::Created
    }
}

/// On-chain Session Account - tracks proxy sessions with full accountability
#[account]
pub struct Session {
    pub buyer: Pubkey,              // Consumer wallet
    pub provider: Pubkey,           // Provider wallet
    pub gateway: Pubkey,            // Gateway node that routed this session
    
    // Usage tracking
    pub bytes_used: u64,            // Total bytes transferred
    pub bytes_limit: u64,           // Maximum allowed bytes
    pub requests_count: u64,        // Total HTTP requests
    
    // Financial
    pub escrow_amount: u64,         // Locked funds (lamports or token units)
    pub rate_per_gb: u64,           // Price per GB in smallest units
    
    // State
    pub status: SessionStatus,
    pub quality_score: u8,          // 0-100 quality rating
    
    // Timestamps
    pub created_at: i64,
    pub activated_at: i64,
    pub completed_at: i64,
    pub expires_at: i64,
    
    // Proofs
    pub usage_proof_cid: [u8; 46],  // IPFS CID of usage proof
    pub arweave_tx: [u8; 43],       // Arweave transaction ID
    
    pub bump: u8,
}

impl Default for Session {
    fn default() -> Self {
        Self {
            buyer: Pubkey::default(),
            provider: Pubkey::default(),
            gateway: Pubkey::default(),
            bytes_used: 0,
            bytes_limit: 0,
            requests_count: 0,
            escrow_amount: 0,
            rate_per_gb: 0,
            status: SessionStatus::default(),
            quality_score: 0,
            created_at: 0,
            activated_at: 0,
            completed_at: 0,
            expires_at: 0,
            usage_proof_cid: [0; 46],
            arweave_tx: [0; 43],
            bump: 0,
        }
    }
}

impl Session {
    pub const LEN: usize = 8 +      // discriminator
        32 +                         // buyer
        32 +                         // provider
        32 +                         // gateway
        8 +                          // bytes_used
        8 +                          // bytes_limit
        8 +                          // requests_count
        8 +                          // escrow_amount
        8 +                          // rate_per_gb
        1 +                          // status
        1 +                          // quality_score
        8 +                          // created_at
        8 +                          // activated_at
        8 +                          // completed_at
        8 +                          // expires_at
        46 +                         // usage_proof_cid
        43 +                         // arweave_tx
        1;                           // bump
}

/// Gateway Node - community-operated proxy gateway
#[account]
pub struct GatewayNode {
    pub operator: Pubkey,           // Gateway operator wallet
    pub stake: u64,                 // Staked amount for slashing
    pub region: [u8; 8],            // Region code (e.g., "us-east1")
    pub endpoint: [u8; 64],         // Gateway endpoint URL
    
    // Performance metrics
    pub uptime_score: u16,          // 0-10000 basis points (100.00%)
    pub latency_ms: u32,            // Average latency in milliseconds
    pub sessions_served: u64,       // Total sessions processed
    pub bytes_routed: u64,          // Total bytes routed
    
    // State
    pub is_active: bool,
    pub registered_at: i64,
    pub last_heartbeat: i64,
    
    // Slashing
    pub slash_count: u8,            // Number of times slashed
    pub slashed_amount: u64,        // Total slashed
    
    pub bump: u8,
}

impl Default for GatewayNode {
    fn default() -> Self {
        Self {
            operator: Pubkey::default(),
            stake: 0,
            region: [0; 8],
            endpoint: [0; 64],
            uptime_score: 0,
            latency_ms: 0,
            sessions_served: 0,
            bytes_routed: 0,
            is_active: false,
            registered_at: 0,
            last_heartbeat: 0,
            slash_count: 0,
            slashed_amount: 0,
            bump: 0,
        }
    }
}

impl GatewayNode {
    pub const MIN_STAKE: u64 = 1_000_000_000; // 1 SOL minimum stake

    pub const LEN: usize = 8 +      // discriminator
        32 +                         // operator
        8 +                          // stake
        8 +                          // region
        64 +                         // endpoint
        2 +                          // uptime_score
        4 +                          // latency_ms
        8 +                          // sessions_served
        8 +                          // bytes_routed
        1 +                          // is_active
        8 +                          // registered_at
        8 +                          // last_heartbeat
        1 +                          // slash_count
        8 +                          // slashed_amount
        1;                           // bump
}

/// Program configuration — binds authorized oracle/admin/treasury
#[account]
pub struct Config {
    pub admin: Pubkey,
    pub oracle: Pubkey,
    pub treasury: Pubkey,
    pub bump: u8,
}

impl Config {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 1;
}

#[program]
pub mod session {
    use super::*;

    // ============== CONFIG ==============

    /// Initialize program configuration (one-time)
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        oracle: Pubkey,
        treasury: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.oracle = oracle;
        config.treasury = treasury;
        config.bump = ctx.bumps.config;
        msg!(
            "Session config initialized: admin={} oracle={} treasury={}",
            config.admin,
            config.oracle,
            config.treasury
        );
        Ok(())
    }

    // ============== SESSION MANAGEMENT ==============

    /// Create a new session with escrow
    pub fn create_session(
        ctx: Context<CreateSession>,
        bytes_limit: u64,
        rate_per_gb: u64,
        expires_at: i64,
        escrow_amount: u64,
    ) -> Result<()> {
        let buyer_key = ctx.accounts.buyer.key();
        let provider_key = ctx.accounts.provider.key();
        let gateway_key = ctx.accounts.gateway.key();
        let session_key = ctx.accounts.session.key();
        let buyer_info = ctx.accounts.buyer.to_account_info();
        let session_info = ctx.accounts.session.to_account_info();
        let system_program_info = ctx.accounts.system_program.to_account_info();
        let session = &mut ctx.accounts.session;
        let clock = Clock::get()?;

        require!(expires_at > clock.unix_timestamp, SessionError::InvalidStatus);

        session.buyer = buyer_key;
        session.provider = provider_key;
        session.gateway = gateway_key;
        session.bytes_limit = bytes_limit;
        session.rate_per_gb = rate_per_gb;
        session.escrow_amount = escrow_amount;
        session.status = SessionStatus::Created;
        session.created_at = clock.unix_timestamp;
        session.expires_at = expires_at;
        session.bump = ctx.bumps.session;

        // Transfer escrow from buyer to session PDA
        let cpi_context = CpiContext::new(
            system_program_info,
            system_program::Transfer {
                from: buyer_info,
                to: session_info,
            },
        );
        system_program::transfer(cpi_context, escrow_amount)?;

        emit!(SessionCreated {
            session: session_key,
            buyer: session.buyer,
            provider: session.provider,
            gateway: session.gateway,
            escrow_amount,
            timestamp: clock.unix_timestamp,
        });

        msg!("Session created: {} with {} lamports escrow", session_key, escrow_amount);
        Ok(())
    }

    /// Activate a session (gateway confirms routing is ready)
    pub fn activate_session(ctx: Context<ActivateSession>) -> Result<()> {
        let session = &mut ctx.accounts.session;
        let clock = Clock::get()?;

        require!(session.status == SessionStatus::Created, SessionError::InvalidStatus);

        session.status = SessionStatus::Active;
        session.activated_at = clock.unix_timestamp;

        emit!(SessionActivated {
            session: ctx.accounts.session.key(),
            gateway: ctx.accounts.gateway.key(),
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Report usage (called periodically by gateway/oracle)
    pub fn report_usage(
        ctx: Context<ReportUsage>,
        bytes_delta: u64,
        requests_delta: u64,
    ) -> Result<()> {
        let session_key = ctx.accounts.session.key();
        let session = &mut ctx.accounts.session;

        require!(
            session.status == SessionStatus::Active,
            SessionError::InvalidStatus
        );

        session.bytes_used = session.bytes_used.saturating_add(bytes_delta);
        session.requests_count = session.requests_count.saturating_add(requests_delta);

        // Check if usage exceeded limit
        if session.bytes_used >= session.bytes_limit {
            session.status = SessionStatus::Completed;
        }

        emit!(UsageReported {
            session: session_key,
            bytes_used: session.bytes_used,
            requests_count: session.requests_count,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Complete session and settle escrow
    pub fn complete_session(
        ctx: Context<CompleteSession>,
        quality_score: u8,
        usage_proof_cid: [u8; 46],
    ) -> Result<()> {
        let session = &mut ctx.accounts.session;
        let clock = Clock::get()?;

        require!(
            session.status == SessionStatus::Active || session.status == SessionStatus::Created,
            SessionError::InvalidStatus
        );
        require!(quality_score <= 100, SessionError::InvalidQualityScore);

        session.status = SessionStatus::Completed;
        session.completed_at = clock.unix_timestamp;
        session.quality_score = quality_score;
        session.usage_proof_cid = usage_proof_cid;

        let (provider_payout, buyer_refund) =
            compute_session_payout(session.escrow_amount, session.bytes_used, session.bytes_limit);

        // Transfer to provider
        if provider_payout > 0 {
            **session.to_account_info().try_borrow_mut_lamports()? -= provider_payout;
            **ctx.accounts.provider.try_borrow_mut_lamports()? += provider_payout;
        }

        // Refund remainder to buyer
        if buyer_refund > 0 {
            **session.to_account_info().try_borrow_mut_lamports()? -= buyer_refund;
            **ctx.accounts.buyer.try_borrow_mut_lamports()? += buyer_refund;
        }

        // Update gateway stats
        let gateway = &mut ctx.accounts.gateway_node;
        gateway.sessions_served = gateway.sessions_served.saturating_add(1);
        gateway.bytes_routed = gateway.bytes_routed.saturating_add(session.bytes_used);

        emit!(SessionCompleted {
            session: ctx.accounts.session.key(),
            provider_payout,
            buyer_refund,
            quality_score,
            timestamp: clock.unix_timestamp,
        });

        msg!("Session completed: {} to provider, {} refunded", provider_payout, buyer_refund);
        Ok(())
    }

    // ============== GATEWAY REGISTRY ==============

    /// Register a new gateway node (requires stake)
    pub fn register_gateway(
        ctx: Context<RegisterGateway>,
        region: [u8; 8],
        endpoint: [u8; 64],
        stake_amount: u64,
    ) -> Result<()> {
        let operator_key = ctx.accounts.operator.key();
        let gateway_key = ctx.accounts.gateway.key();
        let operator_info = ctx.accounts.operator.to_account_info();
        let gateway_info = ctx.accounts.gateway.to_account_info();
        let system_program_info = ctx.accounts.system_program.to_account_info();
        let gateway = &mut ctx.accounts.gateway;
        let clock = Clock::get()?;

        require!(stake_amount >= GatewayNode::MIN_STAKE, GatewayError::InsufficientStake);

        gateway.operator = operator_key;
        gateway.stake = stake_amount;
        gateway.region = region;
        gateway.endpoint = endpoint;
        gateway.is_active = true;
        gateway.registered_at = clock.unix_timestamp;
        gateway.last_heartbeat = clock.unix_timestamp;
        gateway.uptime_score = 10000; // Start at 100%
        gateway.bump = ctx.bumps.gateway;

        // Transfer stake to gateway PDA
        let cpi_context = CpiContext::new(
            system_program_info,
            system_program::Transfer {
                from: operator_info,
                to: gateway_info,
            },
        );
        system_program::transfer(cpi_context, stake_amount)?;

        emit!(GatewayRegistered {
            gateway: gateway_key,
            operator: gateway.operator,
            stake: stake_amount,
            region,
            timestamp: clock.unix_timestamp,
        });

        msg!("Gateway registered with {} lamports stake", stake_amount);
        Ok(())
    }

    /// Gateway heartbeat (proves liveness)
    pub fn gateway_heartbeat(ctx: Context<GatewayHeartbeat>, latency_ms: u32) -> Result<()> {
        let gateway = &mut ctx.accounts.gateway;
        let clock = Clock::get()?;

        gateway.last_heartbeat = clock.unix_timestamp;
        gateway.latency_ms = latency_ms;

        Ok(())
    }

    /// Slash a misbehaving gateway
    pub fn slash_gateway(
        ctx: Context<SlashGateway>,
        slash_percentage: u8,
        reason: String,
    ) -> Result<()> {
        let gateway = &mut ctx.accounts.gateway;
        
        require!(slash_percentage <= 100, GatewayError::InvalidSlashPercentage);

        let slash_amount = (gateway.stake as u128 * slash_percentage as u128 / 100) as u64;
        
        gateway.stake = gateway.stake.saturating_sub(slash_amount);
        gateway.slashed_amount = gateway.slashed_amount.saturating_add(slash_amount);
        gateway.slash_count = gateway.slash_count.saturating_add(1);

        // If stake drops below minimum, deactivate
        if gateway.stake < GatewayNode::MIN_STAKE {
            gateway.is_active = false;
        }

        // Transfer slashed funds to treasury
        **gateway.to_account_info().try_borrow_mut_lamports()? -= slash_amount;
        **ctx.accounts.treasury.try_borrow_mut_lamports()? += slash_amount;

        emit!(GatewaySlashed {
            gateway: ctx.accounts.gateway.key(),
            slash_amount,
            reason,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("Gateway slashed: {} lamports", slash_amount);
        Ok(())
    }

    /// Deregister gateway and return remaining stake
    pub fn deregister_gateway(ctx: Context<DeregisterGateway>) -> Result<()> {
        let gateway = &mut ctx.accounts.gateway;
        
        gateway.is_active = false;

        // Return remaining stake to operator
        let remaining = gateway.stake;
        **gateway.to_account_info().try_borrow_mut_lamports()? -= remaining;
        **ctx.accounts.operator.try_borrow_mut_lamports()? += remaining;
        gateway.stake = 0;

        msg!("Gateway deregistered, {} lamports returned", remaining);
        Ok(())
    }
}

// ============== ACCOUNT CONTEXTS ==============

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = Config::LEN,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(bytes_limit: u64, rate_per_gb: u64, expires_at: i64, escrow_amount: u64)]
pub struct CreateSession<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: Provider receives funds on completion
    pub provider: UncheckedAccount<'info>,

    /// CHECK: Gateway PDA that routes this session
    pub gateway: UncheckedAccount<'info>,

    #[account(
        init,
        payer = buyer,
        space = Session::LEN,
        seeds = [b"session", buyer.key().as_ref(), provider.key().as_ref(), &expires_at.to_le_bytes()],
        bump
    )]
    pub session: Account<'info, Session>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ActivateSession<'info> {
    #[account(mut, address = session.gateway)]
    pub gateway: Signer<'info>,

    #[account(
        mut,
        seeds = [b"session", session.buyer.as_ref(), session.provider.as_ref(), &session.expires_at.to_le_bytes()],
        bump = session.bump,
    )]
    pub session: Account<'info, Session>,
}

#[derive(Accounts)]
pub struct ReportUsage<'info> {
    /// Reporter must be session gateway, session provider, or config oracle
    pub reporter: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [b"session", session.buyer.as_ref(), session.provider.as_ref(), &session.expires_at.to_le_bytes()],
        bump = session.bump,
        constraint = reporter.key() == session.gateway
            || reporter.key() == session.provider
            || reporter.key() == config.oracle
    )]
    pub session: Account<'info, Session>,
}

#[derive(Accounts)]
pub struct CompleteSession<'info> {
    /// Oracle that finalizes the session (must equal config.oracle)
    #[account(address = config.oracle)]
    pub oracle: Signer<'info>,

    #[account(
        mut,
        seeds = [b"session", session.buyer.as_ref(), session.provider.as_ref(), &session.expires_at.to_le_bytes()],
        bump = session.bump,
    )]
    pub session: Account<'info, Session>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// CHECK: Buyer receives refund
    #[account(mut, address = session.buyer)]
    pub buyer: UncheckedAccount<'info>,

    /// CHECK: Provider receives payment
    #[account(mut, address = session.provider)]
    pub provider: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"gateway", gateway_node.operator.as_ref()],
        bump = gateway_node.bump,
        constraint = gateway_node.operator == session.gateway,
    )]
    pub gateway_node: Account<'info, GatewayNode>,
}

#[derive(Accounts)]
pub struct RegisterGateway<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    #[account(
        init,
        payer = operator,
        space = GatewayNode::LEN,
        seeds = [b"gateway", operator.key().as_ref()],
        bump
    )]
    pub gateway: Account<'info, GatewayNode>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GatewayHeartbeat<'info> {
    #[account(address = gateway.operator)]
    pub operator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"gateway", gateway.operator.as_ref()],
        bump = gateway.bump,
    )]
    pub gateway: Account<'info, GatewayNode>,
}

#[derive(Accounts)]
pub struct SlashGateway<'info> {
    /// Admin/DAO that can slash (must equal config.admin)
    #[account(address = config.admin)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"gateway", gateway.operator.as_ref()],
        bump = gateway.bump,
    )]
    pub gateway: Account<'info, GatewayNode>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// CHECK: Treasury receives slashed funds (must equal config.treasury)
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct DeregisterGateway<'info> {
    #[account(mut, address = gateway.operator)]
    pub operator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"gateway", gateway.operator.as_ref()],
        bump = gateway.bump,
    )]
    pub gateway: Account<'info, GatewayNode>,
}

// ============== EVENTS ==============

#[event]
pub struct SessionCreated {
    pub session: Pubkey,
    pub buyer: Pubkey,
    pub provider: Pubkey,
    pub gateway: Pubkey,
    pub escrow_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct SessionActivated {
    pub session: Pubkey,
    pub gateway: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct UsageReported {
    pub session: Pubkey,
    pub bytes_used: u64,
    pub requests_count: u64,
    pub timestamp: i64,
}

#[event]
pub struct SessionCompleted {
    pub session: Pubkey,
    pub provider_payout: u64,
    pub buyer_refund: u64,
    pub quality_score: u8,
    pub timestamp: i64,
}

#[event]
pub struct GatewayRegistered {
    pub gateway: Pubkey,
    pub operator: Pubkey,
    pub stake: u64,
    pub region: [u8; 8],
    pub timestamp: i64,
}

#[event]
pub struct GatewaySlashed {
    pub gateway: Pubkey,
    pub slash_amount: u64,
    pub reason: String,
    pub timestamp: i64,
}

// ============== ERRORS ==============

#[error_code]
pub enum SessionError {
    #[msg("Invalid session status for this operation")]
    InvalidStatus,
    #[msg("Session has expired")]
    SessionExpired,
    #[msg("Quality score must be 0-100")]
    InvalidQualityScore,
}

#[error_code]
pub enum GatewayError {
    #[msg("Insufficient stake amount")]
    InsufficientStake,
    #[msg("Gateway is not active")]
    GatewayNotActive,
    #[msg("Invalid slash percentage")]
    InvalidSlashPercentage,
}

#[cfg(test)]
mod payout_math_tests {
    use super::compute_session_payout;

    #[test]
    fn full_usage_pays_provider_all() {
        let (p, r) = compute_session_payout(1_000_000, 100, 100);
        assert_eq!(p, 1_000_000);
        assert_eq!(r, 0);
    }

    #[test]
    fn half_usage_splits_evenly() {
        let (p, r) = compute_session_payout(1_000_000, 50, 100);
        assert_eq!(p, 500_000);
        assert_eq!(r, 500_000);
    }

    #[test]
    fn zero_limit_refunds_all() {
        let (p, r) = compute_session_payout(1_000_000, 50, 0);
        assert_eq!(p, 0);
        assert_eq!(r, 1_000_000);
    }

    #[test]
    fn over_usage_caps_at_escrow() {
        let (p, r) = compute_session_payout(1_000_000, 200, 100);
        assert_eq!(p, 1_000_000);
        assert_eq!(r, 0);
    }

    #[test]
    fn large_values_do_not_overflow() {
        // Would lose precision / panic with naive f64 or u64 mul without widening.
        let escrow = u64::MAX / 2;
        let (p, r) = compute_session_payout(escrow, 1, 3);
        assert_eq!(p + r, escrow);
        assert_eq!(p, escrow / 3);
    }

    #[test]
    fn remainder_stays_with_buyer() {
        // 1 lamport escrow, 1 of 3 bytes → floor division leaves refund
        let (p, r) = compute_session_payout(1, 1, 3);
        assert_eq!(p, 0);
        assert_eq!(r, 1);
    }
}
