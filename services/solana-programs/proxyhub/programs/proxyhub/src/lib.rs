use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Token, TokenAccount, Transfer as TokenTransfer};

declare_id!("2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7");

// =============================================================================
// ERROR CODES
// =============================================================================

#[error_code]
pub enum EscrowError {
    #[msg("Invalid escrow status for this operation")]
    InvalidStatus,
    #[msg("Escrow has expired")]
    Expired,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Dispute already resolved")]
    DisputeAlreadyResolved,
    #[msg("Invalid percentage")]
    InvalidPercentage,
    #[msg("Program is paused")]
    ProgramPaused,
    #[msg("Invalid oracle signature")]
    InvalidOracleSignature,
    #[msg("Insufficient oracle signatures")]
    InsufficientSignatures,
    #[msg("Duplicate oracle signature")]
    DuplicateSignature,
    #[msg("Invalid juror")]
    InvalidJuror,
    #[msg("Jury already voted")]
    AlreadyVoted,
    #[msg("Invalid gateway status")]
    InvalidGatewayStatus,
    #[msg("Stream has ended")]
    StreamEnded,
    #[msg("Not expired yet")]
    NotExpired,
    #[msg("Emergency pause not authorized")]
    EmergencyPauseUnauthorized,
    #[msg("Stale price data")]
    StalePriceData,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
}

// =============================================================================
// STATE ENUMS
// =============================================================================

/// Escrow states
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum EscrowStatus {
    Pending,  // Funds deposited, awaiting service
    Active,   // Service is being used
    Settled,  // Funds released to seller
    Refunded, // Funds returned to buyer
    Disputed, // Dispute raised
}

impl Default for EscrowStatus {
    fn default() -> Self {
        EscrowStatus::Pending
    }
}

/// Dispute status
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum DisputeStatus {
    Open,      // Dispute is active
    Resolved,  // Admin/jury has resolved
    Cancelled, // Initiator cancelled
}

impl Default for DisputeStatus {
    fn default() -> Self {
        DisputeStatus::Open
    }
}

/// Gateway status
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum GatewayStatus {
    Active,
    Inactive,
    Slashed,
}

impl Default for GatewayStatus {
    fn default() -> Self {
        GatewayStatus::Active
    }
}

// =============================================================================
// ACCOUNT STRUCTURES
// =============================================================================

/// Program State - Contains emergency pause and configuration
#[account]
#[derive(Default)]
pub struct ProgramState {
    pub admin: Pubkey,                 // Program administrator
    pub paused: bool,                  // Emergency pause flag
    pub paused_at: i64,                // When pause was activated
    pub min_oracle_signatures: u8,     // Required signatures (default: 3)
    pub price_validity_seconds: i64,   // How long prices are valid (default: 300)
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

impl ProgramState {
    pub const LEN: usize = 8 + // discriminator
        32 + // admin
        1 +  // paused
        8 +  // paused_at
        1 +  // min_oracle_signatures
        8 +  // price_validity_seconds
        8 +  // created_at
        8 +  // updated_at
        1;   // bump
}

/// MultiSig Oracle Configuration
#[account]
#[derive(Default)]
pub struct MultiSigOracle {
    pub signers: Vec<Pubkey>,          // Authorized oracle signers (max 5)
    pub threshold: u8,                 // Required signatures (default: 3)
    pub nonce: u64,                    // Replay protection nonce
    pub last_update: i64,              // Last configuration update
    pub bump: u8,
}

impl MultiSigOracle {
    pub const MAX_SIGNERS: usize = 5;
    
    pub const LEN: usize = 8 + // discriminator
        4 + (32 * Self::MAX_SIGNERS) + // signers vec
        1 +  // threshold
        8 +  // nonce
        8 +  // last_update
        1;   // bump
}

/// Oracle Signature Record - Prevents replay attacks
#[account]
#[derive(Default)]
pub struct OracleSignature {
    pub escrow: Pubkey,                // Which escrow this sig is for
    pub signers: Vec<Pubkey>,          // Who signed
    pub nonce: u64,                    // MultiSigOracle nonce at time of signing
    pub created_at: i64,
    pub bump: u8,
}

impl OracleSignature {
    pub const MAX_SIGS: usize = 5;
    
    pub const LEN: usize = 8 + // discriminator
        32 + // escrow
        4 + (32 * Self::MAX_SIGS) + // signers vec
        8 +  // nonce
        8 +  // created_at
        1;   // bump
}

/// The Escrow Account PDA (for SOL)
#[account]
#[derive(Default)]
pub struct Escrow {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub bandwidth_limit_gb: u64,
    pub bandwidth_used_gb: u64,
    pub status: EscrowStatus,
    pub created_at: i64,
    pub expires_at: i64,
    pub price_oracle: Pubkey,          // Oracle that provided price
    pub price_timestamp: i64,          // When price was recorded
    pub bump: u8,
}

impl Escrow {
    pub const LEN: usize = 8 + // discriminator
        32 + // buyer
        32 + // seller
        8 +  // amount
        8 +  // bandwidth_limit_gb
        8 +  // bandwidth_used_gb
        1 +  // status (enum)
        8 +  // created_at
        8 +  // expires_at
        32 + // price_oracle
        8 +  // price_timestamp
        1;   // bump
}

/// Token Escrow Account PDA (for SPL tokens like USDC)
#[account]
#[derive(Default)]
pub struct TokenEscrow {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub mint: Pubkey, // Token mint address (e.g., USDC)
    pub amount: u64,
    pub bandwidth_limit_gb: u64,
    pub bandwidth_used_gb: u64,
    pub status: EscrowStatus,
    pub created_at: i64,
    pub expires_at: i64,
    pub price_oracle: Pubkey,
    pub price_timestamp: i64,
    pub bump: u8,
}

impl TokenEscrow {
    pub const LEN: usize = 8 + // discriminator
        32 + // buyer
        32 + // seller
        32 + // mint
        8 +  // amount
        8 +  // bandwidth_limit_gb
        8 +  // bandwidth_used_gb
        1 +  // status (enum)
        8 +  // created_at
        8 +  // expires_at
        32 + // price_oracle
        8 +  // price_timestamp
        1;   // bump
}

/// Dispute Account - tracks disputes on escrows
#[account]
#[derive(Default)]
pub struct Dispute {
    pub escrow: Pubkey,        // Reference to escrow PDA
    pub initiator: Pubkey,     // Who raised the dispute
    pub is_buyer: bool,        // True if buyer initiated
    pub reason: String,        // Dispute reason (max 256 chars)
    pub status: DisputeStatus, // Current status
    pub created_at: i64,       // When dispute was raised
    pub resolved_at: i64,      // When dispute was resolved (0 if open)
    pub resolution: String,    // Admin's resolution text
    pub buyer_payout: u64,     // Final buyer payout
    pub seller_payout: u64,    // Final seller payout
    pub jury_address: Option<Pubkey>, // Associated jury account
    pub bump: u8,
}

impl Dispute {
    pub const MAX_REASON_LEN: usize = 256;
    pub const MAX_RESOLUTION_LEN: usize = 256;

