use anchor_lang::prelude::*;
use anchor_lang::system_program;

#[cfg(feature = "onchain-groth16")]
mod groth16_batch;
#[cfg(feature = "onchain-groth16")]
mod groth16_vk_generated;

declare_id!("AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu");

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
    #[msg("Missing signature verification instruction")]
    MissingSignatureVerification,
    #[msg("Invalid signature verification data")]
    InvalidSignatureVerification,
    #[msg("Proposal not passed")]
    ProposalNotPassed,
    #[msg("Timelock has not expired yet")]
    TimelockNotExpired,
    #[msg("Invalid proposal payload or hash mismatch")]
    InvalidProposalPayload,
    #[msg("Signer not found in the oracle signer list")]
    SignerNotFound,
    #[msg("Staking lockup period is active")]
    LockupPeriodActive,
    #[msg("Withdraw destination must equal vault hot treasury")]
    InvalidVaultDestination,
    #[msg("Deposit vault hot treasury cannot be default pubkey")]
    InvalidHotTreasury,
    /// Program built without Cargo feature `onchain-groth16`.
    #[msg("On-chain Groth16 batch submit is disabled (build without onchain-groth16)")]
    OnchainGroth16Disabled,
    /// Reserved: legacy fail-closed stub (BC-11-B now verifies when feature is on).
    #[msg("Groth16 on-chain verifier not ready — refusing to write ZKBatchPDA")]
    Groth16VerifierNotReady,
    #[msg("Groth16 proof verification failed")]
    Groth16VerificationFailed,
    #[msg("Groth16 verifying-key hash mismatch")]
    Groth16VkHashMismatch,
    #[msg("Groth16 proof account must be 256 bytes (A||B||C)")]
    Groth16InvalidProofAccount,
    // Keep new variants at the end: Anchor error codes are positional, so inserting
    // earlier would renumber every later code and break clients matching on them.
    #[msg("Arithmetic overflow or division by zero in payout calculation")]
    CalculationOverflow,
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
    pub pending_admin: Pubkey,         // D-S1: nominated successor (zero if none)
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
        32 + // pending_admin (D-S1)
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

/// Platform deposit vault — holds inbound user SOL outside the hot EOA.
/// Users transfer SOL natively to this PDA; admin/oracle withdraws only to hot_treasury.
/// PDA seeds: ["deposit_vault"]
#[account]
#[derive(Default)]
pub struct DepositVault {
    pub authority: Pubkey,            // Admin that may withdraw / update hot
    pub withdraw_authority: Pubkey,   // Oracle (or ops) key also allowed to withdraw
    pub hot_treasury: Pubkey,         // Sole allowed withdraw destination
    pub total_deposited: u64,         // Accounting hint (native deposits may exceed tracked)
    pub total_withdrawn: u64,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

impl DepositVault {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        32 + // withdraw_authority
        32 + // hot_treasury
        8 +  // total_deposited
        8 +  // total_withdrawn
        8 +  // created_at
        8 +  // updated_at
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

/// GatewayRegistry — On-chain registration, staking, and health for edge gateways.
///
/// PDA seeds: ["gateway-registry", gateway_pubkey.as_ref()]
#[account]
#[derive(Default)]
pub struct GatewayRegistry {
    pub gateway: Pubkey,
    pub owner: Pubkey,
    pub endpoint: String,
    pub stake_amount: u64,
    pub min_stake_lamports: u64,
    pub quality_score: u8,
    pub active_tunnels: u32,
    pub is_active: bool,
    pub registered_at: i64,
    pub last_heartbeat: i64,
    pub bump: u8,
}

impl GatewayRegistry {
    pub const MAX_ENDPOINT_LEN: usize = 128;

    pub const LEN: usize = 8 + // discriminator
        32 + // gateway
        32 + // owner
        4 + Self::MAX_ENDPOINT_LEN + // endpoint
        8 +  // stake_amount
        8 +  // min_stake_lamports
        1 +  // quality_score
        4 +  // active_tunnels
        1 +  // is_active
        8 +  // registered_at
        8 +  // last_heartbeat
        1;   // bump
}

/// EpochRewardPool — On-chain bandwidth mining emission pool (Track 4.1).
///
/// PDA seeds: ["epoch-rewards", epoch_id.to_le_bytes()]
#[account]
#[derive(Default)]
pub struct EpochRewardPool {
    pub epoch_id: u64,
    pub total_emission_lamports: u64,
    pub remaining_emission_lamports: u64,
    pub total_bandwidth_verified: u64,
    pub settled_providers_count: u32,
    pub is_finalized: bool,
    pub start_timestamp: i64,
    pub end_timestamp: i64,
    pub bump: u8,
}

/// One claim per provider per epoch. Created by `claim_bandwidth_rewards`; because it is an
/// `init` account, a second claim for the same epoch and provider fails.
/// PDA seeds: ["epoch_claim", epoch_id.to_le_bytes(), provider_wallet]
#[account]
#[derive(Default)]
pub struct EpochClaimReceipt {
    pub epoch_id: u64,
    pub provider: Pubkey,
    pub bytes_verified: u64,
    pub reward_lamports: u64,
    pub claimed_at: i64,
    pub bump: u8,
}

impl EpochClaimReceipt {
    pub const LEN: usize = 8 + // discriminator
        8 +  // epoch_id
        32 + // provider
        8 +  // bytes_verified
        8 +  // reward_lamports
        8 +  // claimed_at
        1;   // bump
}

impl EpochRewardPool {
    pub const LEN: usize = 8 + // discriminator
        8 + // epoch_id
        8 + // total_emission_lamports
        8 + // remaining_emission_lamports
        8 + // total_bandwidth_verified
        4 + // settled_providers_count
        1 + // is_finalized
        8 + // start_timestamp
        8 + // end_timestamp
        1;  // bump
}

/// ListingCommitment — on-chain anchor of an off-chain Ed25519 listing offer hash.
///
/// PDA seeds: ["listing-commitment", provider_pubkey, offer_hash]
///
/// This is **not** a full on-chain catalog. Merchandising (title/media/search)
/// remains Postgres. The PDA only proves the offer hash was registered on-chain.
#[account]
#[derive(Default)]
pub struct ListingCommitment {
    pub provider: Pubkey,
    pub offer_hash: [u8; 32],
    pub listing_id: [u8; 16],
    pub is_active: bool,
    pub registered_at: i64,
    pub bump: u8,
}

impl ListingCommitment {
    pub const LEN: usize = 8 + // discriminator
        32 + // provider
        32 + // offer_hash
        16 + // listing_id
        1 +  // is_active
        8 +  // registered_at
        1;   // bump
}

/// UsageProofRecord - Immutable on-chain record of a bandwidth usage period.
///
/// PDA seeds: ["usage_proof", escrow_pda, proof_index (u32 LE)]
///
/// A new record is created for each batched usage window.  Records are
/// append-only — once created they are never modified.  The escrow settlement
/// instruction (`settle_escrow_multisig`) reads the sum of all records for an
/// escrow to determine the final proportional payout.
#[account]
#[derive(Default)]
pub struct UsageProofRecord {
    pub escrow: Pubkey,       // Which escrow this window belongs to
    pub oracle: Pubkey,       // Oracle that submitted (audit trail)
    pub proof_index: u32,     // Sequential index within the escrow (0, 1, 2, …)
    pub total_bytes: u64,     // Bytes transferred during this period
    pub period_start: i64,    // Unix timestamp — period start
    pub period_end: i64,      // Unix timestamp — period end
    pub submitted_at: i64,    // Wall-clock when the oracle anchored this record
    pub bump: u8,
}

impl UsageProofRecord {
    pub const LEN: usize = 8 + // discriminator
        32 + // escrow
        32 + // oracle
        4 +  // proof_index
        8 +  // total_bytes
        8 +  // period_start
        8 +  // period_end
        8 +  // submitted_at
        1;   // bump

// =============================================================================
// KYC ATTESTATION ACCOUNT
// =============================================================================
// Trust-tier and KYC status for a user wallet, written on-chain by the oracle.
// This makes trust elevation verifiable without trusting the server DB.
//
// Trust tiers (trust_tier field):
//   0 = new        — default
//   1 = verified   — KYC approved + minimum SOL balance confirmed
//   2 = premium    — elevated by admin or governance
//
// KYC status (kyc_status field):
//   0 = none       — not yet submitted
//   1 = pending    — under review
//   2 = approved   — cleared
//   3 = rejected   — denied
//
// PDA seeds: ["kyc_attestation", wallet_pubkey]
}

#[account]
#[derive(Default)]
pub struct KYCAttestation {
    pub wallet: Pubkey,       // The user's Solana wallet being attested
    pub oracle: Pubkey,       // Oracle that wrote this attestation
    pub trust_tier: u8,       // 0=new, 1=verified, 2=premium
    pub kyc_status: u8,       // 0=none, 1=pending, 2=approved, 3=rejected
    pub attested_at: i64,     // Unix timestamp when last written
    pub bump: u8,
}

impl KYCAttestation {
    pub const LEN: usize = 8 + // discriminator
        32 + // wallet
        32 + // oracle
        1 +  // trust_tier
        1 +  // kyc_status
        8 +  // attested_at
        1;   // bump
}

// =============================================================================
// SESSION COMMITMENT ACCOUNT (METER-002)
// =============================================================================
// Locked on-chain when a session is created; serves as the authoritative record
// of session parameters. Edge gateway verifies its bandwidth_limit_bytes against
// this PDA — prevents server-side tampering of session limits.
//
// PDA seeds: ["session_commitment", session_id (16 bytes UUID)]
#[account]
#[derive(Default)]
pub struct SessionCommitment {
    pub session_id:            [u8; 16],  // UUID bytes (little-endian)
    pub buyer_wallet:          Pubkey,    // User's linked Solana wallet
    pub seller_wallet:         Pubkey,    // Provider's wallet
    pub bandwidth_limit_bytes: u64,       // Authoritative bandwidth cap
    pub price_per_gb_lamports: u64,       // Locked-in price at session start
    pub locked_at:             i64,       // Unix timestamp
    pub bump:                  u8,
}

impl SessionCommitment {
    pub const LEN: usize = 8 +  // discriminator
        16 + // session_id
        32 + // buyer_wallet
        32 + // seller_wallet
        8 +  // bandwidth_limit_bytes
        8 +  // price_per_gb_lamports
        8 +  // locked_at
        1;   // bump (total = 113)
}

/// Funded prepaid session escrow (Phase 1b).
/// Holds locked SOL for PAYG/gateway sessions; oracle settles pro-rata by bytes used.
/// PDA seeds: ["session_escrow", session_id (16 bytes UUID)]
#[account]
#[derive(Default)]
pub struct SessionEscrow {
    pub session_id:            [u8; 16],
    pub buyer:                 Pubkey,
    pub seller:                Pubkey,
    pub amount:                u64,  // locked lamports
    pub bandwidth_limit_bytes: u64,
    pub bytes_used:            u64,  // written at settle
    pub price_per_gb_lamports: u64,
    pub status:                EscrowStatus,
    pub created_at:            i64,
    pub expires_at:            i64,
    pub bump:                  u8,
}

impl SessionEscrow {
    pub const LEN: usize = 8 + // discriminator
        16 + // session_id
        32 + // buyer
        32 + // seller
        8 +  // amount
        8 +  // bandwidth_limit_bytes
        8 +  // bytes_used
        8 +  // price_per_gb_lamports
        1 +  // status
        8 +  // created_at
        8 +  // expires_at
        1;   // bump
}

/// Integer pro-rata split for session escrow (no f64).
/// Returns `(seller_payout, buyer_refund)`.
pub fn compute_session_escrow_payout(escrow_amount: u64, bytes_used: u64, bytes_limit: u64) -> (u64, u64) {
    let billed_bytes = std::cmp::min(bytes_used, bytes_limit);
    let seller_payout = if bytes_limit > 0 {
        (escrow_amount as u128)
            .saturating_mul(billed_bytes as u128)
            .checked_div(bytes_limit as u128)
            .unwrap_or(0) as u64
    } else {
        0
    };
    let buyer_refund = escrow_amount.saturating_sub(seller_payout);
    (seller_payout, buyer_refund)
}

/// The caller plus every key in `signers` that belongs to `oracle_set`, each counted once.
/// Callers must pass only keys that actually signed the transaction.
pub fn distinct_oracle_signers(
    caller: Pubkey,
    signers: impl IntoIterator<Item = Pubkey>,
    oracle_set: &[Pubkey],
) -> Vec<Pubkey> {
    let mut out = vec![caller];
    for key in signers {
        if oracle_set.contains(&key) && !out.contains(&key) {
            out.push(key);
        }
    }
    out
}

/// Pro-rata seller payout: `floor(amount * min(used, limit) / limit)`.
///
/// The product is taken in `u128`, so it cannot overflow for any `u64` inputs, and the
/// result is never larger than `amount`. The settle instructions used to multiply in `u64`
/// and fall back to `unwrap_or(0)` on overflow, which silently paid the seller nothing and
/// refunded the whole escrow to the buyer once `amount * usage` passed `u64::MAX`
/// (for example 1 SOL against 20 GiB counted in bytes). A zero limit pays nothing.
/// Arithmetic that cannot be represented is an error, never a quiet zero.
pub fn prorated_payout(amount: u64, used: u64, limit: u64) -> Result<u64> {
    if limit == 0 {
        return Ok(0);
    }
    let used = std::cmp::min(used, limit);
    let payout = (amount as u128)
        .checked_mul(used as u128)
        .ok_or(error!(EscrowError::CalculationOverflow))?
        .checked_div(limit as u128)
        .ok_or(error!(EscrowError::CalculationOverflow))?;
    u64::try_from(payout).map_err(|_| error!(EscrowError::CalculationOverflow))
}

// =============================================================================
// GOVERNANCE PDAs (GOV-001/002/003)
// =============================================================================
// Proposals and votes are committed on-chain so tallies cannot be manipulated.
// Proposals are created by the oracle on behalf of a user; votes are signed
// directly by the voter's wallet (voter: Signer) so the server cannot forge them.
//
// GovernanceProposal PDA seeds: ["gov_proposal", proposal_id (16 bytes)]
// GovernanceVote     PDA seeds: ["gov_vote", proposal_pda (32 bytes), voter_wallet (32 bytes)]
#[account]
#[derive(Default)]
pub struct GovernanceProposal {
    pub proposal_id: [u8; 16],   // UUID bytes
    pub proposer:    Pubkey,     // User's wallet who created it
    pub title_hash:  [u8; 32],   // SHA-256 of title+description
    pub vote_yes:    u64,        // Cumulative yes voting power (lamports)
    pub vote_no:     u64,        // Cumulative no voting power (lamports)
    pub status:      u8,         // 0=active, 1=passed, 2=rejected, 3=executed
    pub end_slot:    u64,        // Voting closes at this Solana slot
    pub created_at:  i64,
    pub bump:        u8,
}

impl GovernanceProposal {
    pub const LEN: usize = 8 +  // discriminator
        16 + // proposal_id
        32 + // proposer
        32 + // title_hash
        8 +  // vote_yes
        8 +  // vote_no
        1 +  // status
        8 +  // end_slot
        8 +  // created_at
        1;   // bump (total = 122)
}

#[account]
#[derive(Default)]
pub struct GovernanceVote {
    pub proposal:     Pubkey,   // GovernanceProposal PDA
    pub voter:        Pubkey,   // Voter's wallet
    pub vote_yes:     bool,
    pub voting_power: u64,      // Fixed at 1 on-chain until stake/token CPI exists
    pub voted_at:     i64,
    pub bump:         u8,
}

impl GovernanceVote {
    pub const LEN: usize = 8 +  // discriminator
        32 + // proposal
        32 + // voter
        1 +  // vote_yes
        8 +  // voting_power
        8 +  // voted_at
        1;   // bump (total = 90)
}

// =============================================================================
// DISPUTE / JURY PDAs (DISP-001/002/003/004)
// =============================================================================
// JuryVotePDA is an immutable per-juror on-chain vote record.
// The dispute itself is opened with a slot-hash-based VRF seed so jury
// selection cannot be controlled by the server.
//
// JuryVotePDA seeds: ["jury_vote", dispute_pda (32 bytes), juror_wallet (32 bytes)]
#[account]
#[derive(Default)]
pub struct JuryVotePDA {
    pub dispute:    Pubkey,  // DisputeJury PDA on-chain
    pub juror:      Pubkey,  // Juror's wallet
    pub vote_buyer: bool,    // true = vote for buyer (refund), false = vote for seller (pay)
    pub voted_at:   i64,
    pub bump:       u8,
}

impl JuryVotePDA {
    pub const LEN: usize = 8 +  // discriminator
        32 + // dispute
        32 + // juror
        1 +  // vote_buyer
        8 +  // voted_at
        1;   // bump (total = 82)
}

// =============================================================================
// ADMIN ATTESTATION (AUTH-001/007)
// =============================================================================
// On-chain record of a wallet holding admin privileges.
// Written by the program admin (program_state.admin) — cannot be self-signed.
// Sensitive admin endpoints verify this PDA exists before executing.
//
// PDA seeds: ["admin_attestation", admin_wallet (32 bytes)]
#[account]
#[derive(Default)]
pub struct AdminAttestation {
    pub admin_wallet: Pubkey,
    pub oracle:       Pubkey,
    pub role:         u8,     // 0=moderator, 1=admin, 2=super_admin
    pub attested_at:  i64,
    pub bump:         u8,
}

impl AdminAttestation {
    pub const LEN: usize = 8 +  // discriminator
        32 + // admin_wallet
        32 + // oracle
        1 +  // role
        8 +  // attested_at
        1;   // bump (total = 82)
}

// =============================================================================
// PROGRAM CONFIG (CONFIG-001/002)
// =============================================================================
// Security-critical parameters stored on-chain.  Only updatable via multisig.
// Go handlers read this PDA instead of the system_configurations table for
// KYC min balance, platform fee, and spending limits.
//
// PDA seeds: ["program_config"]
#[account]
#[derive(Default)]
pub struct ProgramConfig {
    pub kyc_min_sol_lamports:      u64,  // Minimum SOL balance for KYC approval
    pub platform_fee_bps:          u16,  // Platform fee in basis points (100 = 1%)
    pub max_daily_spend_lamports:  u64,  // Daily spending cap (0 = no cap)
    pub max_session_bw_bytes:      u64,  // Maximum session bandwidth per tier=new
    pub unstake_cooldown_seconds:  i64,  // Staking cooldown period in seconds
    pub updated_at:                i64,
    pub bump:                      u8,
}

impl ProgramConfig {
    pub const LEN: usize = 8 +  // discriminator
        8 +  // kyc_min_sol_lamports
        2 +  // platform_fee_bps
        8 +  // max_daily_spend_lamports
        8 +  // max_session_bw_bytes
        8 +  // unstake_cooldown_seconds
        8 +  // updated_at
        1;   // bump (total = 51)
}

// =============================================================================
// REVIEW ATTESTATION (REP-001)
// =============================================================================
// Immutable on-chain record that a verified buyer reviewed a specific order.
// Prevents review deletion or manipulation after submission.
//
// PDA seeds: ["review", order_escrow_pda (32 bytes), reviewer_wallet (32 bytes)]
#[account]
#[derive(Default)]
pub struct ReviewAttestation {
    pub order_escrow_pda: Pubkey,
    pub reviewer:         Pubkey,
    pub rating_hash:      [u8; 32],  // SHA-256(rating || comment || review_id)
    pub attested_at:      i64,
    pub bump:             u8,
}

impl ReviewAttestation {
    pub const LEN: usize = 8 +  // discriminator
        32 + // order_escrow_pda
        32 + // reviewer
        32 + // rating_hash
        8 +  // attested_at
        1;   // bump (total = 113)
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
pub struct EscrowClosed {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
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
pub struct ProviderStaked {
    pub provider: Pubkey,
    pub amount: u64,
    pub total_stake: u64,
}

#[event]
pub struct ProviderUnstaked {
    pub provider: Pubkey,
    pub amount: u64,
    pub remaining_stake: u64,
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

#[event]
pub struct GatewayHeartbeatEvent {
    pub gateway: Pubkey,
    pub active_tunnels: u32,
    pub quality_score: u8,
    pub last_heartbeat: i64,
}

#[event]
pub struct GatewaySlashedEvent {
    pub gateway: Pubkey,
    pub slashed_amount: u64,
    pub remaining_stake: u64,
    pub reason_hash: [u8; 32],
}

#[event]
pub struct GatewayDeregisteredEvent {
    pub gateway: Pubkey,
    pub owner: Pubkey,
    pub stake_returned: u64,
}

#[event]
pub struct BandwidthRewardClaimedEvent {
    pub epoch_id: u64,
    pub provider: Pubkey,
    pub bytes_verified: u64,
    pub reward_lamports: u64,
}

#[event]
pub struct UsageProofSubmitted {
    pub escrow: Pubkey,
    pub proof_record: Pubkey,
    pub proof_index: u32,
    pub total_bytes: u64,
    pub period_start: i64,
    pub period_end: i64,
}

#[event]
pub struct ProviderRegisteredEvent {
    pub registry: Pubkey,
    pub provider: Pubkey,
    pub endpoint: String,
    pub location: String,
}

#[event]
pub struct ProviderHeartbeatEvent {
    pub registry: Pubkey,
    pub provider: Pubkey,
    pub quality_score: u8,
    pub last_heartbeat: i64,
}

#[event]
pub struct ListingCommitmentRegistered {
    pub commitment: Pubkey,
    pub provider: Pubkey,
    pub offer_hash: [u8; 32],
    pub listing_id: [u8; 16],
}

#[event]
pub struct ListingCommitmentDeactivated {
    pub commitment: Pubkey,
    pub provider: Pubkey,
    pub offer_hash: [u8; 32],
}

#[event]
pub struct KYCAttestationWritten {
    pub wallet: Pubkey,
    pub oracle: Pubkey,
    pub trust_tier: u8,
    pub kyc_status: u8,
    pub attested_at: i64,
}

#[event]
pub struct SessionCommitmentLocked {
    pub session_id: [u8; 16],
    pub buyer_wallet: Pubkey,
    pub seller_wallet: Pubkey,
    pub bandwidth_limit_bytes: u64,
    pub price_per_gb_lamports: u64,
    pub locked_at: i64,
}

#[event]
pub struct SessionEscrowInitialized {
    pub session_escrow: Pubkey,
    pub session_id: [u8; 16],
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub bandwidth_limit_bytes: u64,
    pub expires_at: i64,
}

#[event]
pub struct SessionEscrowSettled {
    pub session_escrow: Pubkey,
    pub session_id: [u8; 16],
    pub seller_payout: u64,
    pub buyer_refund: u64,
    pub bytes_used: u64,
}

#[event]
pub struct SessionSettledWithMutualReceipt {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub seller_payout: u64,
    pub buyer_refund: u64,
    pub bytes_used: u64,
    pub sequence_num: u64,
}

#[event]
pub struct ProposalCreated {
    pub proposal_pda: Pubkey,
    pub proposer: Pubkey,
    pub title_hash: [u8; 32],
    pub end_slot: u64,
}

#[event]
pub struct VoteCast {
    pub proposal_pda: Pubkey,
    pub voter: Pubkey,
    pub vote_yes: bool,
    pub voting_power: u64,
}

#[event]
pub struct ProposalFinalized {
    pub proposal_pda: Pubkey,
    pub status: u8,
    pub vote_yes: u64,
    pub vote_no: u64,
}

#[event]
pub struct ProposalExecuted {
    pub proposal_pda: Pubkey,
    pub executed_by: Pubkey,
    pub executed_at: i64,
}

#[event]
pub struct DisputeOpened {
    pub dispute_pda: Pubkey,
    pub escrow: Pubkey,
    pub reason_hash: [u8; 32],
    pub slot_seed: u64,
}

#[event]
pub struct DisputeJuryVoteCast {
    pub dispute_pda: Pubkey,
    pub juror: Pubkey,
    pub vote_buyer: bool,
}

#[event]
pub struct DisputeFinalized {
    pub dispute_pda: Pubkey,
    pub verdict_buyer: bool,
    pub yes_votes: u8,
    pub no_votes: u8,
}

#[event]
pub struct AdminAttestationWritten {
    pub admin_wallet: Pubkey,
    pub role: u8,
    pub attested_at: i64,
}

#[event]
pub struct ProgramConfigUpdated {
    pub kyc_min_sol_lamports: u64,
    pub platform_fee_bps: u16,
    pub updated_at: i64,
}

#[event]
pub struct ReviewAttested {
    pub order_escrow_pda: Pubkey,
    pub reviewer: Pubkey,
    pub rating_hash: [u8; 32],
    pub attested_at: i64,
}

#[event]
pub struct SpendingEventLogged {
    pub wallet: Pubkey,
    pub amount_lamports: u64,
    pub op_type: u8,  // 0=withdraw, 1=p2p, 2=session
    pub logged_at: i64,
}

#[event]
pub struct DepositVaultInitialized {
    pub vault: Pubkey,
    pub authority: Pubkey,
    pub hot_treasury: Pubkey,
}

#[event]
pub struct DepositVaultWithdrawn {
    pub vault: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
    pub authority: Pubkey,
}

#[event]
pub struct DepositVaultHotUpdated {
    pub vault: Pubkey,
    pub old_hot: Pubkey,
    pub new_hot: Pubkey,
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

    /// Initialize the platform deposit vault PDA (seeds: ["deposit_vault"]).
    /// Binds the sole hot-treasury withdraw destination and an oracle withdraw authority.
    /// Users deposit via native SOL transfer to the vault address.
    pub fn initialize_deposit_vault(
        ctx: Context<InitializeDepositVault>,
        hot_treasury: Pubkey,
        withdraw_authority: Pubkey,
    ) -> Result<()> {
        require!(hot_treasury != Pubkey::default(), EscrowError::InvalidHotTreasury);
        require!(
            withdraw_authority != Pubkey::default(),
            EscrowError::Unauthorized
        );

        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);

        let vault = &mut ctx.accounts.deposit_vault;
        let clock = Clock::get()?;

        vault.authority = ctx.accounts.admin.key();
        vault.withdraw_authority = withdraw_authority;
        vault.hot_treasury = hot_treasury;
        vault.total_deposited = 0;
        vault.total_withdrawn = 0;
        vault.created_at = clock.unix_timestamp;
        vault.updated_at = clock.unix_timestamp;
        vault.bump = ctx.bumps.deposit_vault;

        emit!(DepositVaultInitialized {
            vault: vault.key(),
            authority: vault.authority,
            hot_treasury,
        });

        msg!(
            "Deposit vault initialized: {} hot={} withdraw_authority={}",
            vault.key(),
            hot_treasury,
            withdraw_authority
        );
        Ok(())
    }

    /// Withdraw SOL from the deposit vault to the bound hot treasury only.
    /// Authority: vault.authority, vault.withdraw_authority, or program_state.admin.
    pub fn withdraw_from_vault(
        ctx: Context<WithdrawFromVault>,
        amount: u64,
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);
        require!(amount > 0, EscrowError::InsufficientFunds);

        let authority = ctx.accounts.authority.key();
        let vault_ref = &ctx.accounts.deposit_vault;
        require!(
            authority == vault_ref.authority
                || authority == vault_ref.withdraw_authority
                || authority == state.admin,
            EscrowError::Unauthorized
        );

        let dest = ctx.accounts.hot_treasury.key();
        require!(
            dest == vault_ref.hot_treasury,
            EscrowError::InvalidVaultDestination
        );

        let rent = Rent::get()?;
        let min_balance = rent.minimum_balance(DepositVault::LEN);
        let vault_ai = ctx.accounts.deposit_vault.to_account_info();
        let dest_ai = ctx.accounts.hot_treasury.to_account_info();
        let available = vault_ai.lamports().saturating_sub(min_balance);
        require!(available >= amount, EscrowError::InsufficientFunds);

        **vault_ai.try_borrow_mut_lamports()? = vault_ai
            .lamports()
            .checked_sub(amount)
            .ok_or(EscrowError::InsufficientFunds)?;
        **dest_ai.try_borrow_mut_lamports()? = dest_ai
            .lamports()
            .checked_add(amount)
            .ok_or(EscrowError::InsufficientFunds)?;

        let vault = &mut ctx.accounts.deposit_vault;
        let clock = Clock::get()?;
        vault.total_withdrawn = vault.total_withdrawn.saturating_add(amount);
        vault.updated_at = clock.unix_timestamp;

        emit!(DepositVaultWithdrawn {
            vault: vault.key(),
            destination: dest,
            amount,
            authority,
        });

        msg!(
            "Deposit vault withdrawn: amount={} to={}",
            amount,
            dest
        );
        Ok(())
    }

    /// Rotate the hot treasury binding on the deposit vault (admin/authority only).
    pub fn update_deposit_vault_hot(
        ctx: Context<UpdateDepositVaultHot>,
        new_hot_treasury: Pubkey,
    ) -> Result<()> {
        require!(new_hot_treasury != Pubkey::default(), EscrowError::InvalidHotTreasury);

        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);

        let authority = ctx.accounts.authority.key();
        let vault_authority = ctx.accounts.deposit_vault.authority;
        require!(
            authority == vault_authority || authority == state.admin,
            EscrowError::Unauthorized
        );

        let vault = &mut ctx.accounts.deposit_vault;
        let old_hot = vault.hot_treasury;
        let clock = Clock::get()?;
        vault.hot_treasury = new_hot_treasury;
        vault.updated_at = clock.unix_timestamp;

        emit!(DepositVaultHotUpdated {
            vault: vault.key(),
            old_hot,
            new_hot: new_hot_treasury,
        });

        msg!(
            "Deposit vault hot updated: {} -> {}",
            old_hot,
            new_hot_treasury
        );
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
    // D-S1: ADMIN KEY ROTATION (two-step handoff)
    //
    // Replaces the single-admin model with a two-step proposal/accept flow.
    // The current admin proposes a successor; the successor must explicitly
    // accept — preventing accidental or malicious key theft.
    // =========================================================================

    /// Step 1: Current admin nominates a new admin.
    /// The new key is stored in `pending_admin`; it takes effect only when
    /// the nominee calls `accept_admin_transfer`.
    pub fn propose_admin_transfer(
        ctx: Context<ProposeAdminTransfer>,
        new_admin: Pubkey,
    ) -> Result<()> {
        let state = &mut ctx.accounts.program_state;
        let clock = Clock::get()?;

        require!(new_admin != state.admin, EscrowError::InvalidStatus);
        state.pending_admin = new_admin;
        state.updated_at = clock.unix_timestamp;

        msg!("Admin transfer proposed: current={} → pending={}", state.admin, new_admin);
        Ok(())
    }

    /// Step 2: The nominated account accepts and becomes the new admin.
    /// Only the exact `pending_admin` key may call this.
    pub fn accept_admin_transfer(ctx: Context<AcceptAdminTransfer>) -> Result<()> {
        let state = &mut ctx.accounts.program_state;
        let clock = Clock::get()?;

        let pending = state.pending_admin;
        require!(pending != Pubkey::default(), EscrowError::Unauthorized);
        require!(
            ctx.accounts.new_admin.key() == pending,
            EscrowError::Unauthorized
        );

        let old_admin = state.admin;
        state.admin = pending;
        state.pending_admin = Pubkey::default(); // clear nomination
        state.updated_at = clock.unix_timestamp;

        msg!("Admin transfer accepted: {} → {}", old_admin, state.admin);
        Ok(())
    }

    // =========================================================================
    // D-S2: MULTI-SIG PAUSE (replaces single-admin pause)
    //
    // Emergency pause now requires M-of-N oracle signers rather than a single
    // admin key.  This prevents a compromised admin wallet from unilaterally
    // halting the protocol.  Signers submit their approval in separate txns;
    // once `threshold` approvals are recorded the program is paused atomically.
    //
    // For un-pausing the existing single-admin `emergency_resume` is kept so
    // that recovery is fast when the oracle quorum is operational.
    // =========================================================================