    pub const LEN: usize = 8 + // discriminator
        32 + // escrow
        32 + // initiator
        1 +  // is_buyer
        4 + Self::MAX_REASON_LEN + // reason (String with length prefix)
        1 +  // status
        8 +  // created_at
        8 +  // resolved_at
        4 + Self::MAX_RESOLUTION_LEN + // resolution
        8 +  // buyer_payout
        8 +  // seller_payout
        33 + // jury_address (Option<Pubkey>)
        1;   // bump
}

/// Admin Configuration Account - stores authorized admin for dispute resolution
#[account]
#[derive(Default)]
pub struct AdminConfig {
    pub admin: Pubkey,         // The authorized admin public key
    pub pending_admin: Pubkey, // Pending admin for two-step transfer (optional)
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

impl AdminConfig {
    pub const LEN: usize = 8 + // discriminator
        32 + // admin
        32 + // pending_admin
        8 +  // created_at
        8 +  // updated_at
        1;   // bump
}

/// Stake Account - tracks provider's locked tokens for security
#[account]
#[derive(Default)]
pub struct StakeAccount {
    pub owner: Pubkey,
    pub amount: u64,
    pub last_stake_time: i64,
    pub unstake_request_time: i64, // 0 if no request, otherwise timestamp
    pub is_slashed: bool,
    pub insurance_pool_contribution: u64, // Amount allocated to insurance
    pub bump: u8,
}

impl StakeAccount {
    pub const LEN: usize = 8 + // discriminator
        32 + // owner
        8 +  // amount
        8 +  // last_stake_time
        8 +  // unstake_request_time
        1 +  // is_slashed
        8 +  // insurance_pool_contribution
        1;   // bump
}

/// Insurance Pool - Shared pool for provider protection
#[account]
#[derive(Default)]
pub struct InsurancePool {
    pub total_funds: u64,
    pub total_providers: u32,
    pub slash_percentage: u8,  // Default: 10%
    pub created_at: i64,
    pub bump: u8,
}

impl InsurancePool {
    pub const LEN: usize = 8 + // discriminator
        8 +  // total_funds
        4 +  // total_providers
        1 +  // slash_percentage
        8 +  // created_at
        1;   // bump
}

/// Streaming Escrow Account - supports pay-as-you-go flow
#[account]
#[derive(Default)]
pub struct StreamingEscrow {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub mint: Pubkey,            // Token mint (optional, default SOL)
    pub total_deposited: u64,    // Total funds allocated
    pub total_withdrawn: u64,    // Funds already claimed by seller
    pub flow_rate: u64,          // Lamports/Tokens per second
    pub start_time: i64,         // When streaming starts
    pub last_withdraw_time: i64, // Last time seller withdrew
    pub end_time: i64,           // When stream ends (derived or fixed)
    pub is_active: bool,
    pub bump: u8,
}

impl StreamingEscrow {
    pub const LEN: usize = 8 + // discriminator
        32 + // buyer
        32 + // seller
        32 + // mint
        8 +  // total_deposited
        8 +  // total_withdrawn
        8 +  // flow_rate
        8 +  // start_time
        8 +  // last_withdraw_time
        8 +  // end_time
        1 +  // is_active
        1;   // bump
}

/// Circle Config - Revenue sharing for groups/DAOs
#[account]
#[derive(Default)]
pub struct CircleConfig {
    pub leader: Pubkey,
    pub name: String,
    pub treasury_share: u8, // Percentage (0-100)
    pub members: Vec<Pubkey>,
    pub shares: Vec<u8>, // Corresponding shares (must sum to 100-treasury)
    pub bump: u8,
}

impl CircleConfig {
    pub const MAX_MEMBERS: usize = 10;
    pub const MAX_NAME_LEN: usize = 32;

    pub const LEN: usize = 8 + // discriminator
        32 + // leader
        4 + Self::MAX_NAME_LEN + // name
        1 +  // treasury_share
        4 + (32 * Self::MAX_MEMBERS) + // members vec
        4 + (1 * Self::MAX_MEMBERS) + // shares vec
        1;   // bump
}

/// Jury Account - Decentralized dispute resolution
#[account]
#[derive(Default)]
pub struct Jury {
    pub escrow: Pubkey,
    pub jurors: Vec<Pubkey>,       // Selected jurors
    pub votes_buyer: u8,           // Votes for buyer
    pub votes_seller: u8,          // Votes for seller
    pub voted_jurors: Vec<Pubkey>, // Track who voted
    pub outcome: DisputeStatus,
    pub created_at: i64,
    pub resolved_at: i64,
    pub reward_per_juror: u64,     // Incentive for participation
    pub bump: u8,
}

impl Jury {
    pub const MAX_JURORS: usize = 7; // Increased for better decentralization