    /// Pause the program once `multisig_oracle.threshold` distinct oracle signers have
    /// signed this transaction. `oracle_signer` is one of them; every other approver passes
    /// their wallet in `remaining_accounts`, where it must be a transaction signer.
    ///
    /// `approvals` is kept so existing callers still serialize, but it is ignored: it is
    /// instruction data, so listing another signer's public key proved nothing. Counting it
    /// let a single oracle key pause the protocol by naming the rest of the set.
    pub fn multi_sig_pause_vote(
        ctx: Context<MultiSigPauseVote>,
        approvals: Vec<Pubkey>,
    ) -> Result<()> {
        let _ = &approvals;
        let state = &mut ctx.accounts.program_state;
        let oracle = &ctx.accounts.multisig_oracle;
        let clock = Clock::get()?;

        require!(!state.paused, EscrowError::InvalidStatus);

        // Verify the caller is in the oracle signer set
        let caller = ctx.accounts.oracle_signer.key();
        require!(oracle.signers.contains(&caller), EscrowError::Unauthorized);

        let valid_approvals = distinct_oracle_signers(
            caller,
            ctx.remaining_accounts
                .iter()
                .filter(|acc| acc.is_signer)
                .map(|acc| *acc.key),
            &oracle.signers,
        );

        require!(
            valid_approvals.len() >= oracle.threshold as usize,
            EscrowError::InsufficientSignatures
        );

        state.paused = true;
        state.paused_at = clock.unix_timestamp;
        state.updated_at = clock.unix_timestamp;

        msg!(
            "Program PAUSED via multi-sig: {}/{} oracle signers approved",
            valid_approvals.len(),
            oracle.signers.len()
        );
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
        let multisig = &mut ctx.accounts.multisig_oracle;
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

        // Verify Ed25519 signatures using instruction introspection
        let current_index = anchor_lang::solana_program::sysvar::instructions::load_current_index_checked(
            &ctx.accounts.instructions,
        ).map_err(|_| error!(EscrowError::InvalidSignatureVerification))?;

        let threshold = multisig.threshold as usize;
        require!(
            current_index as usize >= threshold,
            EscrowError::MissingSignatureVerification
        );

        let ed25519_program_id = pubkey!("Ed25519SigVerify111111111111111111111111111");

        // Reconstruct message: "settle:{escrow}:{buyer}:{seller}:{usage}:{nonce}"
        let msg = format!(
            "settle:{}:{}:{}:{}:{}",
            escrow.key().to_string(),
            escrow.buyer.to_string(),
            escrow.seller.to_string(),
            bandwidth_used_gb,
            multisig.nonce,
        );
        let msg_bytes = msg.as_bytes();

        let mut verified_signers = Vec::new();

        for i in 0..threshold {
            let verify_ix_idx = (current_index as usize) - threshold + i;
            let preceding_ix = anchor_lang::solana_program::sysvar::instructions::load_instruction_at_checked(
                verify_ix_idx,
                &ctx.accounts.instructions,
            ).map_err(|_| error!(EscrowError::MissingSignatureVerification))?;

            require!(
                preceding_ix.program_id == ed25519_program_id,
                EscrowError::MissingSignatureVerification
            );

            let data = preceding_ix.data;
            require!(data.len() >= 16, EscrowError::InvalidSignatureVerification);

            let num_sigs = data[0];
            require!(num_sigs >= 1, EscrowError::InvalidSignatureVerification);

            let signature_offset = u16::from_le_bytes([data[2], data[3]]) as usize;
            let signature_inst_idx = u16::from_le_bytes([data[4], data[5]]);
            let public_key_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
            let public_key_inst_idx = u16::from_le_bytes([data[8], data[9]]);
            let message_data_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
            let message_data_size = u16::from_le_bytes([data[12], data[13]]) as usize;
            let message_inst_idx = u16::from_le_bytes([data[14], data[15]]);

            require!(
                signature_inst_idx == 0xffff && public_key_inst_idx == 0xffff && message_inst_idx == 0xffff,
                EscrowError::InvalidSignatureVerification
            );

            require!(
                public_key_offset + 32 <= data.len() &&
                signature_offset + 64 <= data.len() &&
                message_data_offset + message_data_size <= data.len(),
                EscrowError::InvalidSignatureVerification
            );

            // Extract public key and verify it matches the oracle list
            let pubkey_bytes = &data[public_key_offset..public_key_offset + 32];
            let signer_pubkey = Pubkey::new_from_array(pubkey_bytes.try_into().unwrap());
            
            require!(
                multisig.signers.contains(&signer_pubkey),
                EscrowError::InvalidOracleSignature
            );
            require!(
                oracle_signers.contains(&signer_pubkey),
                EscrowError::InvalidOracleSignature
            );
            require!(
                !verified_signers.contains(&signer_pubkey),
                EscrowError::DuplicateSignature
            );
            verified_signers.push(signer_pubkey);

            // Verify message matches the expected settlement payload
            require!(
                message_data_size == msg_bytes.len(),
                EscrowError::InvalidSignatureVerification
            );
            let parsed_msg = &data[message_data_offset..message_data_offset + message_data_size];
            require!(parsed_msg == msg_bytes, EscrowError::InvalidSignatureVerification);
        }

        // Calculate proportional payout (u128, fails closed on overflow)
        let seller_payout = prorated_payout(
            escrow.amount,
            bandwidth_used_gb,
            escrow.bandwidth_limit_gb,
        )?;
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

        // Remaining lamports (buyer_refund + rent) go to buyer via `close = buyer`.

        emit!(EscrowSettled {
            escrow: escrow.key(),
            seller_payout,
            buyer_refund,
            bandwidth_used: bandwidth_used_gb,
        });

        // BC-06: bump global multisig nonce after successful settle so settlement
        // messages (and oracle_sig PDAs) cannot be replayed across escrows.
        multisig.nonce = multisig
            .nonce
            .checked_add(1)
            .ok_or(EscrowError::InvalidStatus)?;
        multisig.last_update = clock.unix_timestamp;

        msg!("Escrow settled with multi-sig (BC06 nonce bump): {} to seller, {} refunded, nonce={}", 
            seller_payout, buyer_refund, multisig.nonce);
        Ok(())
    }

    /// Settle escrow with a cryptographically mutual session receipt.
    ///
    /// The transaction must include 2 preceding Ed25519SigVerify instructions:
    /// - Preceding Ix 0: Buyer signature on `receipt:v1:{escrow}:{buyer}:{seller}:{bytes_used}:{sequence_num}`
    /// - Preceding Ix 1: Seller signature on `receipt:v1:{escrow}:{buyer}:{seller}:{bytes_used}:{sequence_num}`
    ///
    /// This allows buyer and seller to settle bandwidth usage trustlessly without an oracle.
    pub fn settle_escrow_mutual_receipt(
        ctx: Context<SettleEscrowMutualReceipt>,
        bytes_used: u64,
        sequence_num: u64,
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);

        let escrow = &mut ctx.accounts.escrow;

        require!(
            escrow.status == EscrowStatus::Pending || escrow.status == EscrowStatus::Active,
            EscrowError::InvalidStatus
        );

        // Verify 2 preceding Ed25519 instructions exist
        let current_index = anchor_lang::solana_program::sysvar::instructions::load_current_index_checked(
            &ctx.accounts.instructions,
        ).map_err(|_| error!(EscrowError::InvalidSignatureVerification))?;

        require!(
            current_index >= 2,
            EscrowError::MissingSignatureVerification
        );

        let ed25519_program_id = pubkey!("Ed25519SigVerify111111111111111111111111111");

        // Canonical message: "receipt:v1:{escrow}:{buyer}:{seller}:{bytes}:{seq}"
        let msg = format!(
            "receipt:v1:{}:{}:{}:{}:{}",
            escrow.key().to_string(),
            escrow.buyer.to_string(),
            escrow.seller.to_string(),
            bytes_used,
            sequence_num,
        );
        let msg_bytes = msg.as_bytes();

        let expected_signers = [escrow.buyer, escrow.seller];

        for (i, expected_signer) in expected_signers.iter().enumerate() {
            let verify_ix_idx = (current_index as usize) - 2 + i;
            let preceding_ix = anchor_lang::solana_program::sysvar::instructions::load_instruction_at_checked(
                verify_ix_idx,
                &ctx.accounts.instructions,
            ).map_err(|_| error!(EscrowError::MissingSignatureVerification))?;

            require!(
                preceding_ix.program_id == ed25519_program_id,
                EscrowError::MissingSignatureVerification
            );

            let data = preceding_ix.data;
            require!(data.len() >= 16, EscrowError::InvalidSignatureVerification);

            let num_sigs = data[0];
            require!(num_sigs >= 1, EscrowError::InvalidSignatureVerification);

            let signature_offset = u16::from_le_bytes([data[2], data[3]]) as usize;
            let signature_inst_idx = u16::from_le_bytes([data[4], data[5]]);
            let public_key_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
            let public_key_inst_idx = u16::from_le_bytes([data[8], data[9]]);
            let message_data_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
            let message_data_size = u16::from_le_bytes([data[12], data[13]]) as usize;
            let message_inst_idx = u16::from_le_bytes([data[14], data[15]]);

            require!(
                signature_inst_idx == 0xffff && public_key_inst_idx == 0xffff && message_inst_idx == 0xffff,
                EscrowError::InvalidSignatureVerification
            );

            require!(
                public_key_offset + 32 <= data.len() &&
                signature_offset + 64 <= data.len() &&
                message_data_offset + message_data_size <= data.len(),
                EscrowError::InvalidSignatureVerification
            );

            let pubkey_bytes = &data[public_key_offset..public_key_offset + 32];
            let signer_pubkey = Pubkey::new_from_array(pubkey_bytes.try_into().unwrap());
            
            require!(
                signer_pubkey == *expected_signer,
                EscrowError::InvalidOracleSignature
            );

            require!(
                message_data_size == msg_bytes.len(),
                EscrowError::InvalidSignatureVerification
            );
            let parsed_msg = &data[message_data_offset..message_data_offset + message_data_size];
            require!(parsed_msg == msg_bytes, EscrowError::InvalidSignatureVerification);
        }

        // Calculate proportional payout (capped by limit; u128, fails closed on overflow)
        let bandwidth_limit_bytes = escrow.bandwidth_limit_gb.saturating_mul(1_073_741_824);
        let seller_payout =
            prorated_payout(escrow.amount, bytes_used, bandwidth_limit_bytes)?;

        let buyer_refund = escrow.amount.saturating_sub(seller_payout);

        escrow.bandwidth_used_gb = bytes_used / 1_073_741_824;
        escrow.status = EscrowStatus::Settled;

        if seller_payout > 0 {
            **escrow.to_account_info().try_borrow_mut_lamports()? -= seller_payout;
            **ctx.accounts.seller.try_borrow_mut_lamports()? += seller_payout;
        }

        emit!(SessionSettledWithMutualReceipt {
            escrow: escrow.key(),
            buyer: escrow.buyer,
            seller: escrow.seller,
            seller_payout,
            buyer_refund,
            bytes_used,
            sequence_num,
        });

        msg!(
            "Escrow settled via mutual receipt: {} to seller, {} refunded (bytes={}, seq={})",
            seller_payout,
            buyer_refund,
            bytes_used,
            sequence_num
        );
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

        // Only a live escrow can be disputed, and neither party may sit on its own jury.
        require!(
            escrow.status == EscrowStatus::Pending || escrow.status == EscrowStatus::Active,
            EscrowError::InvalidStatus
        );
        require!(
            !jurors.contains(&escrow.buyer) && !jurors.contains(&escrow.seller),
            EscrowError::InvalidJuror
        );

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

        // u128 intermediate, and an error instead of a quiet 0 when the price does not fit.
        let total = (bandwidth_gb as u128)
            .checked_mul(base_price as u128)
            .and_then(|v| v.checked_mul(quality_multiplier as u128))
            .and_then(|v| v.checked_div(100))
            .ok_or(error!(EscrowError::CalculationOverflow))?;
        let total = u64::try_from(total).map_err(|_| error!(EscrowError::CalculationOverflow))?;

        Ok(total)
    }

    // =========================================================================
    // PROVIDER STAKING
    // =========================================================================

    /// Stakes provider collateral on-chain using treasury/oracle custody.
    ///
    /// The provider's internal DB balance is debited off-chain by control-api;
    /// this instruction is the canonical on-chain lock of that collateral into
    /// the provider stake PDA.
    pub fn stake_provider(
        ctx: Context<StakeProvider>,
        provider_wallet: Pubkey,
        amount: u64,
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);
        require!(amount > 0, EscrowError::InsufficientFunds);

        let clock = Clock::get()?;
        let oracle_info = ctx.accounts.oracle.to_account_info();
        let stake_account_info = ctx.accounts.stake_account.to_account_info();
        let system_program_info = ctx.accounts.system_program.to_account_info();
        let stake = &mut ctx.accounts.stake_account;

        if stake.owner == Pubkey::default() {
            stake.owner = provider_wallet;
            stake.bump = ctx.bumps.stake_account;
            stake.insurance_pool_contribution = 0;
        }
        require!(stake.owner == provider_wallet, EscrowError::Unauthorized);

        // Transfer lamports from oracle treasury to stake PDA.
        let cpi_ctx = CpiContext::new(
            system_program_info,
            system_program::Transfer {
                from: oracle_info,
                to: stake_account_info,
            },
        );
        system_program::transfer(cpi_ctx, amount)?;

        stake.amount = stake.amount.saturating_add(amount);
        stake.last_stake_time = clock.unix_timestamp;
        stake.unstake_request_time = 0;
        stake.is_slashed = false;

        emit!(ProviderStaked {
            provider: provider_wallet,
            amount,
            total_stake: stake.amount,
        });

        msg!("Provider staked on-chain: wallet={} amount={} total={}", provider_wallet, amount, stake.amount);
        Ok(())
    }

    /// Unstakes provider collateral from the stake PDA back to treasury/oracle.
    pub fn unstake_provider(
        ctx: Context<UnstakeProvider>,
        provider_wallet: Pubkey,
        amount: u64,
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);
        require!(amount > 0, EscrowError::InsufficientFunds);

        let clock = Clock::get()?;
        let stake = &mut ctx.accounts.stake_account;
        require!(stake.owner == provider_wallet, EscrowError::Unauthorized);
        require!(stake.amount >= amount, EscrowError::InsufficientFunds);

        // COOLDOWN LOGIC:
        // Phase 1: Request unstake
        if stake.unstake_request_time == 0 {
            stake.unstake_request_time = clock.unix_timestamp;
            msg!("Unstake request registered at {}. Call unstake again after cooldown.", stake.unstake_request_time);
            return Ok(());
        }

        // Phase 2: Execute unstake after cooldown (dynamically fetched from program config)
        let mut cooldown_period = ctx.accounts.program_config.unstake_cooldown_seconds;
        if cooldown_period <= 0 {
            cooldown_period = 5; // Fallback default
        }
        require!(
            clock.unix_timestamp >= stake.unstake_request_time + cooldown_period,
            EscrowError::LockupPeriodActive
        );

        // Keep stake PDA rent-exempt after transferring out lamports.
        let rent = Rent::get()?;
        let min_balance = rent.minimum_balance(StakeAccount::LEN);
        let stake_ai = stake.to_account_info();
        let oracle_ai = ctx.accounts.oracle.to_account_info();
        let available = stake_ai.lamports().saturating_sub(min_balance);
        require!(available >= amount, EscrowError::InsufficientFunds);

        **stake_ai.try_borrow_mut_lamports()? = stake_ai
            .lamports()
            .checked_sub(amount)
            .ok_or(EscrowError::InsufficientFunds)?;
        **oracle_ai.try_borrow_mut_lamports()? = oracle_ai
            .lamports()
            .checked_add(amount)
            .ok_or(EscrowError::InsufficientFunds)?;

        stake.amount = stake.amount.saturating_sub(amount);
        stake.unstake_request_time = 0; // Reset request time after successful withdraw

        emit!(ProviderUnstaked {
            provider: provider_wallet,
            amount,
            remaining_stake: stake.amount,
        });

        msg!("Provider unstaked on-chain: wallet={} amount={} remaining={}", provider_wallet, amount, stake.amount);
        Ok(())
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

        let max_slash = (stake.amount as u128)
            .checked_mul(pool.slash_percentage as u128)
            .and_then(|v| v.checked_div(100))
            .ok_or(error!(EscrowError::CalculationOverflow))?;
        // max_slash <= stake.amount when slash_percentage <= 100; clamp so a bad
        // percentage can never slash more than the stake.
        let max_slash = std::cmp::min(max_slash, stake.amount as u128) as u64;
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

    /// Settle escrow (legacy). Program admin (oracle) only: the caller chooses
    /// `bandwidth_used_gb`, so letting the buyer or the seller call it let the buyer
    /// report zero usage for a full refund, or the seller report the full limit.
    pub fn settle_escrow(
        ctx: Context<SettleEscrow>,
        bandwidth_used_gb: u64,
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);

        let authority = ctx.accounts.authority.key();
        let escrow = &mut ctx.accounts.escrow;

        require!(authority == state.admin, EscrowError::Unauthorized);

        require!(
            escrow.status == EscrowStatus::Pending || escrow.status == EscrowStatus::Active,
            EscrowError::InvalidStatus
        );

        let seller_payout = prorated_payout(
            escrow.amount,
            bandwidth_used_gb,
            escrow.bandwidth_limit_gb,
        )?;
        let buyer_refund = escrow.amount.saturating_sub(seller_payout);

        escrow.bandwidth_used_gb = bandwidth_used_gb;
        escrow.status = EscrowStatus::Settled;

        if seller_payout > 0 {
            **escrow.to_account_info().try_borrow_mut_lamports()? -= seller_payout;
            **ctx.accounts.seller.try_borrow_mut_lamports()? += seller_payout;
        }

        // Remaining lamports (buyer_refund + rent) go to buyer via `close = buyer`,
        // freeing the buyer+seller PDA so the pair can transact again.

        emit!(EscrowSettled {
            escrow: escrow.key(),
            seller_payout,
            buyer_refund,
            bandwidth_used: bandwidth_used_gb,
        });

        Ok(())
    }

    /// Close a terminal (settled/refunded) legacy escrow and return the rent
    /// reserve to the buyer. Frees the buyer+seller PDA for re-initialization;
    /// escrows settled after this upgrade close automatically on settle.
    pub fn close_escrow(ctx: Context<CloseEscrow>) -> Result<()> {
        let state = &ctx.accounts.program_state;
        let escrow = &ctx.accounts.escrow;
        let authority = ctx.accounts.authority.key();

        require!(
            authority == escrow.buyer || authority == escrow.seller || authority == state.admin,
            EscrowError::Unauthorized
        );
        require!(
            escrow.status == EscrowStatus::Settled || escrow.status == EscrowStatus::Refunded,
            EscrowError::InvalidStatus
        );

        emit!(EscrowClosed {
            escrow: escrow.key(),
            buyer: escrow.buyer,
        });

        msg!("close_escrow: terminal legacy escrow closed, PDA freed (CLOSE01)");
        Ok(())
    }

    // ... Additional functions for token escrows, streaming, etc. can be added here