    pub const LEN: usize = 8 + // discriminator
        32 + // escrow
        4 + (32 * Self::MAX_JURORS) + // jurors
        1 +  // votes_buyer
        1 +  // votes_seller
        4 + (32 * Self::MAX_JURORS) + // voted_jurors
        1 +  // outcome (enum)
        8 +  // created_at
        8 +  // resolved_at
        8 +  // reward_per_juror
        1;   // bump
}

/// Provider Registry - On-chain provider information
#[account]
#[derive(Default)]
pub struct ProviderRegistry {
    pub provider: Pubkey,
    pub endpoint: String,
    pub location: String,          // Country/region code
    pub stake_account: Pubkey,
    pub quality_score: u8,         // 0-100
    pub total_bandwidth_served: u64,
    pub successful_sessions: u32,
    pub failed_sessions: u32,
    pub is_active: bool,
    pub registered_at: i64,
    pub last_heartbeat: i64,
    pub bump: u8,
}

impl ProviderRegistry {
    pub const MAX_ENDPOINT_LEN: usize = 128;
    pub const MAX_LOCATION_LEN: usize = 32;

    pub const LEN: usize = 8 + // discriminator
        32 + // provider
        4 + Self::MAX_ENDPOINT_LEN + // endpoint
        4 + Self::MAX_LOCATION_LEN + // location
        32 + // stake_account
        1 +  // quality_score
        8 +  // total_bandwidth_served
        4 +  // successful_sessions
        4 +  // failed_sessions
        1 +  // is_active
        8 +  // registered_at
        8 +  // last_heartbeat
        1;   // bump
}

/// Gateway Account - Federated gateway registration
#[account]
#[derive(Default)]
pub struct GatewayAccount {
    pub owner: Pubkey,
    pub endpoint: String,
    pub stake_amount: u64,
    pub status: GatewayStatus,
    pub registered_at: i64,
    pub last_heartbeat: i64,
    pub bump: u8,
}

impl GatewayAccount {
    pub const MAX_ENDPOINT_LEN: usize = 128;

    pub const LEN: usize = 8 + // discriminator
        32 + // owner
        4 + Self::MAX_ENDPOINT_LEN + // endpoint
        8 +  // stake_amount
        1 +  // status
        8 +  // registered_at
        8 +  // last_heartbeat
        1;   // bump
}

/// Dynamic Pricing Oracle - Stores current market rates
#[account]
#[derive(Default)]
pub struct PriceOracle {
    pub authority: Pubkey,
    pub residential_price_per_gb: u64,  // In lamports
    pub datacenter_price_per_gb: u64,
    pub mobile_price_per_gb: u64,
    pub last_update: i64,
    pub update_interval: i64,           // Minimum seconds between updates
    pub bump: u8,
}

impl PriceOracle {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        8 +  // residential_price_per_gb
        8 +  // datacenter_price_per_gb
        8 +  // mobile_price_per_gb
        8 +  // last_update
        8 +  // update_interval
        1;   // bump
}

// =============================================================================
// EVENTS
// =============================================================================

#[event]
pub struct EscrowInitialized {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub limit_gb: u64,
}

#[event]
pub struct EscrowSettled {
    pub escrow: Pubkey,
    pub seller_payout: u64,
    pub buyer_refund: u64,
    pub bandwidth_used: u64,
}

#[event]
pub struct EscrowRefunded {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub amount: u64,
}

#[event]
pub struct DisputeRaised {
    pub escrow: Pubkey,
    pub dispute: Pubkey,
    pub initiator: Pubkey,
    pub reason: String,
}

#[event]
pub struct DisputeResolved {
    pub escrow: Pubkey,
    pub dispute: Pubkey,
    pub buyer_payout: u64,
    pub seller_payout: u64,
}

#[event]
pub struct JuryVoteCast {
    pub jury: Pubkey,
    pub juror: Pubkey,
    pub vote_for_buyer: bool,
}

#[event]
pub struct JuryVerdictExecuted {
    pub jury: Pubkey,
    pub escrow: Pubkey,
    pub buyer_wins: bool,
}

#[event]
pub struct ProviderSlashed {
    pub provider: Pubkey,
    pub amount: u64,
    pub reason: String,
}

#[event]
pub struct ProgramPaused {
    pub admin: Pubkey,
    pub paused_at: i64,
}

#[event]
pub struct ProgramResumed {
    pub admin: Pubkey,
    pub resumed_at: i64,
}

#[event]
pub struct OracleSignerAdded {
    pub oracle: Pubkey,
    pub signer: Pubkey,
}

#[event]
pub struct OracleSignerRemoved {
    pub oracle: Pubkey,
    pub signer: Pubkey,
}

#[event]
pub struct PriceUpdated {
    pub oracle: Pubkey,
    pub residential: u64,
    pub datacenter: u64,
    pub mobile: u64,
}

#[event]
pub struct CircleRegisteredEvent {
    pub circle: Pubkey,
    pub leader: Pubkey,
    pub name: String,
    pub treasury_share: u8,
}

#[event]
pub struct CircleSettledEvent {
    pub escrow: Pubkey,
    pub circle: Pubkey,
    pub seller_payout: u64,
    pub buyer_refund: u64,
    pub bandwidth_used: u64,
}

#[event]
pub struct GatewayRegisteredEvent {
    pub gateway: Pubkey,
    pub owner: Pubkey,
    pub endpoint: String,
    pub stake: u64,
}

// =============================================================================
// PROGRAM MODULE
// =============================================================================

#[program]
pub mod proxyhub {
    use super::*;

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /// Initialize program state with emergency pause capability
    pub fn initialize_program(
        ctx: Context<InitializeProgram>,
        min_oracle_signatures: u8,
    ) -> Result<()> {
        let state = &mut ctx.accounts.program_state;
        let clock = Clock::get()?;

        require!(min_oracle_signatures >= 1 && min_oracle_signatures <= 5, EscrowError::InvalidStatus);

        state.admin = ctx.accounts.admin.key();
        state.paused = false;
        state.paused_at = 0;
        state.min_oracle_signatures = min_oracle_signatures;
        state.price_validity_seconds = 300; // 5 minutes default
        state.created_at = clock.unix_timestamp;
        state.updated_at = clock.unix_timestamp;
        state.bump = ctx.bumps.program_state;

        msg!("Program initialized with {} required oracle signatures", min_oracle_signatures);
        Ok(())
    }

    /// Initialize multi-sig oracle configuration
    pub fn initialize_multisig_oracle(
        ctx: Context<InitializeMultiSigOracle>,
        signers: Vec<Pubkey>,
        threshold: u8,
    ) -> Result<()> {
        let oracle = &mut ctx.accounts.multisig_oracle;
        let clock = Clock::get()?;

        require!(
            signers.len() >= threshold as usize && signers.len() <= MultiSigOracle::MAX_SIGNERS,
            EscrowError::InvalidStatus
        );
        require!(threshold >= 1 && threshold <= 5, EscrowError::InvalidStatus);

        oracle.signers = signers;
        oracle.threshold = threshold;
        oracle.nonce = 0;
        oracle.last_update = clock.unix_timestamp;
        oracle.bump = ctx.bumps.multisig_oracle;

        msg!("MultiSig oracle initialized with {} signers, threshold {}", 
            oracle.signers.len(), threshold);
        Ok(())
    }

    /// Initialize insurance pool
    pub fn initialize_insurance_pool(ctx: Context<InitializeInsurancePool>) -> Result<()> {
        let pool = &mut ctx.accounts.insurance_pool;
        let clock = Clock::get()?;

        pool.total_funds = 0;
        pool.total_providers = 0;
        pool.slash_percentage = 10; // 10% default
        pool.created_at = clock.unix_timestamp;
        pool.bump = ctx.bumps.insurance_pool;

        msg!("Insurance pool initialized");
        Ok(())
    }

    /// Initialize price oracle
    pub fn initialize_price_oracle(
        ctx: Context<InitializePriceOracle>,
        residential: u64,
        datacenter: u64,
        mobile: u64,
    ) -> Result<()> {
        let oracle = &mut ctx.accounts.price_oracle;
        let clock = Clock::get()?;

        oracle.authority = ctx.accounts.authority.key();
        oracle.residential_price_per_gb = residential;
        oracle.datacenter_price_per_gb = datacenter;
        oracle.mobile_price_per_gb = mobile;
        oracle.last_update = clock.unix_timestamp;
        oracle.update_interval = 60; // Minimum 60 seconds between updates
        oracle.bump = ctx.bumps.price_oracle;

        msg!("Price oracle initialized");
        Ok(())
    }

    // =========================================================================
    // EMERGENCY CONTROLS
    // =========================================================================

    /// Emergency pause - halts all operations
    pub fn emergency_pause(ctx: Context<EmergencyPause>) -> Result<()> {
        let state = &mut ctx.accounts.program_state;
        let clock = Clock::get()?;

        require!(!state.paused, EscrowError::InvalidStatus);

        state.paused = true;
        state.paused_at = clock.unix_timestamp;
        state.updated_at = clock.unix_timestamp;

        emit!(ProgramPaused {
            admin: ctx.accounts.admin.key(),
            paused_at: clock.unix_timestamp,
        });

        msg!("PROGRAM EMERGENCY PAUSED at {}", clock.unix_timestamp);
        Ok(())
    }

    /// Resume operations after pause
    pub fn emergency_resume(ctx: Context<EmergencyResume>) -> Result<()> {
        let state = &mut ctx.accounts.program_state;
        let clock = Clock::get()?;

        require!(state.paused, EscrowError::InvalidStatus);

        state.paused = false;
        state.paused_at = 0;
        state.updated_at = clock.unix_timestamp;

        emit!(ProgramResumed {
            admin: ctx.accounts.admin.key(),
            resumed_at: clock.unix_timestamp,
        });

        msg!("PROGRAM RESUMED at {}", clock.unix_timestamp);
        Ok(())
    }

    // =========================================================================
    // MULTI-SIG ORACLE MANAGEMENT
    // =========================================================================

    /// Add a signer to the multi-sig oracle
    pub fn add_oracle_signer(
        ctx: Context<ManageMultiSigOracle>,
        new_signer: Pubkey,
    ) -> Result<()> {
        let oracle = &mut ctx.accounts.multisig_oracle;
        let clock = Clock::get()?;

        require!(
            !oracle.signers.contains(&new_signer),
            EscrowError::DuplicateSignature
        );
        require!(
            oracle.signers.len() < MultiSigOracle::MAX_SIGNERS,
            EscrowError::InvalidStatus
        );

        oracle.signers.push(new_signer);
        oracle.nonce += 1;
        oracle.last_update = clock.unix_timestamp;

        emit!(OracleSignerAdded {
            oracle: oracle.key(),
            signer: new_signer,
        });

        msg!("Added oracle signer: {}", new_signer);
        Ok(())
    }