    // =========================================================================
    // USAGE PROOF ANCHORING
    //
    // The oracle submits one UsageProofRecord per metering window (typically
    // every 15 minutes or at session termination).  Records are append-only and
    // keyed by (escrow_pda, proof_index).  They serve as an immutable audit
    // trail; the actual fund release happens via settle_escrow / settle_escrow_multisig.
    //
    // This makes bandwidth accounting trustless: any party can independently
    // audit total bytes consumed by summing all UsageProofRecord accounts for
    // an escrow PDA — without trusting the ProxyHubb server.
    // =========================================================================

    /// Anchor a bandwidth usage proof on-chain for a specific escrow window.
    ///
    /// Called by the oracle when:
    ///   - A 15-minute metering batch accumulates signed proofs, OR
    ///   - A session is terminated (bandwidth exhausted or user-initiated).
    ///
    /// The instruction is idempotent in effect: submitting the same (escrow,
    /// proof_index) twice will fail at PDA init (account already exists),
    /// preventing double-counting.
    pub fn submit_usage_proof(
        ctx: Context<SubmitUsageProof>,
        proof_index: u32,
        total_bytes: u64,
        period_start: i64,
        period_end: i64,
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);
        // BC-05: only program admin/oracle may anchor usage proofs.
        require!(ctx.accounts.oracle.key() == state.admin, EscrowError::Unauthorized);
        require!(total_bytes > 0, EscrowError::InvalidStatus);
        require!(period_end > period_start, EscrowError::InvalidStatus);

        let record = &mut ctx.accounts.usage_proof;
        let clock = Clock::get()?;

        // The escrow account is passed as a raw AccountInfo so both the legacy
        // (["escrow", buyer, seller]) and multi-sig (["escrow_multisig", …]) PDAs
        // are accepted.  We do not mutate it here — settlement instructions
        // handle fund release based on the cumulative bytes recorded.
        let escrow_key = ctx.accounts.escrow.key();

        record.escrow = escrow_key;
        record.oracle = ctx.accounts.oracle.key();
        record.proof_index = proof_index;
        record.total_bytes = total_bytes;
        record.period_start = period_start;
        record.period_end = period_end;
        record.submitted_at = clock.unix_timestamp;
        record.bump = ctx.bumps.usage_proof;

        emit!(UsageProofSubmitted {
            escrow: escrow_key,
            proof_record: record.key(),
            proof_index,
            total_bytes,
            period_start,
            period_end,
        });