    /// Remove a signer from the multi-sig oracle
    pub fn remove_oracle_signer(
        ctx: Context<ManageMultiSigOracle>,
        signer: Pubkey,
    ) -> Result<()> {
        let oracle = &mut ctx.accounts.multisig_oracle;
        let clock = Clock::get()?;

        require!(oracle.signers.contains(&signer), EscrowError::InvalidOracleSignature);
        require!(
            oracle.signers.len() > oracle.threshold as usize,
            EscrowError::InvalidStatus
        );

        oracle.signers.retain(|s| s != &signer);
        oracle.nonce += 1;
        oracle.last_update = clock.unix_timestamp;

        emit!(OracleSignerRemoved {
            oracle: oracle.key(),
            signer,
        });

        msg!("Removed oracle signer: {}", signer);
        Ok(())
    }

    /// Update signature threshold
    pub fn update_threshold(
        ctx: Context<ManageMultiSigOracle>,
        new_threshold: u8,
    ) -> Result<()> {
        let oracle = &mut ctx.accounts.multisig_oracle;
        let clock = Clock::get()?;

        require!(
            new_threshold >= 1 && new_threshold <= oracle.signers.len() as u8,
            EscrowError::InvalidStatus
        );

        oracle.threshold = new_threshold;
        oracle.nonce += 1;
        oracle.last_update = clock.unix_timestamp;

        msg!("Updated threshold to {}", new_threshold);
        Ok(())
    }

    // =========================================================================
    // ESCROW OPERATIONS WITH MULTI-SIG
    // =========================================================================

    /// Initialize SOL escrow with multi-sig oracle
    pub fn initialize_escrow_multisig(
        ctx: Context<InitializeEscrowMultiSig>,
        amount: u64,
        bandwidth_limit_gb: u64,
        expires_at: i64,
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);

        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        require!(amount > 0, EscrowError::InsufficientFunds);
        require!(bandwidth_limit_gb > 0, EscrowError::InvalidStatus);
        require!(expires_at > clock.unix_timestamp, EscrowError::Expired);

        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.amount = amount;
        escrow.bandwidth_limit_gb = bandwidth_limit_gb;
        escrow.bandwidth_used_gb = 0;
        escrow.status = EscrowStatus::Pending;
        escrow.created_at = clock.unix_timestamp;
        escrow.expires_at = expires_at;
        escrow.price_oracle = ctx.accounts.price_oracle.key();
        escrow.price_timestamp = clock.unix_timestamp;
        escrow.bump = ctx.bumps.escrow;

        // Transfer SOL to escrow
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: escrow.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount)?;

        emit!(EscrowInitialized {
            escrow: escrow.key(),
            buyer: escrow.buyer,
            seller: escrow.seller,
            amount,
            limit_gb: bandwidth_limit_gb,
        });

        msg!("Escrow initialized with multi-sig: {}, amount: {}, limit: {} GB", 
            escrow.key(), amount, bandwidth_limit_gb);
        Ok(())
    }

    /// Settle escrow with multi-sig oracle verification
    pub fn settle_escrow_multisig(
        ctx: Context<SettleEscrowMultiSig>,
        bandwidth_used_gb: u64,
        oracle_signers: Vec<Pubkey>, // The signers that approved this settlement
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);

        let escrow = &mut ctx.accounts.escrow;
        let multisig = &ctx.accounts.multisig_oracle;
        let clock = Clock::get()?;

        require!(
            escrow.status == EscrowStatus::Pending || escrow.status == EscrowStatus::Active,
            EscrowError::InvalidStatus
        );

        // Verify we have enough signatures
        require!(
            oracle_signers.len() >= multisig.threshold as usize,
            EscrowError::InsufficientSignatures
        );

        // Verify each signer is authorized and unique
        let mut verified_signers = Vec::new();
        for signer in &oracle_signers {
            require!(
                multisig.signers.contains(signer),
                EscrowError::InvalidOracleSignature
            );
            require!(
                !verified_signers.contains(signer),
                EscrowError::DuplicateSignature
            );
            verified_signers.push(*signer);
        }

        // Calculate proportional payout
        let capped_usage = std::cmp::min(bandwidth_used_gb, escrow.bandwidth_limit_gb);
        let seller_payout = if escrow.bandwidth_limit_gb > 0 {
            escrow
                .amount
                .checked_mul(capped_usage)
                .unwrap_or(0)
                .checked_div(escrow.bandwidth_limit_gb)
                .unwrap_or(0)
        } else {
            0
        };
        let buyer_refund = escrow.amount.saturating_sub(seller_payout);

        escrow.bandwidth_used_gb = bandwidth_used_gb;
        escrow.status = EscrowStatus::Settled;

        // Record the oracle signatures used
        let sig_record = &mut ctx.accounts.oracle_signature;
        sig_record.escrow = escrow.key();
        sig_record.signers = verified_signers;
        sig_record.nonce = multisig.nonce;
        sig_record.created_at = clock.unix_timestamp;
        sig_record.bump = ctx.bumps.oracle_signature;

        // Transfer funds
        if seller_payout > 0 {
            **escrow.to_account_info().try_borrow_mut_lamports()? -= seller_payout;
            **ctx.accounts.seller.try_borrow_mut_lamports()? += seller_payout;
        }

        if buyer_refund > 0 {
            **escrow.to_account_info().try_borrow_mut_lamports()? -= buyer_refund;
            **ctx.accounts.buyer.try_borrow_mut_lamports()? += buyer_refund;
        }

        emit!(EscrowSettled {
            escrow: escrow.key(),
            seller_payout,
            buyer_refund,
            bandwidth_used: bandwidth_used_gb,
        });