        msg!(
            "Usage proof anchored: escrow={}, index={}, bytes={}, window=[{},{}]",
            escrow_key,
            proof_index,
            total_bytes,
            period_start,
            period_end
        );
        Ok(())
    }

    // =========================================================================
    // PROVIDER REGISTRY
    //
    // Providers are registered on-chain via the oracle (server-signed tx).
    // PDA seeds: ["provider-registry", provider_pubkey].
    // The oracle is the payer/signer; provider pubkey is an instruction arg.
    // =========================================================================

    /// Register a provider node in the on-chain registry.
    /// Called by the oracle when a provider completes registration via the API.
    pub fn register_provider(
        ctx: Context<RegisterProvider>,
        provider: Pubkey,
        endpoint: String,
        location: String,
    ) -> Result<()> {
        require!(
            endpoint.len() <= ProviderRegistry::MAX_ENDPOINT_LEN,
            EscrowError::InvalidStatus
        );
        require!(
            location.len() <= ProviderRegistry::MAX_LOCATION_LEN,
            EscrowError::InvalidStatus
        );

        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);
        require!(ctx.accounts.oracle.key() == state.admin, EscrowError::Unauthorized);

        let registry = &mut ctx.accounts.provider_registry;
        let clock = Clock::get()?;

        registry.provider = provider;
        registry.endpoint = endpoint.clone();
        registry.location = location.clone();
        registry.stake_account = Pubkey::default(); // populated when provider stakes
        registry.quality_score = 100;
        registry.total_bandwidth_served = 0;
        registry.successful_sessions = 0;
        registry.failed_sessions = 0;
        registry.is_active = true;
        registry.registered_at = clock.unix_timestamp;
        registry.last_heartbeat = clock.unix_timestamp;
        registry.bump = ctx.bumps.provider_registry;

        emit!(ProviderRegisteredEvent {
            registry: registry.key(),
            provider,
            endpoint,
            location,
        });

        msg!("Provider registered on-chain: {}", provider);
        Ok(())
    }

    /// Update provider heartbeat and cumulative metrics.
    /// Called by the oracle every heartbeat cycle.
    pub fn provider_heartbeat(
        ctx: Context<ProviderHeartbeat>,
        provider: Pubkey,
        quality_score: u8,
        bandwidth_served_delta: u64,
        successful_sessions_delta: u32,
        failed_sessions_delta: u32,
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);

        let registry = &mut ctx.accounts.provider_registry;
        let clock = Clock::get()?;

        registry.quality_score = quality_score;
        registry.total_bandwidth_served = registry
            .total_bandwidth_served
            .saturating_add(bandwidth_served_delta);
        registry.successful_sessions = registry
            .successful_sessions
            .saturating_add(successful_sessions_delta);
        registry.failed_sessions = registry
            .failed_sessions
            .saturating_add(failed_sessions_delta);
        registry.is_active = true; // heartbeat re-activates a deregistered provider
        registry.last_heartbeat = clock.unix_timestamp;

        emit!(ProviderHeartbeatEvent {
            registry: registry.key(),
            provider,
            quality_score,
            last_heartbeat: clock.unix_timestamp,
        });

        msg!("Provider heartbeat: {}, quality={}", provider, quality_score);
        Ok(())
    }

    /// Mark a provider as inactive in the on-chain registry.
    /// Called by the oracle when a provider deregisters or is removed.
    pub fn deregister_provider(
        ctx: Context<DeregisterProvider>,
        provider: Pubkey,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.provider_registry;

        registry.is_active = false;

        msg!("Provider deregistered on-chain: {}", provider);
        Ok(())
    }

    // =========================================================================
    // GATEWAY REGISTRY & STAKING (Track 2.1)
    //
    // Permissionless Edge Gateway operators bond SOL into a GatewayRegistry PDA.
    // Seeds: ["gateway-registry", gateway_pubkey]
    // =========================================================================

    /// Register an edge gateway operator with bonded SOL stake.
    pub fn register_gateway(
        ctx: Context<RegisterGateway>,
        endpoint: String,
        stake_amount: u64,
        min_stake_lamports: u64,
    ) -> Result<()> {
        require!(
            endpoint.len() <= GatewayRegistry::MAX_ENDPOINT_LEN,
            EscrowError::InvalidStatus
        );
        require!(stake_amount >= min_stake_lamports, EscrowError::InsufficientFunds);

        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);

        let gateway_registry = &mut ctx.accounts.gateway_registry;
        let clock = Clock::get()?;

        gateway_registry.gateway = ctx.accounts.gateway.key();
        gateway_registry.owner = ctx.accounts.owner.key();
        gateway_registry.endpoint = endpoint.clone();
        gateway_registry.stake_amount = stake_amount;
        gateway_registry.min_stake_lamports = min_stake_lamports;
        gateway_registry.quality_score = 100;
        gateway_registry.active_tunnels = 0;
        gateway_registry.is_active = true;
        gateway_registry.registered_at = clock.unix_timestamp;
        gateway_registry.last_heartbeat = clock.unix_timestamp;
        gateway_registry.bump = ctx.bumps.gateway_registry;

        // Transfer stake SOL from owner to GatewayRegistry PDA
        if stake_amount > 0 {
            let cpi_context = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: gateway_registry.to_account_info(),
                },
            );
            system_program::transfer(cpi_context, stake_amount)?;
        }

        emit!(GatewayRegisteredEvent {
            gateway: gateway_registry.gateway,
            owner: gateway_registry.owner,
            endpoint,
            stake: stake_amount,
        });

        msg!(
            "Gateway registered on-chain: gateway={}, owner={}, stake={}",
            gateway_registry.gateway,
            gateway_registry.owner,
            stake_amount
        );
        Ok(())
    }

    /// Submit periodic heartbeat and telemetry from a gateway operator.
    pub fn gateway_heartbeat(
        ctx: Context<GatewayHeartbeatCtx>,
        active_tunnels: u32,
        quality_score: u8,
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);

        let gateway_registry = &mut ctx.accounts.gateway_registry;
        let clock = Clock::get()?;

        gateway_registry.active_tunnels = active_tunnels;
        gateway_registry.quality_score = quality_score;
        gateway_registry.is_active = true;
        gateway_registry.last_heartbeat = clock.unix_timestamp;

        emit!(GatewayHeartbeatEvent {
            gateway: gateway_registry.gateway,
            active_tunnels,
            quality_score,
            last_heartbeat: clock.unix_timestamp,
        });

        msg!(
            "Gateway heartbeat: gateway={}, tunnels={}, quality={}",
            gateway_registry.gateway,
            active_tunnels,
            quality_score
        );
        Ok(())
    }

    /// Slash a malicious or non-compliant gateway's bonded stake.
    pub fn slash_gateway(
        ctx: Context<SlashGateway>,
        slash_amount: u64,
        reason_hash: [u8; 32],
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);

        let gateway_registry = &mut ctx.accounts.gateway_registry;
        require!(gateway_registry.stake_amount >= slash_amount, EscrowError::InsufficientFunds);

        let rent = Rent::get()?;
        let min_rent = rent.minimum_balance(GatewayRegistry::LEN);
        let registry_ai = gateway_registry.to_account_info();
        let treasury_ai = ctx.accounts.treasury.to_account_info();

        let available = registry_ai.lamports().saturating_sub(min_rent);
        require!(available >= slash_amount, EscrowError::InsufficientFunds);

        **registry_ai.try_borrow_mut_lamports()? = registry_ai
            .lamports()
            .checked_sub(slash_amount)
            .ok_or(EscrowError::InsufficientFunds)?;
        **treasury_ai.try_borrow_mut_lamports()? = treasury_ai
            .lamports()
            .checked_add(slash_amount)
            .ok_or(EscrowError::InsufficientFunds)?;

        gateway_registry.stake_amount = gateway_registry.stake_amount.saturating_sub(slash_amount);
        if gateway_registry.stake_amount < gateway_registry.min_stake_lamports {
            gateway_registry.is_active = false;
        }

        emit!(GatewaySlashedEvent {
            gateway: gateway_registry.gateway,
            slashed_amount: slash_amount,
            remaining_stake: gateway_registry.stake_amount,
            reason_hash,
        });

        msg!(
            "Gateway slashed: gateway={}, slashed={}, remaining={}",
            gateway_registry.gateway,
            slash_amount,
            gateway_registry.stake_amount
        );
        Ok(())
    }

    /// Deregister an edge gateway operator and return bonded stake to owner.
    pub fn deregister_gateway(ctx: Context<DeregisterGateway>) -> Result<()> {
        let gateway_registry = &mut ctx.accounts.gateway_registry;
        let clock = Clock::get()?;

        let unbonding_seconds = 86_400; // 24-hour unbonding cooldown
        require!(
            clock.unix_timestamp >= gateway_registry.last_heartbeat.saturating_add(unbonding_seconds),
            EscrowError::LockupPeriodActive
        );

        gateway_registry.is_active = false;
        let returned_stake = gateway_registry.stake_amount;

        emit!(GatewayDeregisteredEvent {
            gateway: gateway_registry.gateway,
            owner: gateway_registry.owner,
            stake_returned: returned_stake,
        });

        msg!(
            "Gateway deregistered: gateway={}, returned_stake={}",
            gateway_registry.gateway,
            returned_stake
        );
        Ok(())
    }

    // =========================================================================
    // PROOF-OF-BANDWIDTH MINING & TOKENOMICS (Track 4.1)
    //
    // Providers claim proportional epoch rewards for verified bandwidth receipts.
    // PDA seeds: ["epoch-rewards", epoch_id.to_le_bytes()]
    // =========================================================================

    /// Initialize an epoch reward emission pool.
    pub fn initialize_epoch_reward_pool(
        ctx: Context<InitializeEpochRewardPool>,
        epoch_id: u64,
        total_emission_lamports: u64,
        total_bandwidth_verified: u64,
        duration_seconds: i64,
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);
        require!(ctx.accounts.authority.key() == state.admin, EscrowError::Unauthorized);
        require!(total_emission_lamports > 0, EscrowError::InsufficientFunds);
        require!(total_bandwidth_verified > 0, EscrowError::InvalidStatus);

        let pool = &mut ctx.accounts.epoch_reward_pool;
        let clock = Clock::get()?;

        pool.epoch_id = epoch_id;
        pool.total_emission_lamports = total_emission_lamports;
        pool.remaining_emission_lamports = total_emission_lamports;
        pool.total_bandwidth_verified = total_bandwidth_verified;
        pool.settled_providers_count = 0;
        pool.is_finalized = false;
        pool.start_timestamp = clock.unix_timestamp;
        pool.end_timestamp = clock.unix_timestamp.saturating_add(duration_seconds);
        pool.bump = ctx.bumps.epoch_reward_pool;

        // Transfer emission SOL from funder to EpochRewardPool PDA
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.authority.to_account_info(),
                to: pool.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, total_emission_lamports)?;

        msg!(
            "Epoch reward pool initialized: epoch={}, emission={}, bandwidth_target={}",
            epoch_id,
            total_emission_lamports,
            total_bandwidth_verified
        );
        Ok(())
    }

    /// Pay a provider's proportional Proof-of-Bandwidth mining reward for an epoch.
    ///
    /// `provider_bytes_verified` is a claim about off-chain metering, so the program admin
    /// (oracle) must sign to attest it, and one `EpochClaimReceipt` per provider per epoch
    /// is created so the same provider cannot be paid twice. Before this, the provider
    /// signed for itself and chose the byte count, so anyone could claim the whole pool.
    pub fn claim_bandwidth_rewards(
        ctx: Context<ClaimBandwidthRewards>,
        epoch_id: u64,
        provider_bytes_verified: u64,
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);
        require!(provider_bytes_verified > 0, EscrowError::InvalidStatus);

        let pool = &mut ctx.accounts.epoch_reward_pool;
        require!(pool.epoch_id == epoch_id, EscrowError::InvalidStatus);
        require!(pool.total_bandwidth_verified > 0, EscrowError::InvalidStatus);
        // One provider cannot have carried more than all verified bandwidth.
        require!(
            provider_bytes_verified <= pool.total_bandwidth_verified,
            EscrowError::InvalidStatus
        );

        // Proportional reward calculation: (provider_bytes * total_emission) / total_bandwidth
        let reward_calc = (provider_bytes_verified as u128)
            .checked_mul(pool.total_emission_lamports as u128)
            .ok_or(EscrowError::CalculationOverflow)?
            .checked_div(pool.total_bandwidth_verified as u128)
            .ok_or(EscrowError::CalculationOverflow)? as u64;

        let reward_payout = reward_calc.min(pool.remaining_emission_lamports);
        require!(reward_payout > 0, EscrowError::InsufficientFunds);

        let pool_ai = pool.to_account_info();
        let provider_ai = ctx.accounts.provider_wallet.to_account_info();

        // The pool account must stay rent-exempt: paying out into the rent reserve would
        // let the runtime reap the account and strand the remaining emission.
        let pool_after = pool_ai
            .lamports()
            .checked_sub(reward_payout)
            .ok_or(EscrowError::InsufficientFunds)?;
        require!(
            pool_after >= Rent::get()?.minimum_balance(pool_ai.data_len()),
            EscrowError::InsufficientFunds
        );

        **pool_ai.try_borrow_mut_lamports()? = pool_after;
        **provider_ai.try_borrow_mut_lamports()? = provider_ai
            .lamports()
            .checked_add(reward_payout)
            .ok_or(EscrowError::InsufficientFunds)?;

        let receipt = &mut ctx.accounts.epoch_claim;
        receipt.epoch_id = epoch_id;
        receipt.provider = ctx.accounts.provider_wallet.key();
        receipt.bytes_verified = provider_bytes_verified;
        receipt.reward_lamports = reward_payout;
        receipt.claimed_at = Clock::get()?.unix_timestamp;
        receipt.bump = ctx.bumps.epoch_claim;

        pool.remaining_emission_lamports = pool.remaining_emission_lamports.saturating_sub(reward_payout);
        pool.settled_providers_count = pool.settled_providers_count.saturating_add(1);

        emit!(BandwidthRewardClaimedEvent {
            epoch_id,
            provider: ctx.accounts.provider_wallet.key(),
            bytes_verified: provider_bytes_verified,
            reward_lamports: reward_payout,
        });

        msg!(
            "Bandwidth reward claimed: epoch={}, provider={}, bytes={}, reward={}",
            epoch_id,
            ctx.accounts.provider_wallet.key(),
            provider_bytes_verified,
            reward_payout
        );
        Ok(())
    }

    // =========================================================================
    // LISTING COMMITMENT (Wave 5.C.5)
    //
    // Anchors an off-chain listing_offer_hash on-chain. Not a full catalog PDA.
    // PDA seeds: ["listing-commitment", provider_pubkey, offer_hash].
    // Oracle pays rent (same pattern as ProviderRegistry).
    // =========================================================================

    /// Register a listing offer-hash commitment PDA.
    pub fn register_listing_commitment(
        ctx: Context<RegisterListingCommitment>,
        provider: Pubkey,
        offer_hash: [u8; 32],
        listing_id: [u8; 16],
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);
        require!(ctx.accounts.oracle.key() == state.admin, EscrowError::Unauthorized);
        require!(offer_hash != [0u8; 32], EscrowError::InvalidStatus);

        let commitment = &mut ctx.accounts.listing_commitment;
        let clock = Clock::get()?;

        commitment.provider = provider;
        commitment.offer_hash = offer_hash;
        commitment.listing_id = listing_id;
        commitment.is_active = true;
        commitment.registered_at = clock.unix_timestamp;
        commitment.bump = ctx.bumps.listing_commitment;

        emit!(ListingCommitmentRegistered {
            commitment: commitment.key(),
            provider,
            offer_hash,
            listing_id,
        });

        msg!("Listing commitment registered for provider {}", provider);
        Ok(())
    }

    /// Mark a listing commitment inactive (delist / supersede). Does not close the account.
    pub fn deactivate_listing_commitment(
        ctx: Context<DeactivateListingCommitment>,
        _provider: Pubkey,
        _offer_hash: [u8; 32],
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);
        require!(ctx.accounts.oracle.key() == state.admin, EscrowError::Unauthorized);

        let commitment = &mut ctx.accounts.listing_commitment;
        commitment.is_active = false;

        emit!(ListingCommitmentDeactivated {
            commitment: commitment.key(),
            provider: commitment.provider,
            offer_hash: commitment.offer_hash,
        });

        msg!("Listing commitment deactivated");
        Ok(())
    }

    // =========================================================================
    // KYC ATTESTATION
    // =========================================================================

    /// Write (or overwrite) an on-chain KYC attestation for a user wallet.
    ///
    /// Only the oracle signer may call this.  The instruction is idempotent:
    /// if an attestation already exists for the wallet it is updated in-place;
    /// otherwise a new PDA is initialised (init_if_needed).
    ///
    /// trust_tier: 0=new, 1=verified, 2=premium
    /// kyc_status: 0=none, 1=pending, 2=approved, 3=rejected
    pub fn write_kyc_attestation(
        ctx: Context<WriteKYCAttestation>,
        wallet: Pubkey,
        trust_tier: u8,
        kyc_status: u8,
    ) -> Result<()> {
        require!(!ctx.accounts.program_state.paused, EscrowError::ProgramPaused);
        // BC-05: only program admin/oracle may write KYC attestations.
        require!(
            ctx.accounts.oracle.key() == ctx.accounts.program_state.admin,
            EscrowError::Unauthorized
        );
        require!(trust_tier <= 2, EscrowError::InvalidStatus);
        require!(kyc_status <= 3, EscrowError::InvalidStatus);

        let clock = Clock::get()?;
        let att = &mut ctx.accounts.attestation;

        att.wallet = wallet;
        att.oracle = ctx.accounts.oracle.key();
        att.trust_tier = trust_tier;
        att.kyc_status = kyc_status;
        att.attested_at = clock.unix_timestamp;
        att.bump = ctx.bumps.attestation;

        emit!(KYCAttestationWritten {
            wallet,
            oracle: att.oracle,
            trust_tier,
            kyc_status,
            attested_at: att.attested_at,
        });

        msg!("KYC attestation written for wallet {} tier={} status={}", wallet, trust_tier, kyc_status);
        Ok(())
    }

    // =========================================================================
    // SESSION COMMITMENT (METER-002)
    // =========================================================================

    /// Lock session parameters on-chain at session creation time.
    /// The edge gateway verifies bandwidth_limit_bytes against this PDA to
    /// prevent server-side tampering of session limits mid-flight.
    pub fn lock_session_commitment(
        ctx: Context<LockSessionCommitment>,
        session_id: [u8; 16],
        buyer_wallet: Pubkey,
        seller_wallet: Pubkey,
        bandwidth_limit_bytes: u64,
        price_per_gb_lamports: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.program_state.paused, EscrowError::ProgramPaused);
        require!(bandwidth_limit_bytes > 0, EscrowError::InvalidStatus);

        let clock = Clock::get()?;
        let c = &mut ctx.accounts.session_commitment;

        c.session_id = session_id;
        c.buyer_wallet = buyer_wallet;
        c.seller_wallet = seller_wallet;
        c.bandwidth_limit_bytes = bandwidth_limit_bytes;
        c.price_per_gb_lamports = price_per_gb_lamports;
        c.locked_at = clock.unix_timestamp;
        c.bump = ctx.bumps.session_commitment;

        emit!(SessionCommitmentLocked {
            session_id,
            buyer_wallet,
            seller_wallet,
            bandwidth_limit_bytes,
            price_per_gb_lamports,
            locked_at: c.locked_at,
        });

        msg!("Session commitment locked: {:?}", session_id);
        Ok(())
    }

    // =========================================================================
    // SESSION ESCROW (Phase 1b prepaid PAYG)
    // =========================================================================

    /// Initialize a funded session escrow PDA. Buyer pays rent + locks `amount` lamports.
    pub fn initialize_session_escrow(
        ctx: Context<InitializeSessionEscrow>,
        session_id: [u8; 16],
        amount: u64,
        bandwidth_limit_bytes: u64,
        price_per_gb_lamports: u64,
        expires_at: i64,
    ) -> Result<()> {
        require!(!ctx.accounts.program_state.paused, EscrowError::ProgramPaused);
        require!(amount > 0, EscrowError::InsufficientFunds);
        require!(bandwidth_limit_bytes > 0, EscrowError::InvalidStatus);

        let clock = Clock::get()?;
        require!(expires_at > clock.unix_timestamp, EscrowError::InvalidStatus);

        let buyer_key = ctx.accounts.buyer.key();
        let seller_key = ctx.accounts.seller.key();
        let escrow_key = ctx.accounts.session_escrow.key();
        let buyer_info = ctx.accounts.buyer.to_account_info();
        let escrow_info = ctx.accounts.session_escrow.to_account_info();
        let system_program_info = ctx.accounts.system_program.to_account_info();

        let escrow = &mut ctx.accounts.session_escrow;
        escrow.session_id = session_id;
        escrow.buyer = buyer_key;
        escrow.seller = seller_key;
        escrow.amount = amount;
        escrow.bandwidth_limit_bytes = bandwidth_limit_bytes;
        escrow.bytes_used = 0;
        escrow.price_per_gb_lamports = price_per_gb_lamports;
        escrow.status = EscrowStatus::Active;
        escrow.created_at = clock.unix_timestamp;
        escrow.expires_at = expires_at;
        escrow.bump = ctx.bumps.session_escrow;

        let cpi_context = CpiContext::new(
            system_program_info,
            system_program::Transfer {
                from: buyer_info,
                to: escrow_info,
            },
        );
        system_program::transfer(cpi_context, amount)?;

        emit!(SessionEscrowInitialized {
            session_escrow: escrow_key,
            session_id,
            buyer: buyer_key,
            seller: seller_key,
            amount,
            bandwidth_limit_bytes,
            expires_at,
        });

        msg!(
            "Session escrow initialized: {} amount={} session={:?}",
            escrow_key,
            amount,
            session_id
        );
        Ok(())
    }

    /// Settle session escrow pro-rata by bytes_used. Oracle (program admin) only.
    /// Seller receives billed share; buyer receives unused escrow + rent (account closed).
    pub fn settle_session_escrow(
        ctx: Context<SettleSessionEscrow>,
        bytes_used: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.program_state.paused, EscrowError::ProgramPaused);

        let escrow = &mut ctx.accounts.session_escrow;
        require!(
            escrow.status == EscrowStatus::Pending || escrow.status == EscrowStatus::Active,
            EscrowError::InvalidStatus
        );

        let clock = Clock::get()?;
        // Allow settle after expiry (refund unused); block only if never funded.
        let _ = clock;

        let (seller_payout, buyer_refund) = compute_session_escrow_payout(
            escrow.amount,
            bytes_used,
            escrow.bandwidth_limit_bytes,
        );

        escrow.bytes_used = bytes_used;
        escrow.status = EscrowStatus::Settled;

        let session_id = escrow.session_id;
        let escrow_key = escrow.key();

        if seller_payout > 0 {
            **escrow.to_account_info().try_borrow_mut_lamports()? -= seller_payout;
            **ctx.accounts.seller.try_borrow_mut_lamports()? += seller_payout;
        }

        // Remaining lamports (buyer_refund + rent) go to buyer via `close = buyer`.
        let _ = buyer_refund;

        emit!(SessionEscrowSettled {
            session_escrow: escrow_key,
            session_id,
            seller_payout,
            buyer_refund,
            bytes_used,
        });

        msg!(
            "Session escrow settled: {} seller={} refund={}",
            escrow_key,
            seller_payout,
            buyer_refund
        );
        Ok(())
    }

    // =========================================================================
    // GOVERNANCE (GOV-001/002/003)
    // =========================================================================

    /// Create an on-chain governance proposal.  Oracle pays rent, but the
    /// proposer's wallet is recorded for accountability.
    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        proposal_id: [u8; 16],
        proposer: Pubkey,
        title_hash: [u8; 32],
        end_slot: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.program_state.paused, EscrowError::ProgramPaused);

        let clock = Clock::get()?;
        let p = &mut ctx.accounts.proposal;

        p.proposal_id = proposal_id;
        p.proposer = proposer;
        p.title_hash = title_hash;
        p.vote_yes = 0;
        p.vote_no = 0;
        p.status = 0; // active
        p.end_slot = end_slot;
        p.created_at = clock.unix_timestamp;
        p.bump = ctx.bumps.proposal;

        emit!(ProposalCreated {
            proposal_pda: ctx.accounts.proposal.key(),
            proposer,
            title_hash,
            end_slot,
        });

        msg!("Governance proposal created: {:?}", proposal_id);
        Ok(())
    }

    /// Cast an on-chain governance vote.  The voter signs the transaction
    /// directly — the server cannot forge votes on their behalf.
    ///
    /// `voting_power` remains in the instruction IDL for compatibility but is
    /// **ignored**. Weight is fixed at 1 (one wallet = one vote) until a
    /// stake/token CPI can prove voting power on-chain. Clients cannot inflate
    /// yes/no totals by editing the unsigned transaction.
    pub fn cast_governance_vote(
        ctx: Context<CastGovernanceVote>,
        vote_yes: bool,
        _voting_power: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.program_state.paused, EscrowError::ProgramPaused);

        let clock = Clock::get()?;
        let current_slot = clock.slot;
        let proposal = &mut ctx.accounts.proposal;

        // Voting must be open.
        require!(proposal.status == 0, EscrowError::InvalidStatus);
        require!(current_slot <= proposal.end_slot, EscrowError::Expired);

        // One wallet = one vote (client-supplied weight is discarded).
        let voting_power: u64 = 1;

        // Record the immutable vote.
        let vote = &mut ctx.accounts.governance_vote;
        vote.proposal = proposal.key();
        vote.voter = ctx.accounts.voter.key();
        vote.vote_yes = vote_yes;
        vote.voting_power = voting_power;
        vote.voted_at = clock.unix_timestamp;
        vote.bump = ctx.bumps.governance_vote;

        // Accumulate into proposal totals.
        if vote_yes {
            proposal.vote_yes = proposal.vote_yes.saturating_add(voting_power);
        } else {
            proposal.vote_no = proposal.vote_no.saturating_add(voting_power);
        }

        emit!(VoteCast {
            proposal_pda: proposal.key(),
            voter: vote.voter,
            vote_yes,
            voting_power,
        });

        Ok(())
    }

    /// Finalize a proposal once its end_slot has passed.  Permissionless —
    /// anyone can call this.  Sets status to passed (1) or rejected (2).
    pub fn finalize_proposal(ctx: Context<FinalizeProposal>) -> Result<()> {
        let clock = Clock::get()?;
        let proposal = &mut ctx.accounts.proposal;

        require!(proposal.status == 0, EscrowError::InvalidStatus); // still active
        require!(clock.slot > proposal.end_slot, EscrowError::NotExpired);

        let new_status = if proposal.vote_yes > proposal.vote_no { 1u8 } else { 2u8 };
        proposal.status = new_status;

        emit!(ProposalFinalized {
            proposal_pda: proposal.key(),
            status: new_status,
            vote_yes: proposal.vote_yes,
            vote_no: proposal.vote_no,
        });

        msg!("Proposal finalized with status {}", new_status);
        Ok(())
    }

    /// Execute a passed governance proposal.  Only the admin can execute, and
    /// the proposal must have status 1 (passed).  A minimum timelock of 24 hours
    /// (172 800 slots @ ~400ms) after finalization is enforced.
    ///
    /// Status transitions: 1 (passed) → 3 (executed).
    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        require!(!ctx.accounts.program_state.paused, EscrowError::ProgramPaused);

        let proposal = &mut ctx.accounts.proposal;
        require!(proposal.status == 1, EscrowError::InvalidStatus); // must be passed

        // Enforce 24-hour timelock (≈172 800 slots at 400ms/slot).
        // Since we only stored end_slot (when voting closed), the timelock is
        // measured from end_slot rather than a separate finalization timestamp.
        let clock = Clock::get()?;
        let timelock_slots: u64 = 172_800; // ~24 hours
        require!(
            clock.slot >= proposal.end_slot.saturating_add(timelock_slots),
            EscrowError::NotExpired
        );

        proposal.status = 3; // executed

        emit!(ProposalExecuted {
            proposal_pda: proposal.key(),
            executed_by: ctx.accounts.admin.key(),
            executed_at: clock.unix_timestamp,
        });

        msg!("Proposal executed by admin {}", ctx.accounts.admin.key());
        Ok(())
    }

    // =========================================================================
    // DISPUTE / JURY (DISP-001/002/003/004)
    // =========================================================================

    /// Open a dispute on-chain.  The slot_seed (recent slot hash bytes as u64)
    /// is used as a VRF seed for jury selection — the server cannot control it.
    pub fn open_dispute_onchain(
        ctx: Context<OpenDisputeOnchain>,
        reason_hash: [u8; 32],
        slot_seed: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.program_state.paused, EscrowError::ProgramPaused);

        let dispute = &mut ctx.accounts.dispute_record;
        dispute.bump = ctx.bumps.dispute_record;

        emit!(DisputeOpened {
            dispute_pda: dispute.key(),
            escrow: ctx.accounts.escrow.key(),
            reason_hash,
            slot_seed,
        });

        msg!("Dispute opened on-chain with slot_seed={}", slot_seed);
        Ok(())
    }

    /// Cast an immutable jury vote.  The juror signs directly.
    pub fn cast_jury_vote_onchain(
        ctx: Context<CastJuryVoteOnchain>,
        vote_buyer: bool,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let vote = &mut ctx.accounts.jury_vote;

        vote.dispute = ctx.accounts.dispute.key();
        vote.juror = ctx.accounts.juror.key();
        vote.vote_buyer = vote_buyer;
        vote.voted_at = clock.unix_timestamp;
        vote.bump = ctx.bumps.jury_vote;

        emit!(DisputeJuryVoteCast {
            dispute_pda: vote.dispute,
            juror: vote.juror,
            vote_buyer,
        });

        Ok(())
    }

    // =========================================================================
    // ADMIN ATTESTATION (AUTH-001/007)
    // =========================================================================

    /// Write an admin attestation PDA for a wallet.  Only the program admin
    /// (program_state.admin) can call this.
    pub fn write_admin_attestation(
        ctx: Context<WriteAdminAttestation>,
        wallet: Pubkey,
        role: u8,
    ) -> Result<()> {
        require!(role <= 2, EscrowError::InvalidStatus);
        require!(
            ctx.accounts.admin.key() == ctx.accounts.program_state.admin,
            EscrowError::Unauthorized
        );

        let clock = Clock::get()?;
        let att = &mut ctx.accounts.attestation;

        att.admin_wallet = wallet;
        att.oracle = ctx.accounts.admin.key();
        att.role = role;
        att.attested_at = clock.unix_timestamp;
        att.bump = ctx.bumps.attestation;

        emit!(AdminAttestationWritten {
            admin_wallet: wallet,
            role,
            attested_at: att.attested_at,
        });

        msg!("Admin attestation written for wallet {} role={}", wallet, role);
        Ok(())
    }

    // =========================================================================
    // PROGRAM CONFIG (CONFIG-001/002)
    // =========================================================================

    /// Initialize or update on-chain program configuration.
    /// Requires multisig oracle to prevent single-point-of-control.
    pub fn update_program_config(
        ctx: Context<UpdateProgramConfig>,
        kyc_min_sol_lamports: u64,
        platform_fee_bps: u16,
        max_daily_spend_lamports: u64,
        max_session_bw_bytes: u64,
        unstake_cooldown_seconds: i64,
    ) -> Result<()> {
        require!(platform_fee_bps <= 5000, EscrowError::InvalidPercentage); // max 50%

        let clock = Clock::get()?;
        let cfg = &mut ctx.accounts.program_config;

        cfg.kyc_min_sol_lamports = kyc_min_sol_lamports;
        cfg.platform_fee_bps = platform_fee_bps;
        cfg.max_daily_spend_lamports = max_daily_spend_lamports;
        cfg.max_session_bw_bytes = max_session_bw_bytes;
        cfg.unstake_cooldown_seconds = unstake_cooldown_seconds;
        cfg.updated_at = clock.unix_timestamp;
        cfg.bump = ctx.bumps.program_config;

        emit!(ProgramConfigUpdated {
            kyc_min_sol_lamports,
            platform_fee_bps,
            updated_at: cfg.updated_at,
        });

        msg!("Program config updated: kyc_min={}, fee_bps={}, cooldown={}", kyc_min_sol_lamports, platform_fee_bps, unstake_cooldown_seconds);
        Ok(())
    }

    // =========================================================================
    // REVIEW ATTESTATION (REP-001)
    // =========================================================================

    /// Submit an immutable review attestation for a completed order.
    /// The rating_hash is SHA-256(rating || comment || review_id) — the plaintext
    /// stays in the DB; the on-chain hash makes it tamper-evident.
    pub fn submit_review_attestation(
        ctx: Context<SubmitReviewAttestation>,
        order_escrow_pda: Pubkey,
        reviewer: Pubkey,
        rating_hash: [u8; 32],
    ) -> Result<()> {
        let clock = Clock::get()?;
        let rev = &mut ctx.accounts.review_attestation;

        rev.order_escrow_pda = order_escrow_pda;
        rev.reviewer = reviewer;
        rev.rating_hash = rating_hash;
        rev.attested_at = clock.unix_timestamp;
        rev.bump = ctx.bumps.review_attestation;

        emit!(ReviewAttested {
            order_escrow_pda,
            reviewer,
            rating_hash,
            attested_at: rev.attested_at,
        });

        msg!("Review attested for escrow {}", order_escrow_pda);
        Ok(())
    }

    // =========================================================================
    // SPENDING EVENT LOG (AUTH-006)
    // =========================================================================

    /// Emit an on-chain event for high-value spending operations.
    /// Uses events (not persistent accounts) to keep cost minimal.
    /// op_type: 0=withdraw, 1=p2p_transfer, 2=session_charge
    pub fn log_spending_event(
        ctx: Context<LogSpendingEvent>,
        wallet: Pubkey,
        amount_lamports: u64,
        op_type: u8,
    ) -> Result<()> {
        let clock = Clock::get()?;

        emit!(SpendingEventLogged {
            wallet,
            amount_lamports,
            op_type,
            logged_at: clock.unix_timestamp,
        });

        // Silence unused ctx warning
        let _ = &ctx.accounts.oracle;

        msg!("Spending event logged: wallet={} amount={} op={}", wallet, amount_lamports, op_type);
        Ok(())
    }

    // =========================================================================
    // ZK BATCH SETTLEMENT — Layer 2 Phase 4
    //
    // submit_zk_batch: oracle commits the Merkle root of N session proofs to
    // an immutable PDA.  One Solana TX replaces N individual submit_usage_proof
    // TXes for high-throughput settlement.
    //
    // In Phase 5 / full BC-11 the proof_bytes field will carry a Halo2 (or
    // Groth16) proof verified on-chain. Today proof_hash is an oracle-attested
    // SHA-256 of an optional off-chain proof blob — not on-chain ZK verify.
    // Sprint B gate: PROXYHUB_ZK_ONCHAIN_GROTH16 (default false) — see
    // docs/ops/BC11_GROTH16_PATH.md. Do not claim trustless verification.
    //
    // For Phase 4 the root is a SHA-256 Merkle commitment (auditable off-chain).
    //
    // PDA seeds: [b"zk_batch", batch_root (32 bytes)]
    /// `proof_hash`    — SHA-256 of the off-chain ZK proof blob.  Set to all-zeros
    ///                   when no off-chain proof was attached. Non-zero means the
    ///                   oracle attested it produced/verified that blob off-chain;
    ///                   Solana does not yet verify Halo2 inside this instruction.
    pub fn submit_zk_batch(
        ctx: Context<SubmitZKBatch>,
        batch_root: [u8; 32],
        session_count: u32,
        total_bytes: u64,
        period_start: i64,
        period_end: i64,
        proof_hash: [u8; 32],
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);
        require!(ctx.accounts.oracle.key() == state.admin, EscrowError::Unauthorized);

        require!(session_count > 0, EscrowError::InsufficientFunds);
        require!(total_bytes > 0, EscrowError::InsufficientFunds);

        let current_index = anchor_lang::solana_program::sysvar::instructions::load_current_index_checked(
            &ctx.accounts.instructions,
        ).map_err(|_| error!(EscrowError::InvalidSignatureVerification))?;

        if current_index == 0 {
            return err!(EscrowError::MissingSignatureVerification);
        }

        let preceding_ix = anchor_lang::solana_program::sysvar::instructions::load_instruction_at_checked(
            (current_index - 1) as usize,
            &ctx.accounts.instructions,
        ).map_err(|_| error!(EscrowError::MissingSignatureVerification))?;

        let ed25519_program_id = pubkey!("Ed25519SigVerify111111111111111111111111111");
        if preceding_ix.program_id != ed25519_program_id {
            return err!(EscrowError::MissingSignatureVerification);
        }

        let data = preceding_ix.data;
        if data.len() < 16 {
            return err!(EscrowError::InvalidSignatureVerification);
        }

        let num_sigs = data[0];
        if num_sigs < 1 {
            return err!(EscrowError::InvalidSignatureVerification);
        }

        let signature_offset = u16::from_le_bytes([data[2], data[3]]) as usize;
        let signature_inst_idx = u16::from_le_bytes([data[4], data[5]]);
        let public_key_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
        let public_key_inst_idx = u16::from_le_bytes([data[8], data[9]]);
        let message_data_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
        let message_data_size = u16::from_le_bytes([data[12], data[13]]) as usize;
        let message_inst_idx = u16::from_le_bytes([data[14], data[15]]);

        if signature_inst_idx != 0xffff || public_key_inst_idx != 0xffff || message_inst_idx != 0xffff {
            return err!(EscrowError::InvalidSignatureVerification);
        }

        if public_key_offset + 32 > data.len() || signature_offset + 64 > data.len() || message_data_offset + message_data_size > data.len() {
            return err!(EscrowError::InvalidSignatureVerification);
        }

        let pubkey_bytes = &data[public_key_offset..public_key_offset + 32];
        let oracle_key = ctx.accounts.oracle.key().to_bytes();
        if pubkey_bytes != oracle_key {
            return err!(EscrowError::InvalidSignatureVerification);
        }

        if message_data_size != 32 {
            return err!(EscrowError::InvalidSignatureVerification);
        }
        let msg_bytes = &data[message_data_offset..message_data_offset + 32];
        if msg_bytes != batch_root {
            return err!(EscrowError::InvalidSignatureVerification);
        }

        let batch = &mut ctx.accounts.zk_batch;
        let clock = Clock::get()?;

        batch.batch_root    = batch_root;
        batch.session_count = session_count;
        batch.total_bytes   = total_bytes;
        batch.period_start  = period_start;
        batch.period_end    = period_end;
        batch.submitted_at  = clock.unix_timestamp;
        batch.proof_hash    = proof_hash;
        batch.bump          = ctx.bumps.zk_batch;

        msg!("submit_zk_batch: root={:?} sessions={} bytes={} proof_hash={:?} window=[{},{}]",
            batch_root, session_count, total_bytes, proof_hash, period_start, period_end
        );
        Ok(())
    }

    // =========================================================================
    // ZK BATCH — Groth16 on-chain path (BC-11-B)
    //
    // With Cargo feature `onchain-groth16`:
    //   1. Require vk_hash == embedded batch VK hash
    //   2. Bind public input = Fr(SHA256(root‖count‖bytes‖window))
    //   3. Verify BN254 Groth16 via alt_bn128 (groth16-solana)
    //   4. Init ZKBatchPDA (same seeds as submit_zk_batch)
    //
    // Without the feature: always errors (OnchainGroth16Disabled).
    // Control-api still gates live sends behind PROXYHUB_ZK_ONCHAIN_GROTH16_READY.
    // See docs/ops/BC11_GROTH16_PATH.md.
    // =========================================================================
    pub fn submit_zk_batch_groth16(
        ctx: Context<SubmitZKBatchGroth16>,
        batch_root: [u8; 32],
        session_count: u32,
        total_bytes: u64,
        period_start: i64,
        period_end: i64,
        leaves_hash: [u8; 32],
        proof_hash: [u8; 32],
        vk_hash: [u8; 32],
        proof: [u8; 256],
    ) -> Result<()> {
        let state = &ctx.accounts.program_state;
        require!(!state.paused, EscrowError::ProgramPaused);
        require!(ctx.accounts.oracle.key() == state.admin, EscrowError::Unauthorized);
        require!(session_count > 0, EscrowError::InsufficientFunds);
        require!(total_bytes > 0, EscrowError::InsufficientFunds);
        require!(batch_root != [0u8; 32], EscrowError::InvalidStatus);
        require!(leaves_hash != [0u8; 32], EscrowError::InvalidStatus);
        require!(proof_hash != [0u8; 32], EscrowError::InvalidSignatureVerification);

        #[cfg(not(feature = "onchain-groth16"))]
        {
            let _ = (period_start, period_end, leaves_hash, vk_hash, proof, &ctx);
            msg!("submit_zk_batch_groth16: DISABLED (build without onchain-groth16)");
            return err!(EscrowError::OnchainGroth16Disabled);
        }

        #[cfg(feature = "onchain-groth16")]
        {
            require!(
                vk_hash == groth16_batch::expected_vk_hash(),
                EscrowError::Groth16VkHashMismatch
            );
            let vk_acct = ctx.accounts.groth16_vk.try_borrow_data()?;
            // Exact 32-byte pin account only — longer accounts (e.g. program_state
            // used as a inert placeholder) are ignored; ix vk_hash still binds.
            if vk_acct.len() == 32 {
                require!(
                    vk_acct[..] == groth16_batch::expected_vk_hash(),
                    EscrowError::Groth16VkHashMismatch
                );
            }
            drop(vk_acct);

            // Prefer ix `proof` bytes; fall back to 256-byte proof account data.
            let proof_bytes: [u8; 256] = {
                let acct = ctx.accounts.groth16_proof.try_borrow_data()?;
                if acct.len() == groth16_batch::PROOF_LEN {
                    let mut b = [0u8; 256];
                    b.copy_from_slice(&acct);
                    b
                } else {
                    proof
                }
            };

            let public_input = groth16_batch::batch_digest_public_input(
                &batch_root,
                session_count,
                total_bytes,
                period_start,
                period_end,
                &leaves_hash,
            );
            groth16_batch::verify_batch_proof(&proof_bytes, &public_input)
                .map_err(|_| error!(EscrowError::Groth16VerificationFailed))?;

            let batch = &mut ctx.accounts.zk_batch;
            let clock = Clock::get()?;
            batch.batch_root = batch_root;
            batch.session_count = session_count;
            batch.total_bytes = total_bytes;
            batch.period_start = period_start;
            batch.period_end = period_end;
            batch.submitted_at = clock.unix_timestamp;
            batch.proof_hash = proof_hash;
            batch.bump = ctx.bumps.zk_batch;

            msg!(
                "submit_zk_batch_groth16: OK root={:?} sessions={} bytes={} window=[{},{}]",
                batch_root,
                session_count,
                total_bytes,
                period_start,
                period_end
            );
            Ok(())
        }
    }

    // =========================================================================
    // STATE CHANNEL — Layer 2 groundwork
    //
    // open_channel:  buyer locks SOL into a PDA vault for off-chain micropayments.
    // close_channel: oracle submits the final signed state; vault pays provider
    //                for earned bytes and refunds unspent SOL to buyer.
    //
    // PDA seeds: [b"state_channel", session_id (16 bytes)]
    // =========================================================================

    /// Open a state channel: buyer transfers `deposit_lamports` into the channel
    /// PDA vault.  The oracle records buyer+provider pubkeys and the session UUID.
    pub fn open_channel(
        ctx: Context<OpenChannel>,
        session_id: [u8; 16],
        deposit_lamports: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.program_state.paused, EscrowError::ProgramPaused);
        require!(deposit_lamports > 0, EscrowError::InsufficientFunds);

        let buyer_key = ctx.accounts.buyer.key();
        let provider_key = ctx.accounts.provider_wallet.key();
        let buyer_info = ctx.accounts.buyer.to_account_info();
        let channel_info = ctx.accounts.channel.to_account_info();
        let system_program_info = ctx.accounts.system_program.to_account_info();
        let ch = &mut ctx.accounts.channel;
        let clock = Clock::get()?;

        ch.session_id      = session_id;
        ch.buyer           = buyer_key;
        ch.provider        = provider_key;
        ch.deposit_lamports = deposit_lamports;
        ch.spent_lamports  = 0;
        ch.nonce           = 0;
        ch.opened_at       = clock.unix_timestamp;
        // Default TTL: 86 400 seconds (24 h)
        ch.expires_at      = clock.unix_timestamp + 86_400;
        ch.is_closed       = false;
        ch.bump            = ctx.bumps.channel;

        // Transfer deposit from buyer to the channel PDA (rent-exempt vault).
        let cpi_ctx = CpiContext::new(
            system_program_info,
            system_program::Transfer {
                from: buyer_info,
                to:   channel_info,
            },
        );
        system_program::transfer(cpi_ctx, deposit_lamports)?;

        msg!("open_channel: session={:?} deposit={} buyer={} provider={}",
            session_id, deposit_lamports, ch.buyer, ch.provider);
        Ok(())
    }

    /// Close a state channel: oracle submits the final nonce + earned_lamports.
    /// `earned_lamports` is paid to the provider; remainder refunded to buyer.
    /// The channel PDA is closed (rent returned to oracle).
    pub fn close_channel(
        ctx: Context<CloseChannel>,
        session_id: [u8; 16],
        final_nonce: u64,
        earned_lamports: u64,
    ) -> Result<()> {
        let ch = &mut ctx.accounts.channel;

        require!(!ch.is_closed, EscrowError::InvalidStatus);
        require!(ch.session_id == session_id, EscrowError::Unauthorized);
        require!(final_nonce >= ch.nonce, EscrowError::InvalidStatus);
        require!(earned_lamports <= ch.deposit_lamports, EscrowError::InsufficientFunds);

        let clock = Clock::get()?;
        // Allow forced closure if channel has expired (no nonce check).
        if clock.unix_timestamp < ch.expires_at {
            // Within TTL — oracle must provide a valid nonce advancement.
            require!(final_nonce > ch.nonce || earned_lamports == 0, EscrowError::InvalidStatus);
        }

        // =====================================================================
        // MULTISIG SIGNATURE AGGREGATION CHECK
        // =====================================================================
        let multisig = &ctx.accounts.multisig_oracle;
        let threshold = multisig.threshold as usize;
        let oracle_signers = &multisig.signers;

        let current_index = anchor_lang::solana_program::sysvar::instructions::load_current_index_checked(
            &ctx.accounts.instructions,
        ).map_err(|_| error!(EscrowError::MissingSignatureVerification))?;

        require!(
            current_index >= threshold as u16,
            EscrowError::MissingSignatureVerification
        );

        let ed25519_program_id = pubkey!("Ed25519SigVerify111111111111111111111111111");

        // Format hyphenated UUID representation
        let session_id_str = format!(
            "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
            session_id[0], session_id[1], session_id[2], session_id[3],
            session_id[4], session_id[5],
            session_id[6], session_id[7],
            session_id[8], session_id[9],
            session_id[10], session_id[11], session_id[12], session_id[13], session_id[14], session_id[15]
        );

        let msg = format!(
            "close:{}:{}:{}:{}",
            session_id_str,
            final_nonce,
            earned_lamports,
            multisig.nonce,
        );
        let msg_bytes = msg.as_bytes();

        let mut verified_signers = Vec::new();

        for i in 0..threshold {
            let verify_ix_idx = (current_index as usize) - threshold + i;
            let preceding_ix = anchor_lang::solana_program::sysvar::instructions::load_instruction_at_checked(
                verify_ix_idx,
                &ctx.accounts.instructions,
            ).map_err(|_| error!(EscrowError::MissingSignatureVerification))?;

            require!(
                preceding_ix.program_id == ed25519_program_id,
                EscrowError::MissingSignatureVerification
            );

            let data = preceding_ix.data;
            require!(data.len() >= 16, EscrowError::InvalidSignatureVerification);

            let num_sigs = data[0];
            require!(num_sigs >= 1, EscrowError::InvalidSignatureVerification);

            let signature_offset = u16::from_le_bytes([data[2], data[3]]) as usize;
            let signature_inst_idx = u16::from_le_bytes([data[4], data[5]]);
            let public_key_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
            let public_key_inst_idx = u16::from_le_bytes([data[8], data[9]]);
            let message_data_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
            let message_data_size = u16::from_le_bytes([data[12], data[13]]) as usize;
            let message_inst_idx = u16::from_le_bytes([data[14], data[15]]);

            require!(
                signature_inst_idx == 0xffff && public_key_inst_idx == 0xffff && message_inst_idx == 0xffff,
                EscrowError::InvalidSignatureVerification
            );

            require!(
                public_key_offset + 32 <= data.len() &&
                signature_offset + 64 <= data.len() &&
                message_data_offset + message_data_size <= data.len(),
                EscrowError::InvalidSignatureVerification
            );

            let pubkey_bytes = &data[public_key_offset..public_key_offset + 32];
            let signer_pubkey = Pubkey::new_from_array(pubkey_bytes.try_into().unwrap());
            
            require!(
                multisig.signers.contains(&signer_pubkey),
                EscrowError::InvalidOracleSignature
            );
            require!(
                oracle_signers.contains(&signer_pubkey),
                EscrowError::InvalidOracleSignature
            );
            require!(
                !verified_signers.contains(&signer_pubkey),
                EscrowError::DuplicateSignature
            );
            verified_signers.push(signer_pubkey);

            require!(
                message_data_size == msg_bytes.len(),
                EscrowError::InvalidSignatureVerification
            );
            let parsed_msg = &data[message_data_offset..message_data_offset + message_data_size];
            require!(parsed_msg == msg_bytes, EscrowError::InvalidSignatureVerification);
        }

        ch.spent_lamports = earned_lamports;
        ch.nonce          = final_nonce;
        ch.is_closed      = true;

        let refund = ch.deposit_lamports.saturating_sub(earned_lamports);

        // Pay provider their earned amount.
        if earned_lamports > 0 {
            **ctx.accounts.channel.to_account_info().try_borrow_mut_lamports()? =
                ctx.accounts.channel.to_account_info().lamports()
                    .checked_sub(earned_lamports)
                    .ok_or(EscrowError::InsufficientFunds)?;
            **ctx.accounts.provider_wallet.try_borrow_mut_lamports()? =
                ctx.accounts.provider_wallet.lamports()
                    .checked_add(earned_lamports)
                    .ok_or(EscrowError::InsufficientFunds)?;
        }

        // Refund unspent SOL to buyer.
        if refund > 0 {
            **ctx.accounts.channel.to_account_info().try_borrow_mut_lamports()? =
                ctx.accounts.channel.to_account_info().lamports()
                    .checked_sub(refund)
                    .ok_or(EscrowError::InsufficientFunds)?;
            **ctx.accounts.buyer.try_borrow_mut_lamports()? =
                ctx.accounts.buyer.lamports()
                    .checked_add(refund)
                    .ok_or(EscrowError::InsufficientFunds)?;
        }

        msg!("close_channel: session={:?} earned={} refund={} nonce={}",
            session_id, earned_lamports, refund, final_nonce);
        Ok(())
    }

    /// Execute a passed proposal to rotate a multisig oracle signer.
    pub fn execute_signer_rotation_proposal(
        ctx: Context<ExecuteSignerRotationProposal>,
        old_signer: Pubkey,
        new_signer: Pubkey,
    ) -> Result<()> {
        require!(!ctx.accounts.program_state.paused, EscrowError::ProgramPaused);

        let proposal = &mut ctx.accounts.proposal;
        require!(proposal.status == 1, EscrowError::ProposalNotPassed);

        let clock = Clock::get()?;
        let timelock_slots: u64 = 172_800; // ~24 hours
        require!(
            clock.slot >= proposal.end_slot.saturating_add(timelock_slots),
            EscrowError::TimelockNotExpired
        );

        let mut payload = Vec::with_capacity(13 + 32 + 32);
        payload.extend_from_slice(b"rotate_signer");
        payload.extend_from_slice(old_signer.as_ref());
        payload.extend_from_slice(new_signer.as_ref());

        let hash_result = solana_program::hash::hash(&payload).to_bytes();
        require!(hash_result == proposal.title_hash, EscrowError::InvalidProposalPayload);

        let multisig_oracle = &mut ctx.accounts.multisig_oracle;
        let position = multisig_oracle.signers.iter().position(|&x| x == old_signer);
        require!(position.is_some(), EscrowError::SignerNotFound);
        let idx = position.unwrap();

        require!(!multisig_oracle.signers.contains(&new_signer), EscrowError::DuplicateSignature);

        multisig_oracle.signers[idx] = new_signer;
        multisig_oracle.nonce = multisig_oracle.nonce.checked_add(1).ok_or(EscrowError::InvalidStatus)?;
        multisig_oracle.last_update = clock.unix_timestamp;
        proposal.status = 3; // executed

        msg!("Signer rotation proposal executed: old={} new={}", old_signer, new_signer);
        Ok(())
    }
}