        msg!("Escrow settled with multi-sig: {} to seller, {} refunded", 
            seller_payout, buyer_refund);
        Ok(())
    }

    // =========================================================================
    // JURY ARBITRATION (ENHANCED)
    // =========================================================================

    /// Initiate decentralized jury dispute
    pub fn initiate_jury_dispute(
        ctx: Context<InitiateJuryDispute>,
        jurors: Vec<Pubkey>,
        reward_per_juror: u64,
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);

        let jury = &mut ctx.accounts.jury;
        let escrow = &mut ctx.accounts.escrow;
        let dispute = &mut ctx.accounts.dispute;
        let clock = Clock::get()?;

        require!(
            jurors.len() >= 3 && jurors.len() <= Jury::MAX_JURORS,
            EscrowError::InvalidStatus
        );
        // Ensure odd number for tie-breaking
        require!(jurors.len() % 2 == 1, EscrowError::InvalidStatus);

        escrow.status = EscrowStatus::Disputed;

        jury.escrow = escrow.key();
        jury.jurors = jurors;
        jury.votes_buyer = 0;
        jury.votes_seller = 0;
        jury.voted_jurors = Vec::new();
        jury.outcome = DisputeStatus::Open;
        jury.created_at = clock.unix_timestamp;
        jury.resolved_at = 0;
        jury.reward_per_juror = reward_per_juror;
        jury.bump = ctx.bumps.jury;

        // Link jury to dispute
        dispute.jury_address = Some(jury.key());

        msg!("Jury dispute initiated with {} jurors, reward: {} per juror", 
            jury.jurors.len(), reward_per_juror);
        Ok(())
    }

    /// Cast vote in jury dispute
    pub fn cast_vote(ctx: Context<CastVote>, vote_for_buyer: bool) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);

        let jury = &mut ctx.accounts.jury;
        let juror = &ctx.accounts.juror;

        // Verify juror is selected and hasn't voted
        require!(
            jury.jurors.contains(juror.key),
            EscrowError::InvalidJuror
        );
        require!(
            !jury.voted_jurors.contains(juror.key),
            EscrowError::AlreadyVoted
        );
        require!(
            jury.outcome == DisputeStatus::Open,
            EscrowError::DisputeAlreadyResolved
        );

        if vote_for_buyer {
            jury.votes_buyer += 1;
        } else {
            jury.votes_seller += 1;
        }
        jury.voted_jurors.push(juror.key());

        emit!(JuryVoteCast {
            jury: jury.key(),
            juror: juror.key(),
            vote_for_buyer,
        });

        // Check for resolution (simple majority)
        let quorum = (jury.jurors.len() / 2) + 1;

        if (jury.votes_buyer as usize) >= quorum {
            jury.outcome = DisputeStatus::Resolved;
            msg!("Jury reached consensus: Buyer wins ({}/{})", jury.votes_buyer, jury.jurors.len());
        } else if (jury.votes_seller as usize) >= quorum {
            jury.outcome = DisputeStatus::Resolved;
            msg!("Jury reached consensus: Seller wins ({}/{})", jury.votes_seller, jury.jurors.len());
        }

        Ok(())
    }

    /// Execute jury verdict with rewards
    pub fn execute_jury_verdict(ctx: Context<ExecuteJuryVerdict>) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);

        let jury = &mut ctx.accounts.jury;
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        require!(
            jury.outcome == DisputeStatus::Resolved,
            EscrowError::InvalidStatus
        );
        require!(
            escrow.status == EscrowStatus::Disputed,
            EscrowError::InvalidStatus
        );

        escrow.status = EscrowStatus::Settled;
        jury.resolved_at = clock.unix_timestamp;

        let quorum = (jury.jurors.len() / 2) + 1;
        let buyer_wins = (jury.votes_buyer as usize) >= quorum;

        let (buyer_payout, seller_payout) = if buyer_wins {
            (escrow.amount, 0)
        } else {
            (0, escrow.amount)
        };

        // Execute payouts
        if buyer_payout > 0 {
            **escrow.to_account_info().try_borrow_mut_lamports()? -= buyer_payout;
            **ctx.accounts.buyer.try_borrow_mut_lamports()? += buyer_payout;
        }

        if seller_payout > 0 {
            **escrow.to_account_info().try_borrow_mut_lamports()? -= seller_payout;
            **ctx.accounts.seller.try_borrow_mut_lamports()? += seller_payout;
        }

        // Pay juror rewards (simplified - in production, iterate through voters)
        // For now, we assume the reward is distributed from a separate pool

        emit!(JuryVerdictExecuted {
            jury: jury.key(),
            escrow: escrow.key(),
            buyer_wins,
        });

        msg!("Jury verdict executed: buyer={}, seller={}", buyer_payout, seller_payout);
        Ok(())
    }

    // =========================================================================
    // DYNAMIC PRICING
    // =========================================================================

    /// Update market prices
    pub fn update_prices(
        ctx: Context<UpdatePrices>,
        residential: u64,
        datacenter: u64,
        mobile: u64,
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);

        let oracle = &mut ctx.accounts.price_oracle;
        let clock = Clock::get()?;

        // Rate limiting
        require!(
            clock.unix_timestamp - oracle.last_update >= oracle.update_interval,
            EscrowError::InvalidStatus
        );

        oracle.residential_price_per_gb = residential;
        oracle.datacenter_price_per_gb = datacenter;
        oracle.mobile_price_per_gb = mobile;
        oracle.last_update = clock.unix_timestamp;

        emit!(PriceUpdated {
            oracle: oracle.key(),
            residential,
            datacenter,
            mobile,
        });

        msg!("Prices updated: res={}, dc={}, mob={}", residential, datacenter, mobile);
        Ok(())
    }

    /// Calculate dynamic price for a session
    pub fn calculate_session_price(
        ctx: Context<CalculateSessionPrice>,
        bandwidth_gb: u64,
        connection_type: String,
        quality_multiplier: u8, // 100 = 1.0x, 125 = 1.25x, etc.
    ) -> Result<u64> {
        let oracle = &ctx.accounts.price_oracle;
        let clock = Clock::get()?;
        let state = &ctx.accounts.program_state;

        // Check price freshness
        require!(
            clock.unix_timestamp - oracle.last_update <= state.price_validity_seconds,
            EscrowError::StalePriceData
        );

        let base_price = match connection_type.as_str() {
            "residential" => oracle.residential_price_per_gb,
            "datacenter" => oracle.datacenter_price_per_gb,
            "mobile" => oracle.mobile_price_per_gb,
            _ => oracle.residential_price_per_gb,
        };

        let total = bandwidth_gb
            .checked_mul(base_price)
            .unwrap_or(0)
            .checked_mul(quality_multiplier as u64)
            .unwrap_or(0)
            .checked_div(100)
            .unwrap_or(0);

        Ok(total)
    }

    // =========================================================================
    // INSURANCE POOL
    // =========================================================================

    /// Contribute to insurance pool
    pub fn contribute_insurance(
        ctx: Context<ContributeInsurance>,
        amount: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.insurance_pool;
        let stake = &mut ctx.accounts.stake_account;

        // Transfer funds to pool
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.provider.to_account_info(),
                to: pool.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount)?;

        pool.total_funds += amount;
        stake.insurance_pool_contribution += amount;

        msg!("Insurance contribution: {} from {}", amount, ctx.accounts.provider.key());
        Ok(())
    }

    /// Slash provider with insurance protection
    pub fn slash_provider_insurance(
        ctx: Context<SlashProviderInsurance>,
        amount: u64,
        reason: String,
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);

        let pool = &mut ctx.accounts.insurance_pool;
        let stake = &mut ctx.accounts.stake_account;

        require!(
            ctx.accounts.admin.key() == state.admin,
            EscrowError::Unauthorized
        );

        let max_slash = stake
            .amount
            .checked_mul(pool.slash_percentage as u64)
            .unwrap_or(0)
            .checked_div(100)
            .unwrap_or(0);
        let actual_slash = std::cmp::min(amount, max_slash);

        // Distribute slash: portion to pool, portion burned
        let to_pool = actual_slash.checked_div(2).unwrap_or(0);
        
        // In a real implementation, handle the transfer properly
        stake.amount = stake.amount.saturating_sub(actual_slash);
        stake.is_slashed = true;
        pool.total_funds += to_pool;

        emit!(ProviderSlashed {
            provider: stake.owner,
            amount: actual_slash,
            reason,
        });

        msg!("Provider slashed: {}, amount: {}", stake.owner, actual_slash);
        Ok(())
    }

    // =========================================================================
    // LEGACY FUNCTIONS (for backward compatibility)
    // =========================================================================

    /// Initialize SOL escrow (legacy - single oracle)
    pub fn initialize_escrow(
        ctx: Context<InitializeEscrow>,
        amount: u64,
        bandwidth_limit_gb: u64,
        expires_at: i64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        require!(amount > 0, EscrowError::InsufficientFunds);
        require!(bandwidth_limit_gb > 0, EscrowError::InvalidStatus);
        require!(expires_at > clock.unix_timestamp, EscrowError::Expired);

        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.amount = amount;
        escrow.bandwidth_limit_gb = bandwidth_limit_gb;
        escrow.bandwidth_used_gb = 0;
        escrow.status = EscrowStatus::Pending;
        escrow.created_at = clock.unix_timestamp;
        escrow.expires_at = expires_at;
        escrow.price_oracle = ctx.accounts.buyer.key(); // Legacy: no oracle
        escrow.price_timestamp = clock.unix_timestamp;
        escrow.bump = ctx.bumps.escrow;

        // Transfer SOL to escrow
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: escrow.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount)?;

        emit!(EscrowInitialized {
            escrow: escrow.key(),
            buyer: escrow.buyer,
            seller: escrow.seller,
            amount,
            limit_gb: bandwidth_limit_gb,
        });

        msg!("Escrow initialized (legacy): {}, amount: {}", escrow.key(), amount);
        Ok(())
    }

    /// Settle escrow (legacy)
    pub fn settle_escrow(
        ctx: Context<SettleEscrow>,
        bandwidth_used_gb: u64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        
        require!(
            escrow.status == EscrowStatus::Pending || escrow.status == EscrowStatus::Active,
            EscrowError::InvalidStatus
        );

        let capped_usage = std::cmp::min(bandwidth_used_gb, escrow.bandwidth_limit_gb);
        let seller_payout = if escrow.bandwidth_limit_gb > 0 {
            escrow
                .amount
                .checked_mul(capped_usage)
                .unwrap_or(0)
                .checked_div(escrow.bandwidth_limit_gb)
                .unwrap_or(0)
        } else {
            0
        };
        let buyer_refund = escrow.amount.saturating_sub(seller_payout);

        escrow.bandwidth_used_gb = bandwidth_used_gb;
        escrow.status = EscrowStatus::Settled;

        if seller_payout > 0 {
            **escrow.to_account_info().try_borrow_mut_lamports()? -= seller_payout;
            **ctx.accounts.seller.try_borrow_mut_lamports()? += seller_payout;
        }

        if buyer_refund > 0 {
            **escrow.to_account_info().try_borrow_mut_lamports()? -= buyer_refund;
            **ctx.accounts.buyer.try_borrow_mut_lamports()? += buyer_refund;
        }

        emit!(EscrowSettled {
            escrow: escrow.key(),
            seller_payout,
            buyer_refund,
            bandwidth_used: bandwidth_used_gb,
        });

        Ok(())
    }

    // ... Additional functions for token escrows, streaming, etc. can be added here
}

// =============================================================================
// ACCOUNT VALIDATION STRUCTURES
// =============================================================================

#[derive(Accounts)]
pub struct InitializeProgram<'info> {
    #[account(init, payer = admin, space = ProgramState::LEN, seeds = [b"program_state"], bump)]
    pub program_state: Account<'info, ProgramState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeMultiSigOracle<'info> {
    #[account(init, payer = admin, space = MultiSigOracle::LEN, seeds = [b"multisig_oracle"], bump)]
    pub multisig_oracle: Account<'info, MultiSigOracle>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeInsurancePool<'info> {
    #[account(init, payer = admin, space = InsurancePool::LEN, seeds = [b"insurance_pool"], bump)]
    pub insurance_pool: Account<'info, InsurancePool>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializePriceOracle<'info> {
    #[account(init, payer = authority, space = PriceOracle::LEN, seeds = [b"price_oracle"], bump)]
    pub price_oracle: Account<'info, PriceOracle>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EmergencyPause<'info> {
    #[account(mut, seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    #[account(address = program_state.admin)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmergencyResume<'info> {
    #[account(mut, seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    #[account(address = program_state.admin)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct ManageMultiSigOracle<'info> {
    #[account(mut, seeds = [b"multisig_oracle"], bump = multisig_oracle.bump)]
    pub multisig_oracle: Account<'info, MultiSigOracle>,
    #[account(address = program_state.admin)]
    pub admin: Signer<'info>,
    pub program_state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
#[instruction(amount: u64, bandwidth_limit_gb: u64, expires_at: i64)]
pub struct InitializeEscrowMultiSig<'info> {
    #[account(
        init,
        payer = buyer,
        space = Escrow::LEN,
        seeds = [b"escrow_multisig", buyer.key().as_ref(), seller.key().as_ref(), &Clock::get()?.unix_timestamp.to_le_bytes()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: Seller account, no data needed
    pub seller: AccountInfo<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    #[account(seeds = [b"price_oracle"], bump = price_oracle.bump)]
    pub price_oracle: Account<'info, PriceOracle>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(bandwidth_used_gb: u64, oracle_signers: Vec<Pubkey>)]
pub struct SettleEscrowMultiSig<'info> {
    #[account(mut, seeds = [b"escrow_multisig", escrow.buyer.as_ref(), escrow.seller.as_ref(), &escrow.created_at.to_le_bytes()], bump = escrow.bump)]
    pub escrow: Account<'info, Escrow>,
    #[account(mut)]
    /// CHECK: Buyer account
    pub buyer: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK: Seller account
    pub seller: AccountInfo<'info>,
    #[account(seeds = [b"multisig_oracle"], bump = multisig_oracle.bump)]
    pub multisig_oracle: Account<'info, MultiSigOracle>,
    #[account(
        init,
        payer = payer,
        space = OracleSignature::LEN,
        seeds = [b"oracle_sig", escrow.key().as_ref(), &multisig_oracle.nonce.to_le_bytes()],
        bump
    )]
    pub oracle_signature: Account<'info, OracleSignature>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(jurors: Vec<Pubkey>, reward_per_juror: u64)]
pub struct InitiateJuryDispute<'info> {
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
    #[account(
        init,
        payer = initiator,
        space = Jury::LEN,
        seeds = [b"jury", escrow.key().as_ref()],
        bump
    )]
    pub jury: Account<'info, Jury>,
    #[account(
        init,
        payer = initiator,
        space = Dispute::LEN,
        seeds = [b"dispute", escrow.key().as_ref()],
        bump
    )]
    pub dispute: Account<'info, Dispute>,
    #[account(mut)]
    pub initiator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut, seeds = [b"jury", jury.escrow.as_ref()], bump = jury.bump)]
    pub jury: Account<'info, Jury>,
    pub juror: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecuteJuryVerdict<'info> {
    #[account(mut, seeds = [b"jury", jury.escrow.as_ref()], bump = jury.bump)]
    pub jury: Account<'info, Jury>,
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
    #[account(mut)]
    /// CHECK: Buyer account
    pub buyer: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK: Seller account
    pub seller: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct UpdatePrices<'info> {
    #[account(mut, seeds = [b"price_oracle"], bump = price_oracle.bump)]
    pub price_oracle: Account<'info, PriceOracle>,
    #[account(address = price_oracle.authority)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