// =============================================================================
// ACCOUNT VALIDATION STRUCTURES
// =============================================================================

// Provider Registry contexts — oracle signs all registry mutations.
// PDA seeds: ["provider-registry", provider_pubkey_bytes]

#[derive(Accounts)]
#[instruction(provider: Pubkey)]
pub struct RegisterProvider<'info> {
    #[account(
        init,
        payer = oracle,
        space = ProviderRegistry::LEN,
        seeds = [b"provider-registry", provider.as_ref()],
        bump
    )]
    pub provider_registry: Account<'info, ProviderRegistry>,
    #[account(mut)]
    pub oracle: Signer<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(provider: Pubkey)]
pub struct ProviderHeartbeat<'info> {
    #[account(
        mut,
        seeds = [b"provider-registry", provider.as_ref()],
        bump = provider_registry.bump,
    )]
    pub provider_registry: Account<'info, ProviderRegistry>,
    /// Oracle must be the current program admin.
    #[account(address = program_state.admin)]
    pub oracle: Signer<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
#[instruction(provider: Pubkey)]
pub struct DeregisterProvider<'info> {
    #[account(
        mut,
        seeds = [b"provider-registry", provider.as_ref()],
        bump = provider_registry.bump,
    )]
    pub provider_registry: Account<'info, ProviderRegistry>,
    /// Oracle must be the current program admin.
    #[account(address = program_state.admin)]
    pub oracle: Signer<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