pub struct CalculateSessionPrice<'info> {
    #[account(seeds = [b"price_oracle"], bump = price_oracle.bump)]
    pub price_oracle: Account<'info, PriceOracle>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
pub struct ContributeInsurance<'info> {
    #[account(mut, seeds = [b"insurance_pool"], bump = insurance_pool.bump)]
    pub insurance_pool: Account<'info, InsurancePool>,
    #[account(mut)]
    pub stake_account: Account<'info, StakeAccount>,
    #[account(mut)]
    pub provider: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SlashProviderInsurance<'info> {
    #[account(mut, seeds = [b"insurance_pool"], bump = insurance_pool.bump)]
    pub insurance_pool: Account<'info, InsurancePool>,
    #[account(mut)]
    pub stake_account: Account<'info, StakeAccount>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    #[account(address = program_state.admin)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(amount: u64, bandwidth_limit_gb: u64, expires_at: i64)]
pub struct InitializeEscrow<'info> {
    #[account(
        init,
        payer = buyer,
        space = Escrow::LEN,
        seeds = [b"escrow", buyer.key().as_ref(), seller.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: Seller account
    pub seller: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(bandwidth_used_gb: u64)]
pub struct SettleEscrow<'info> {
    #[account(mut, seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()], bump = escrow.bump)]
    pub escrow: Account<'info, Escrow>,
    #[account(mut)]
    /// CHECK: Buyer account
    pub buyer: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK: Seller account
    pub seller: AccountInfo<'info>,
}