// ── Gateway Registry Contexts (Track 2.1) ─────────────────────────────────────
// PDA seeds: ["gateway-registry", gateway_pubkey]

#[derive(Accounts)]
#[instruction(endpoint: String, stake_amount: u64, min_stake_lamports: u64)]
pub struct RegisterGateway<'info> {
    #[account(
        init,
        payer = owner,
        space = GatewayRegistry::LEN,
        seeds = [b"gateway-registry", gateway.key().as_ref()],
        bump
    )]
    pub gateway_registry: Account<'info, GatewayRegistry>,
    /// CHECK: The Gateway pubkey being registered
    pub gateway: AccountInfo<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GatewayHeartbeatCtx<'info> {
    #[account(
        mut,
        seeds = [b"gateway-registry", gateway.key().as_ref()],
        bump = gateway_registry.bump,
        has_one = gateway,
    )]
    pub gateway_registry: Account<'info, GatewayRegistry>,
    pub gateway: Signer<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
#[instruction(slash_amount: u64, reason_hash: [u8; 32])]
pub struct SlashGateway<'info> {
    #[account(
        mut,
        seeds = [b"gateway-registry", gateway_registry.gateway.as_ref()],
        bump = gateway_registry.bump,
    )]
    pub gateway_registry: Account<'info, GatewayRegistry>,
    /// CHECK: Protocol treasury destination for slashed funds
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    #[account(address = program_state.admin)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
pub struct DeregisterGateway<'info> {
    #[account(
        mut,
        seeds = [b"gateway-registry", gateway_registry.gateway.as_ref()],
        bump = gateway_registry.bump,
        has_one = owner,
        close = owner,
    )]
    pub gateway_registry: Account<'info, GatewayRegistry>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

// ── Proof-of-Bandwidth Mining Contexts (Track 4.1) ────────────────────────────
// PDA seeds: ["epoch-rewards", epoch_id.to_le_bytes()]

#[derive(Accounts)]
#[instruction(epoch_id: u64, total_emission_lamports: u64, total_bandwidth_verified: u64, duration_seconds: i64)]
pub struct InitializeEpochRewardPool<'info> {
    #[account(
        init,
        payer = authority,
        space = EpochRewardPool::LEN,
        seeds = [b"epoch-rewards", epoch_id.to_le_bytes().as_ref()],
        bump
    )]
    pub epoch_reward_pool: Account<'info, EpochRewardPool>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(epoch_id: u64, provider_bytes_verified: u64)]
pub struct ClaimBandwidthRewards<'info> {
    #[account(
        mut,
        seeds = [b"epoch-rewards", epoch_id.to_le_bytes().as_ref()],
        bump = epoch_reward_pool.bump,
    )]
    pub epoch_reward_pool: Account<'info, EpochRewardPool>,
    /// One receipt per provider per epoch; `init` makes a second claim fail.
    #[account(
        init,
        payer = oracle,
        space = EpochClaimReceipt::LEN,
        seeds = [b"epoch_claim", epoch_id.to_le_bytes().as_ref(), provider_wallet.key().as_ref()],
        bump
    )]
    pub epoch_claim: Account<'info, EpochClaimReceipt>,
    /// CHECK: reward recipient. It receives lamports only; the oracle attests the byte count.
    #[account(mut)]
    pub provider_wallet: AccountInfo<'info>,
    /// Program admin attesting `provider_bytes_verified`; also pays the receipt's rent.
    #[account(mut, address = program_state.admin)]
    pub oracle: Signer<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    pub system_program: Program<'info, System>,
}

// Listing commitment contexts — oracle signs mutations.
// PDA seeds: ["listing-commitment", provider_pubkey, offer_hash]

#[derive(Accounts)]
#[instruction(provider: Pubkey, offer_hash: [u8; 32])]
pub struct RegisterListingCommitment<'info> {
    #[account(
        init,
        payer = oracle,
        space = ListingCommitment::LEN,
        seeds = [b"listing-commitment", provider.as_ref(), offer_hash.as_ref()],
        bump
    )]
    pub listing_commitment: Account<'info, ListingCommitment>,
    #[account(mut)]
    pub oracle: Signer<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(provider: Pubkey, offer_hash: [u8; 32])]
pub struct DeactivateListingCommitment<'info> {
    #[account(
        mut,
        seeds = [b"listing-commitment", provider.as_ref(), offer_hash.as_ref()],
        bump = listing_commitment.bump,
    )]
    pub listing_commitment: Account<'info, ListingCommitment>,
    #[account(address = program_state.admin)]
    pub oracle: Signer<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

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
pub struct InitializeDepositVault<'info> {
    #[account(
        init,
        payer = admin,
        space = DepositVault::LEN,
        seeds = [b"deposit_vault"],
        bump
    )]
    pub deposit_vault: Account<'info, DepositVault>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    #[account(mut, address = program_state.admin)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawFromVault<'info> {
    #[account(mut, seeds = [b"deposit_vault"], bump = deposit_vault.bump)]
    pub deposit_vault: Account<'info, DepositVault>,
    /// CHECK: must equal vault.hot_treasury (enforced by address constraint)
    #[account(mut, address = deposit_vault.hot_treasury)]
    pub hot_treasury: AccountInfo<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateDepositVaultHot<'info> {
    #[account(mut, seeds = [b"deposit_vault"], bump = deposit_vault.bump)]
    pub deposit_vault: Account<'info, DepositVault>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    pub authority: Signer<'info>,
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

// D-S1: Admin key rotation contexts
#[derive(Accounts)]
pub struct ProposeAdminTransfer<'info> {
    #[account(mut, seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    /// Must be the current admin.
    #[account(address = program_state.admin)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptAdminTransfer<'info> {
    #[account(mut, seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    /// Must be the pending_admin nominated by `propose_admin_transfer`.
    pub new_admin: Signer<'info>,
}

// D-S2: Multi-sig pause context
#[derive(Accounts)]
pub struct MultiSigPauseVote<'info> {
    #[account(mut, seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    #[account(seeds = [b"multisig_oracle"], bump = multisig_oracle.bump)]
    pub multisig_oracle: Account<'info, MultiSigOracle>,
    /// One oracle signer submitting their pause approval.
    pub oracle_signer: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(amount: u64, bandwidth_limit_gb: u64, expires_at: i64)]
pub struct InitializeEscrowMultiSig<'info> {
    #[account(
        init,
        payer = buyer,
        space = Escrow::LEN,
        seeds = [b"escrow_multisig", buyer.key().as_ref(), seller.key().as_ref(), &expires_at.to_le_bytes()],
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
    #[account(
        mut,
        seeds = [b"escrow_multisig", escrow.buyer.as_ref(), escrow.seller.as_ref(), &escrow.expires_at.to_le_bytes()],
        bump = escrow.bump,
        close = buyer,
    )]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: Buyer account — bound to the escrow record so payouts cannot be redirected.
    #[account(mut, address = escrow.buyer)]
    pub buyer: AccountInfo<'info>,
    /// CHECK: Seller account — bound to the escrow record so payouts cannot be redirected.
    #[account(mut, address = escrow.seller)]
    pub seller: AccountInfo<'info>,
    #[account(mut, seeds = [b"multisig_oracle"], bump = multisig_oracle.bump)]
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
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    pub system_program: Program<'info, System>,
    /// CHECK: Instructions sysvar account for precompile verification
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(bytes_used: u64, sequence_num: u64)]
pub struct SettleEscrowMutualReceipt<'info> {
    #[account(
        mut,
        close = buyer,
    )]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: Buyer account — receives unused balance + rent refund
    #[account(mut, address = escrow.buyer)]
    pub buyer: AccountInfo<'info>,
    /// CHECK: Seller account — receives earned payout for verified bandwidth
    #[account(mut, address = escrow.seller)]
    pub seller: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    pub system_program: Program<'info, System>,
    /// CHECK: Instructions sysvar account for precompile verification
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: AccountInfo<'info>,
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
    /// Program admin only. The initiator chooses the jurors, so letting a buyer or seller (or
    /// anyone) call this let them seat their own jury and have it award them the escrow.
    #[account(mut, address = program_state.admin)]
    pub initiator: Signer<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut, seeds = [b"jury", jury.escrow.as_ref()], bump = jury.bump)]
    pub jury: Account<'info, Jury>,
    pub juror: Signer<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
pub struct ExecuteJuryVerdict<'info> {
    #[account(mut, seeds = [b"jury", jury.escrow.as_ref()], bump = jury.bump)]
    pub jury: Account<'info, Jury>,
    // The escrow must be the one this jury was empaneled for, otherwise a caller
    // could pair a resolved jury with an unrelated escrow to drain it.
    #[account(mut, constraint = escrow.key() == jury.escrow)]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: Buyer account — bound to the escrow record so verdict payouts cannot be redirected.
    #[account(mut, address = escrow.buyer)]
    pub buyer: AccountInfo<'info>,
    /// CHECK: Seller account — bound to the escrow record so verdict payouts cannot be redirected.
    #[account(mut, address = escrow.seller)]
    pub seller: AccountInfo<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
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
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump,
        close = buyer,
    )]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: Buyer account — bound to the escrow record so payouts cannot be redirected.
    #[account(mut, address = escrow.buyer)]
    pub buyer: AccountInfo<'info>,
    /// CHECK: Seller account — bound to the escrow record so payouts cannot be redirected.
    #[account(mut, address = escrow.seller)]
    pub seller: AccountInfo<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
pub struct CloseEscrow<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump,
        close = buyer,
    )]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: Buyer receives the rent reserve on close.
    #[account(mut, address = escrow.buyer)]
    pub buyer: AccountInfo<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

// ── Provider staking ──────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(provider_wallet: Pubkey)]
pub struct StakeProvider<'info> {
    /// Program admin (treasury custody) only: it funds the stake on the provider's behalf.
    #[account(mut, address = program_state.admin)]
    pub oracle: Signer<'info>,
    #[account(
        init_if_needed,
        payer = oracle,
        space = StakeAccount::LEN,
        seeds = [b"stake", provider_wallet.as_ref()],
        bump
    )]
    pub stake_account: Account<'info, StakeAccount>,
    pub system_program: Program<'info, System>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
#[instruction(provider_wallet: Pubkey)]
pub struct UnstakeProvider<'info> {
    /// Program admin (treasury custody) only: the withdrawn lamports are credited to this
    /// account, which is the custody wallet. With any signer allowed, an attacker could
    /// withdraw every provider's stake into their own wallet.
    #[account(mut, address = program_state.admin)]
    pub oracle: Signer<'info>,
    #[account(
        mut,
        seeds = [b"stake", provider_wallet.as_ref()],
        bump
    )]
    pub stake_account: Account<'info, StakeAccount>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    #[account(seeds = [b"program_config"], bump = program_config.bump)]
    pub program_config: Account<'info, ProgramConfig>,
}

// ── Usage Proof anchoring ─────────────────────────────────────────────────────

/// Account order must match SubmitUsageProofParams in Go (settlement.go):
///   0  oracle           — Signer, writable (pays rent)
///   1  escrow           — Writable (unchecked: supports both legacy + multisig PDAs)
///   2  usage_proof      — Init, writable (new PDA)
///   3  sysvar_ixs       — Read-only (reserved for future Ed25519 introspection)
///   4  system_program
///   5  program_state    — Read-only (pause guard)
#[derive(Accounts)]
#[instruction(proof_index: u32)]
pub struct SubmitUsageProof<'info> {
    /// Oracle/admin pays for the PDA rent. Bound to program_state.admin (BC-05).
    #[account(mut, address = program_state.admin)]
    pub oracle: Signer<'info>,

    /// The escrow PDA this proof belongs to.  Accepted as unchecked AccountInfo
    /// so both the legacy and multi-sig escrow seed variants are valid.
    /// CHECK: Escrow PDA is verified off-chain by the oracle before submission.
    pub escrow: AccountInfo<'info>,

    /// New immutable usage proof record.
    /// Seeds: ["usage_proof", escrow_key, proof_index (u32 LE)]
    #[account(
        init,
        payer = oracle,
        space = UsageProofRecord::LEN,
        seeds = [b"usage_proof", escrow.key().as_ref(), &proof_index.to_le_bytes()],
        bump
    )]
    pub usage_proof: Account<'info, UsageProofRecord>,

    /// CHECK: SysVar reserved for future Ed25519 instruction introspection.
    pub sysvar_instructions: AccountInfo<'info>,

    pub system_program: Program<'info, System>,

    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

// ── KYC Attestation ───────────────────────────────────────────────────────────

/// Context for write_kyc_attestation.
///
/// Account order (must match WriteKYCAttestationParams in Go attestation.go):
///   0  oracle         — Signer, writable (pays rent on first init)
///   1  attestation    — init_if_needed PDA ["kyc_attestation", wallet]
///   2  system_program
///   3  program_state  — pause guard
#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct WriteKYCAttestation<'info> {
    /// Oracle/admin pays for the PDA rent on first creation. Bound to
    /// program_state.admin so arbitrary signers cannot forge KYC (BC-05).
    #[account(mut, address = program_state.admin)]
    pub oracle: Signer<'info>,

    /// KYC attestation PDA.  Created on first call, updated on subsequent calls.
    /// Seeds: ["kyc_attestation", wallet_pubkey]
    #[account(
        init_if_needed,
        payer = oracle,
        space = KYCAttestation::LEN,
        seeds = [b"kyc_attestation", wallet.as_ref()],
        bump
    )]
    pub attestation: Account<'info, KYCAttestation>,

    pub system_program: Program<'info, System>,

    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

// ── Session Commitment ─────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(session_id: [u8; 16])]
pub struct LockSessionCommitment<'info> {
    #[account(mut, address = program_state.admin)]
    pub oracle: Signer<'info>,
    #[account(
        init, payer = oracle,
        space = SessionCommitment::LEN,
        seeds = [b"session_commitment", session_id.as_ref()],
        bump
    )]
    pub session_commitment: Account<'info, SessionCommitment>,
    pub system_program: Program<'info, System>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
#[instruction(session_id: [u8; 16])]
pub struct InitializeSessionEscrow<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: Seller receives pro-rata payout on settle.
    pub seller: UncheckedAccount<'info>,
    #[account(
        init,
        payer = buyer,
        space = SessionEscrow::LEN,
        seeds = [b"session_escrow", session_id.as_ref()],
        bump
    )]
    pub session_escrow: Account<'info, SessionEscrow>,
    pub system_program: Program<'info, System>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
pub struct SettleSessionEscrow<'info> {
    /// Oracle must be the current program admin.
    #[account(address = program_state.admin)]
    pub oracle: Signer<'info>,
    #[account(
        mut,
        seeds = [b"session_escrow", session_escrow.session_id.as_ref()],
        bump = session_escrow.bump,
        close = buyer,
    )]
    pub session_escrow: Account<'info, SessionEscrow>,
    /// CHECK: Buyer receives unused escrow + rent.
    #[account(mut, address = session_escrow.buyer)]
    pub buyer: UncheckedAccount<'info>,
    /// CHECK: Seller receives billed share.
    #[account(mut, address = session_escrow.seller)]
    pub seller: UncheckedAccount<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

// ── Governance ─────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(proposal_id: [u8; 16])]
pub struct CreateProposal<'info> {
    #[account(mut, address = program_state.admin)]
    pub oracle: Signer<'info>,
    #[account(
        init, payer = oracle,
        space = GovernanceProposal::LEN,
        seeds = [b"gov_proposal", proposal_id.as_ref()],
        bump
    )]
    pub proposal: Account<'info, GovernanceProposal>,
    pub system_program: Program<'info, System>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    #[account(mut)]
    pub proposal: Account<'info, GovernanceProposal>,
    #[account(
        seeds = [b"program_state"],
        bump = program_state.bump,
        has_one = admin,
    )]
    pub program_state: Account<'info, ProgramState>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct CastGovernanceVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,
    #[account(
        mut,
        // proposal PDA is passed by address; seeds verified via constraint
    )]
    pub proposal: Account<'info, GovernanceProposal>,
    #[account(
        init, payer = voter,
        space = GovernanceVote::LEN,
        seeds = [b"gov_vote", proposal.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub governance_vote: Account<'info, GovernanceVote>,
    pub system_program: Program<'info, System>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
pub struct FinalizeProposal<'info> {
    #[account(mut)]
    pub proposal: Account<'info, GovernanceProposal>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

// ── Dispute / Jury ─────────────────────────────────────────────────────────────

#[account]
#[derive(Default)]
pub struct DisputeRecord {
    pub bump: u8,
}

impl DisputeRecord {
    pub const LEN: usize = 8 + 1;
}

#[derive(Accounts)]
pub struct OpenDisputeOnchain<'info> {
    #[account(mut, address = program_state.admin)]
    pub oracle: Signer<'info>,
    /// CHECK: Escrow PDA verified off-chain by oracle.
    pub escrow: AccountInfo<'info>,
    #[account(
        init, payer = oracle,
        space = DisputeRecord::LEN,
        seeds = [b"dispute_record", escrow.key().as_ref()],
        bump
    )]
    pub dispute_record: Account<'info, DisputeRecord>,
    pub system_program: Program<'info, System>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
pub struct CastJuryVoteOnchain<'info> {
    #[account(mut)]
    pub juror: Signer<'info>,
    /// CHECK: DisputeRecord PDA verified off-chain.
    pub dispute: AccountInfo<'info>,
    #[account(
        init, payer = juror,
        space = JuryVotePDA::LEN,
        seeds = [b"jury_vote", dispute.key().as_ref(), juror.key().as_ref()],
        bump
    )]
    pub jury_vote: Account<'info, JuryVotePDA>,
    pub system_program: Program<'info, System>,
}

// ── Admin Attestation ──────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct WriteAdminAttestation<'info> {
    #[account(mut, address = program_state.admin)]
    pub admin: Signer<'info>,
    #[account(
        init_if_needed, payer = admin,
        space = AdminAttestation::LEN,
        seeds = [b"admin_attestation", wallet.as_ref()],
        bump
    )]
    pub attestation: Account<'info, AdminAttestation>,
    pub system_program: Program<'info, System>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

// ── Program Config ──────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct UpdateProgramConfig<'info> {
    /// Program admin only. This used to be any signer, so anyone could set
    /// `unstake_cooldown_seconds` to 1 and the fee and limit fields to anything.
    #[account(mut, address = program_state.admin)]
    pub oracle: Signer<'info>,
    #[account(
        init_if_needed, payer = oracle,
        space = ProgramConfig::LEN,
        seeds = [b"program_config"],
        bump
    )]
    pub program_config: Account<'info, ProgramConfig>,
    pub system_program: Program<'info, System>,
    #[account(seeds = [b"multisig_oracle"], bump = multisig_oracle.bump)]
    pub multisig_oracle: Account<'info, MultiSigOracle>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

// ── Review Attestation ────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(order_escrow_pda: Pubkey, reviewer: Pubkey)]
pub struct SubmitReviewAttestation<'info> {
    #[account(mut, address = program_state.admin)]
    pub oracle: Signer<'info>,
    #[account(
        init, payer = oracle,
        space = ReviewAttestation::LEN,
        seeds = [b"review", order_escrow_pda.as_ref(), reviewer.as_ref()],
        bump
    )]
    pub review_attestation: Account<'info, ReviewAttestation>,
    pub system_program: Program<'info, System>,
    /// Appended last so the account order of existing callers is unchanged; they must add it.
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

// ── Spending Event Log ────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct LogSpendingEvent<'info> {
    #[account(mut, address = program_state.admin)]
    pub oracle: Signer<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

// ── ZK Batch ──────────────────────────────────────────────────────────────────
//
// ZKBatchPDA stores an immutable Merkle root commitment for N session proofs.
// PDA seeds: [b"zk_batch", batch_root (32 bytes)]
#[account]
pub struct ZKBatchPDA {
    pub batch_root:    [u8; 32],
    pub session_count: u32,
    pub total_bytes:   u64,
    pub period_start:  i64,
    pub period_end:    i64,
    pub submitted_at:  i64,
    pub proof_hash:    [u8; 32],
    pub bump:          u8,
}

impl ZKBatchPDA {
    pub const LEN: usize = 8 + 32 + 4 + 8 + 8 + 8 + 8 + 32 + 1; // = 109
}

#[derive(Accounts)]
#[instruction(batch_root: [u8; 32])]
pub struct SubmitZKBatch<'info> {
    #[account(mut)]
    pub oracle: Signer<'info>,
    #[account(
        init, payer = oracle,
        space = ZKBatchPDA::LEN,
        seeds = [b"zk_batch", batch_root.as_ref()],
        bump
    )]
    pub zk_batch: Account<'info, ZKBatchPDA>,
    pub system_program: Program<'info, System>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    /// CHECK: Instructions sysvar account for precompile verification
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: AccountInfo<'info>,
}

/// BC-11-B Groth16 submit accounts.
/// Proof verify runs in the handler; on success `zk_batch` is initialized.
/// Without feature `onchain-groth16` the handler errors (tx rolls back init).
#[derive(Accounts)]
#[instruction(batch_root: [u8; 32])]
pub struct SubmitZKBatchGroth16<'info> {
    #[account(mut)]
    pub oracle: Signer<'info>,
    #[account(
        init, payer = oracle,
        space = ZKBatchPDA::LEN,
        seeds = [b"zk_batch", batch_root.as_ref()],
        bump
    )]
    pub zk_batch: Account<'info, ZKBatchPDA>,
    pub system_program: Program<'info, System>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    /// CHECK: optional 256-byte proof account; if len!=256, ix `proof` arg is used.
    pub groth16_proof: AccountInfo<'info>,
    /// CHECK: optional 32-byte VK_HASH pin (else inert placeholder).
    pub groth16_vk: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct ExecuteSignerRotationProposal<'info> {
    #[account(mut, seeds = [b"gov_proposal", proposal.proposal_id.as_ref()], bump = proposal.bump)]
    pub proposal: Account<'info, GovernanceProposal>,
    #[account(mut, seeds = [b"multisig_oracle"], bump = multisig_oracle.bump)]
    pub multisig_oracle: Account<'info, MultiSigOracle>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    pub system_program: Program<'info, System>,
}

// ── State Channel ─────────────────────────────────────────────────────────────
//
// ChannelPDA stores the on-chain state for a Layer-2 state channel.
// PDA seeds: [b"state_channel", session_id (16 bytes)]
//
// Layout (after 8-byte Anchor discriminator):
//   session_id      [u8; 16]   — UUID bytes
//   buyer           Pubkey     — 32 bytes
//   provider        Pubkey     — 32 bytes
//   deposit_lamports u64       — total locked SOL
//   spent_lamports  u64        — provider's earned share (set on close)
//   nonce           u64        — last committed off-chain state nonce
//   opened_at       i64        — Unix timestamp
//   expires_at      i64        — Unix timestamp (default: opened_at + 86 400)
//   is_closed       bool       — true once close_channel executes
//   bump            u8         — PDA bump seed
//
// Total: 8 + 16 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 1 = 130 bytes

#[account]
pub struct ChannelPDA {
    pub session_id:       [u8; 16],
    pub buyer:            Pubkey,
    pub provider:         Pubkey,
    pub deposit_lamports: u64,
    pub spent_lamports:   u64,
    pub nonce:            u64,
    pub opened_at:        i64,
    pub expires_at:       i64,
    pub is_closed:        bool,
    pub bump:             u8,
}

impl ChannelPDA {
    pub const LEN: usize = 8 + 16 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 1; // = 130
}

#[derive(Accounts)]
#[instruction(session_id: [u8; 16], deposit_lamports: u64)]
pub struct OpenChannel<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: provider is validated by the oracle off-chain; stored in the PDA.
    pub provider_wallet: AccountInfo<'info>,
    #[account(
        init, payer = buyer,
        space = ChannelPDA::LEN,
        seeds = [b"state_channel", session_id.as_ref()],
        bump
    )]
    pub channel: Account<'info, ChannelPDA>,
    pub system_program: Program<'info, System>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
}

#[derive(Accounts)]
#[instruction(session_id: [u8; 16])]
pub struct CloseChannel<'info> {
    /// Payer of the transaction fee.
    #[account(mut)]
    pub oracle: Signer<'info>,
    #[account(
        mut,
        seeds = [b"state_channel", session_id.as_ref()],
        bump = channel.bump,
    )]
    pub channel: Account<'info, ChannelPDA>,
    /// CHECK: recipient of provider's earned lamports.
    #[account(mut, address = channel.provider)]
    pub provider_wallet: AccountInfo<'info>,
    /// CHECK: recipient of buyer's refund.
    #[account(mut, address = channel.buyer)]
    pub buyer: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    #[account(seeds = [b"program_state"], bump = program_state.bump)]
    pub program_state: Account<'info, ProgramState>,
    #[account(seeds = [b"multisig_oracle"], bump = multisig_oracle.bump)]
    pub multisig_oracle: Account<'info, MultiSigOracle>,
    /// CHECK: Instructions sysvar account for precompile verification
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: AccountInfo<'info>,
}


#[cfg(test)]
mod payout_math_tests {
    use super::*;

    fn pay(amount: u64, used: u64, limit: u64) -> u64 {
        prorated_payout(amount, used, limit).expect("payout fits in u64")
    }

    #[test]
    fn pays_proportionally_and_rounds_down() {
        assert_eq!(pay(1_000, 50, 100), 500);
        assert_eq!(pay(1_000, 0, 100), 0);
        assert_eq!(pay(1_000, 100, 100), 1_000);
        assert_eq!(pay(10, 1, 3), 3);
    }

    #[test]
    fn usage_above_the_limit_is_capped() {
        assert_eq!(pay(1_000, 500, 100), 1_000);
        assert_eq!(pay(1_000, u64::MAX, 100), 1_000);
    }

    #[test]
    fn a_zero_limit_pays_nothing() {
        assert_eq!(pay(1_000, 10, 0), 0);
    }

    // BC-HIGH-01: with the settle functions' old u64 arithmetic, amount * usage overflowed
    // and unwrap_or(0) turned it into a zero payout, refunding the whole escrow to the buyer.
    #[test]
    fn does_not_overflow_where_the_old_u64_math_paid_the_seller_nothing() {
        let amount = 1_000_000_000u64; // 1 SOL in lamports
        let limit = 20 * 1_073_741_824u64; // 20 GiB counted in bytes

        let old = amount.checked_mul(limit).unwrap_or(0).checked_div(limit).unwrap_or(0);
        assert_eq!(old, 0, "this is the bug: the u64 product overflows and collapses to 0");

        assert_eq!(pay(amount, limit, limit), amount);
        assert_eq!(pay(amount, limit / 2, limit), amount / 2);
    }

    #[test]
    fn payout_is_the_exact_floor_and_never_exceeds_the_escrow() {
        let amounts = [0u64, 1, 7, 1_000_000_000, 123_456_789_012, u64::MAX - 1, u64::MAX];
        let limits = [1u64, 3, 100, 1_000_000, 21_474_836_480, u64::MAX - 1, u64::MAX];
        let used = [0u64, 1, 2, 99, 1_000_000, 21_474_836_479, u64::MAX / 2, u64::MAX - 1, u64::MAX];

        for &amount in &amounts {
            for &limit in &limits {
                for &u in &used {
                    let payout = pay(amount, u, limit);
                    let billed = std::cmp::min(u, limit) as u128;

                    assert!(payout <= amount, "payout {payout} > escrow {amount}");
                    // floor(amount * billed / limit): payout*limit <= amount*billed < (payout+1)*limit
                    assert!((payout as u128) * (limit as u128) <= (amount as u128) * billed);
                    assert!((amount as u128) * billed < ((payout as u128) + 1) * (limit as u128));
                    // Nothing is created or lost between seller and buyer.
                    assert_eq!(payout + amount.saturating_sub(payout), amount);
                }
            }
        }
    }
}

#[cfg(test)]
mod pause_vote_tests {
    use super::*;

    fn key(n: u8) -> Pubkey {
        Pubkey::new_from_array([n; 32])
    }

    // The oracle set is keys 1..=3; the caller is key 1.
    fn set() -> Vec<Pubkey> {
        vec![key(1), key(2), key(3)]
    }

    #[test]
    fn the_caller_alone_is_one_approval() {
        assert_eq!(distinct_oracle_signers(key(1), [], &set()), vec![key(1)]);
    }

    // multi_sig_pause_vote now passes only keys that signed the transaction. Keys named in
    // instruction data are never fed to this function, so a lone signer stays at one.
    #[test]
    fn other_set_members_who_signed_are_counted_once_each() {
        let got = distinct_oracle_signers(key(1), [key(2), key(2), key(3), key(1)], &set());
        assert_eq!(got, vec![key(1), key(2), key(3)]);
    }

    #[test]
    fn keys_outside_the_oracle_set_are_ignored() {
        let got = distinct_oracle_signers(key(1), [key(9), key(2), key(8)], &set());
        assert_eq!(got, vec![key(1), key(2)]);
    }
}
