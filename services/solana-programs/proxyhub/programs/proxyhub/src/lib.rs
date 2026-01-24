use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Token, TokenAccount, Transfer as TokenTransfer};

declare_id!("2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7");

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
        1; // bump
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
        1; // bump
}

/// Dispute status
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum DisputeStatus {
    Open,      // Dispute is active
    Resolved,  // Admin has resolved
    Cancelled, // Initiator cancelled
}

impl Default for DisputeStatus {
    fn default() -> Self {
        DisputeStatus::Open
    }
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
        1; // bump
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
        1; // bump
}

impl AdminConfig {
    pub const LEN: usize = 8 + // discriminator
        32 + // admin
        32 + // pending_admin
        8 +  // created_at
        8 +  // updated_at
        1; // bump
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
        1; // bump
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
        1; // bump
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
    pub bump: u8,
}

impl Jury {
    pub const MAX_JURORS: usize = 5;

    pub const LEN: usize = 8 + // discriminator
        32 + // escrow
        4 + (32 * Self::MAX_JURORS) + // jurors
        1 + // votes_buyer
        1 + // votes_seller
        4 + (32 * Self::MAX_JURORS) + // voted_jurors
        1 + // outcome (enum)
        8 + // created_at
        8 + // resolved_at
        1; // bump
}

#[program]
pub mod proxyhub {
    use super::*;

    // ============== JURY ARBITRATION ==============

    pub fn initiate_jury_dispute(
        ctx: Context<InitiateJuryDispute>,
        jurors: Vec<Pubkey>,
    ) -> Result<()> {
        let jury = &mut ctx.accounts.jury;
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        require!(
            jurors.len() > 0 && jurors.len() <= Jury::MAX_JURORS,
            EscrowError::InvalidStatus
        );
        // Ensure odd number for tie-breaking ideally, but simple majority works too

        escrow.status = EscrowStatus::Disputed;

        jury.escrow = escrow.key();
        jury.jurors = jurors;
        jury.votes_buyer = 0;
        jury.votes_seller = 0;
        jury.outcome = DisputeStatus::Open;
        jury.created_at = clock.unix_timestamp;
        jury.resolved_at = 0;
        jury.bump = ctx.bumps.jury;

        msg!("Jury dispute initiated with {} jurors", jury.jurors.len());
        Ok(())
    }

    pub fn cast_vote(ctx: Context<CastVote>, vote_for_buyer: bool) -> Result<()> {
        let jury = &mut ctx.accounts.jury;
        let juror = &ctx.accounts.juror;

        // Verify juror is selected and hasn't voted
        require!(jury.jurors.contains(juror.key), EscrowError::InvalidStatus); // Not a juror
        require!(
            !jury.voted_jurors.contains(juror.key),
            EscrowError::InvalidStatus
        ); // Already voted
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
        let total_votes = jury.votes_buyer + jury.votes_seller;
        let quorum = (jury.jurors.len() / 2) + 1;

        if (jury.votes_buyer as usize) >= quorum {
            // Buyer wins
            jury.outcome = DisputeStatus::Resolved; // We'd set specific winner in real impl
            msg!("Jury reached consensus: Buyer wins");
        } else if (jury.votes_seller as usize) >= quorum {
            // Seller wins
            jury.outcome = DisputeStatus::Resolved;
            msg!("Jury reached consensus: Seller wins");
        }

        Ok(())
    }

    /// Execute the jury verdict to settle funds
    pub fn execute_jury_verdict(ctx: Context<ExecuteJuryVerdict>) -> Result<()> {
        let jury = &mut ctx.accounts.jury;
        let escrow = &mut ctx.accounts.escrow;

        require!(jury.outcome == DisputeStatus::Resolved, EscrowError::InvalidStatus); // Must be decided
        require!(escrow.status == EscrowStatus::Disputed, EscrowError::InvalidStatus);

        escrow.status = EscrowStatus::Settled; // Or create a special "JurySettled" status?

        // Check votes to determine winner
        let quorum = (jury.jurors.len() / 2) + 1;
        
        // Simple winner takes all for MVP, or partial? 
        // Let's assume winner takes all escrow amount.
        
        let mut buyer_payout = 0;
        let mut seller_payout = 0;

        if (jury.votes_buyer as usize) >= quorum {
            // Buyer wins - full refund
            buyer_payout = escrow.amount;
        } else if (jury.votes_seller as usize) >= quorum {
            // Seller wins - full payout
            seller_payout = escrow.amount;
        } else {
             // Should not happen if outcome is Resolved
             return Ok(());
        }

        if buyer_payout > 0 {
            **escrow.to_account_info().try_borrow_mut_lamports()? -= buyer_payout;
            **ctx.accounts.buyer.try_borrow_mut_lamports()? += buyer_payout;
        }

        if seller_payout > 0 {
            **escrow.to_account_info().try_borrow_mut_lamports()? -= seller_payout;
            **ctx.accounts.seller.try_borrow_mut_lamports()? += seller_payout;
        }

        msg!("Jury verdict executed: {} to buyer, {} to seller", buyer_payout, seller_payout);
        Ok(())
    }

    // ============== CIRCLE REVENUE SHARING ==============

    #[derive(Accounts)]
    #[instruction(name: String)]
    pub struct RegisterCircle<'info> {
        #[account(
            init,
            payer = leader,
            space = CircleConfig::LEN,
            seeds = [b"circle", name.as_bytes()],
            bump
        )]
        pub circle: Account<'info, CircleConfig>,
        #[account(mut)]
        pub leader: Signer<'info>,
        pub system_program: Program<'info, System>,
    }

    pub fn register_circle(
        ctx: Context<RegisterCircle>,
        name: String,
        treasury_share: u8,
        members: Vec<Pubkey>,
        shares: Vec<u8>,
    ) -> Result<()> {
        let circle = &mut ctx.accounts.circle;

        require!(
            name.len() <= CircleConfig::MAX_NAME_LEN,
            EscrowError::InvalidStatus
        );
        require!(
            members.len() <= CircleConfig::MAX_MEMBERS,
            EscrowError::InvalidStatus
        );
        require!(members.len() == shares.len(), EscrowError::InvalidStatus);

        let total_share: u16 = shares.iter().map(|&s| s as u16).sum();
        require!(
            total_share + (treasury_share as u16) == 100,
            EscrowError::InvalidPercentage
        );

        circle.leader = ctx.accounts.leader.key();
        circle.name = name;
        circle.treasury_share = treasury_share;
        circle.members = members;
        circle.shares = shares;
        circle.bump = ctx.bumps.circle;

        msg!("Circle registered: {}", circle.name);
        Ok(())
    }

    /// Settle escrow with Circle Revenue Sharing
    pub fn settle_circle_escrow(
        ctx: Context<SettleCircleEscrow>,
        bandwidth_used_gb: u64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let circle = &ctx.accounts.circle;

        require!(
            escrow.status == EscrowStatus::Pending || escrow.status == EscrowStatus::Active,
            EscrowError::InvalidStatus
        );

        escrow.bandwidth_used_gb = bandwidth_used_gb;
        escrow.status = EscrowStatus::Settled;

        // Calculate total payouts
        let capped_usage = std::cmp::min(bandwidth_used_gb, escrow.bandwidth_limit_gb);
        let total_seller_payout = if escrow.bandwidth_limit_gb > 0 {
            escrow
                .amount
                .checked_mul(capped_usage)
                .unwrap_or(0)
                .checked_div(escrow.bandwidth_limit_gb)
                .unwrap_or(0)
        } else {
            0
        };
        let buyer_refund = escrow.amount.saturating_sub(total_seller_payout);

        // Distribute Seller Payout according to Circle shares
        if total_seller_payout > 0 {
            let mut remaining_payout = total_seller_payout;

            // 1. Treasury Share
            if circle.treasury_share > 0 {
                let treasury_amount =
                    (total_seller_payout as u128 * circle.treasury_share as u128 / 100) as u64;
                if treasury_amount > 0 {
                    **escrow.to_account_info().try_borrow_mut_lamports()? -= treasury_amount;
                    **ctx.accounts.circle_treasury.try_borrow_mut_lamports()? += treasury_amount;
                    remaining_payout -= treasury_amount;
                }
            }

            // 2. Member Shares (simplified: assumes member accounts are passed in remaining_accounts)
            // For MVP, we'll just pay the "seller" (provider) the remaining amount
            // In full version, we'd need to iterate over members and transfer to each

            if remaining_payout > 0 {
                **escrow.to_account_info().try_borrow_mut_lamports()? -= remaining_payout;
                **ctx.accounts.seller.try_borrow_mut_lamports()? += remaining_payout;
            }
        }

        // Refund buyer
        if buyer_refund > 0 {
            **escrow.to_account_info().try_borrow_mut_lamports()? -= buyer_refund;
            **ctx.accounts.buyer.try_borrow_mut_lamports()? += buyer_refund;
        }

        msg!(
            "Circle Escrow settled: {} total payout, {} refunded",
            total_seller_payout,
            buyer_refund
        );
        Ok(())
    }

    // ============== STREAMING PAYMENTS ==============

    /// Initialize a streaming payment
    pub fn initialize_stream(
        ctx: Context<InitializeStream>,
        amount: u64,
        flow_rate: u64, // Lamports per second
        start_time: i64,
    ) -> Result<()> {
        let stream = &mut ctx.accounts.stream;
        let clock = Clock::get()?;

        // Basic validation
        require!(amount > 0, EscrowError::InvalidStatus); // Reuse error or add new
        require!(flow_rate > 0, EscrowError::InvalidStatus);

        stream.buyer = ctx.accounts.buyer.key();
        stream.seller = ctx.accounts.seller.key();
        stream.total_deposited = amount;
        stream.total_withdrawn = 0;
        stream.flow_rate = flow_rate;

        // Start time can be future or now
        let effective_start = if start_time > clock.unix_timestamp {
            start_time
        } else {
            clock.unix_timestamp
        };
        stream.start_time = effective_start;
        stream.last_withdraw_time = effective_start;

        // Calculate duration based on amount and rate
        let duration = amount / flow_rate;
        stream.end_time = effective_start + duration as i64;

        stream.is_active = true;
        stream.bump = ctx.bumps.stream;

        // Transfer funds to stream account
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.stream.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount)?;

        msg!(
            "Stream initialized: {} rate/sec, ends at {}",
            flow_rate,
            stream.end_time
        );
        Ok(())
    }

    /// Withdraw available funds from stream (Seller checks in)
    pub fn withdraw_stream(ctx: Context<WithdrawStream>) -> Result<()> {
        let stream = &mut ctx.accounts.stream;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        require!(stream.is_active, EscrowError::InvalidStatus);
        require!(now > stream.last_withdraw_time, EscrowError::NotExpired);

        // Cap calculations at stream end or now
        let time_end_calc = std::cmp::min(now, stream.end_time);

        if time_end_calc <= stream.last_withdraw_time {
            msg!("No new funds to withdraw");
            return Ok(());
        }

        let elapsed = (time_end_calc - stream.last_withdraw_time) as u64;
        let withdrawable = elapsed * stream.flow_rate;

        // Ensure we don't overdraw due to math/rounding
        let remaining_balance = stream
            .total_deposited
            .saturating_sub(stream.total_withdrawn);
        let actual_withdraw = std::cmp::min(withdrawable, remaining_balance);

        if actual_withdraw > 0 {
            stream.total_withdrawn += actual_withdraw;
            stream.last_withdraw_time = time_end_calc;

            // Transfer to seller
            **stream.to_account_info().try_borrow_mut_lamports()? -= actual_withdraw;
            **ctx.accounts.seller.try_borrow_mut_lamports()? += actual_withdraw;

            msg!("Stream withdrawal: {}", actual_withdraw);
        }

        // Close stream if drained and time passed
        if stream.total_withdrawn >= stream.total_deposited {
            stream.is_active = false;
            msg!("Stream completed and closed");
        }

        Ok(())
    }

    /// Top up an existing stream
    pub fn top_up_stream(ctx: Context<TopUpStream>, amount: u64) -> Result<()> {
        let stream = &mut ctx.accounts.stream;
        let clock = Clock::get()?;

        require!(stream.is_active, EscrowError::InvalidStatus);
        require!(amount > 0, EscrowError::InvalidStatus);

        stream.total_deposited += amount;

        // Extend end time
        // remaining = (end - now) + (new / rate)
        // simplier: new_end = old_end + (amount / rate)
        let duration_extension = amount / stream.flow_rate;
        stream.end_time += duration_extension as i64;

        // Transfer funds
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.stream.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount)?;

        msg!(
            "Stream topped up: +{} lamports, new end: {}",
            amount,
            stream.end_time
        );
        Ok(())
    }

    // ============== SOL ESCROW (Legacy) ==============

    /// Initialize escrow - Buyer deposits SOL
    pub fn initialize_escrow(
        ctx: Context<InitializeEscrow>,
        amount: u64,
        bandwidth_limit_gb: u64,
        duration_seconds: i64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.amount = amount;
        escrow.bandwidth_limit_gb = bandwidth_limit_gb;
        escrow.bandwidth_used_gb = 0;
        escrow.status = EscrowStatus::Pending;
        escrow.created_at = clock.unix_timestamp;
        escrow.expires_at = clock.unix_timestamp + duration_seconds;
        escrow.bump = ctx.bumps.escrow;

        // Transfer SOL from buyer to escrow PDA
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount)?;

        msg!(
            "Escrow initialized: {} lamports for {} GB",
            amount,
            bandwidth_limit_gb
        );
        Ok(())
    }

    // ============== ADMIN MANAGEMENT ==============

    /// Initialize the admin config (one-time setup)
    pub fn initialize_admin(ctx: Context<InitializeAdmin>) -> Result<()> {
        let admin_config = &mut ctx.accounts.admin_config;
        let clock = Clock::get()?;

        admin_config.admin = ctx.accounts.initial_admin.key();
        admin_config.pending_admin = Pubkey::default();
        admin_config.created_at = clock.unix_timestamp;
        admin_config.updated_at = clock.unix_timestamp;
        admin_config.bump = ctx.bumps.admin_config;

        msg!("Admin initialized: {}", ctx.accounts.initial_admin.key());
        Ok(())
    }

    /// Update the admin (current admin transfers to new admin)
    pub fn update_admin(ctx: Context<UpdateAdmin>, new_admin: Pubkey) -> Result<()> {
        let admin_config = &mut ctx.accounts.admin_config;
        let clock = Clock::get()?;

        // Verify caller is current admin
        require!(
            ctx.accounts.current_admin.key() == admin_config.admin,
            EscrowError::UnauthorizedAdmin
        );

        admin_config.admin = new_admin;
        admin_config.updated_at = clock.unix_timestamp;

        msg!("Admin updated to: {}", new_admin);
        Ok(())
    }

    /// Settle escrow - Oracle signs off, SOL released proportionally
    /// Uses fixed-point arithmetic to avoid float precision issues
    pub fn settle_escrow(ctx: Context<SettleEscrow>, bandwidth_used_gb: u64) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        require!(
            escrow.status == EscrowStatus::Pending || escrow.status == EscrowStatus::Active,
            EscrowError::InvalidStatus
        );

        escrow.bandwidth_used_gb = bandwidth_used_gb;
        escrow.status = EscrowStatus::Settled;

        // Calculate payout using fixed-point arithmetic (no floats)
        // seller_payout = (amount * used) / limit
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

        // Transfer to seller
        if seller_payout > 0 {
            **escrow.to_account_info().try_borrow_mut_lamports()? -= seller_payout;
            **ctx.accounts.seller.try_borrow_mut_lamports()? += seller_payout;
        }

        // Refund remainder to buyer
        if buyer_refund > 0 {
            **escrow.to_account_info().try_borrow_mut_lamports()? -= buyer_refund;
            **ctx.accounts.buyer.try_borrow_mut_lamports()? += buyer_refund;
        }

        msg!(
            "Escrow settled: {} to seller, {} refunded to buyer",
            seller_payout,
            buyer_refund
        );
        Ok(())
    }

    /// Refund escrow - If expired and unused (SOL)
    pub fn refund_escrow(ctx: Context<RefundEscrow>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        require!(
            escrow.status == EscrowStatus::Pending,
            EscrowError::InvalidStatus
        );
        require!(
            clock.unix_timestamp > escrow.expires_at,
            EscrowError::NotExpired
        );

        escrow.status = EscrowStatus::Refunded;

        // Transfer all funds back to buyer
        let escrow_lamports = escrow.to_account_info().lamports();
        **escrow.to_account_info().try_borrow_mut_lamports()? = 0;
        **ctx.accounts.buyer.try_borrow_mut_lamports()? += escrow_lamports;

        msg!("Escrow refunded: {} lamports to buyer", escrow_lamports);
        Ok(())
    }

    // ============== SPL TOKEN ESCROW ==============

    /// Initialize token escrow - Buyer deposits SPL tokens (USDC, etc.)
    pub fn initialize_token_escrow(
        ctx: Context<InitializeTokenEscrow>,
        amount: u64,
        bandwidth_limit_gb: u64,
        duration_seconds: i64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.mint = ctx.accounts.mint.key();
        escrow.amount = amount;
        escrow.bandwidth_limit_gb = bandwidth_limit_gb;
        escrow.bandwidth_used_gb = 0;
        escrow.status = EscrowStatus::Pending;
        escrow.created_at = clock.unix_timestamp;
        escrow.expires_at = clock.unix_timestamp + duration_seconds;
        escrow.bump = ctx.bumps.escrow;

        // Transfer tokens from buyer to escrow vault
        let cpi_accounts = TokenTransfer {
            from: ctx.accounts.buyer_token_account.to_account_info(),
            to: ctx.accounts.escrow_vault.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        msg!(
            "Token Escrow initialized: {} tokens for {} GB",
            amount,
            bandwidth_limit_gb
        );
        Ok(())
    }

    /// Settle token escrow - Oracle signs off, tokens released proportionally
    /// Uses fixed-point arithmetic to avoid float precision issues
    pub fn settle_token_escrow(
        ctx: Context<SettleTokenEscrow>,
        bandwidth_used_gb: u64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        require!(
            escrow.status == EscrowStatus::Pending || escrow.status == EscrowStatus::Active,
            EscrowError::InvalidStatus
        );

        escrow.bandwidth_used_gb = bandwidth_used_gb;
        escrow.status = EscrowStatus::Settled;

        // Calculate payout using fixed-point arithmetic (no floats)
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

        // PDA signer seeds
        let escrow_seeds = &[
            b"token_escrow".as_ref(),
            escrow.buyer.as_ref(),
            escrow.seller.as_ref(),
            escrow.mint.as_ref(),
            &[escrow.bump],
        ];
        let signer = &[&escrow_seeds[..]];

        // Transfer to seller
        if seller_payout > 0 {
            let cpi_accounts = TokenTransfer {
                from: ctx.accounts.escrow_vault.to_account_info(),
                to: ctx.accounts.seller_token_account.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
            token::transfer(cpi_ctx, seller_payout)?;
        }

        // Refund remainder to buyer
        if buyer_refund > 0 {
            let cpi_accounts = TokenTransfer {
                from: ctx.accounts.escrow_vault.to_account_info(),
                to: ctx.accounts.buyer_token_account.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
            token::transfer(cpi_ctx, buyer_refund)?;
        }

        msg!(
            "Token Escrow settled: {} to seller, {} refunded to buyer",
            seller_payout,
            buyer_refund
        );
        Ok(())
    }

    /// Refund token escrow - If expired and unused
    pub fn refund_token_escrow(ctx: Context<RefundTokenEscrow>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        require!(
            escrow.status == EscrowStatus::Pending,
            EscrowError::InvalidStatus
        );
        require!(
            clock.unix_timestamp > escrow.expires_at,
            EscrowError::NotExpired
        );

        escrow.status = EscrowStatus::Refunded;

        // PDA signer seeds
        let escrow_seeds = &[
            b"token_escrow".as_ref(),
            escrow.buyer.as_ref(),
            escrow.seller.as_ref(),
            escrow.mint.as_ref(),
            &[escrow.bump],
        ];
        let signer = &[&escrow_seeds[..]];

        // Transfer all tokens back to buyer
        let vault_balance = ctx.accounts.escrow_vault.amount;

        let cpi_accounts = TokenTransfer {
            from: ctx.accounts.escrow_vault.to_account_info(),
            to: ctx.accounts.buyer_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, vault_balance)?;

        msg!("Token Escrow refunded: {} tokens to buyer", vault_balance);
        Ok(())
    }

    // ============== MISC ==============

    /// Agent Verification (Phase 12)
    /// Logs a content hash to the chain as proof of compute.
    pub fn log_agent_work(ctx: Context<LogWork>, content_hash: [u8; 32]) -> Result<()> {
        emit!(AgentWorkLogged {
            agent: ctx.accounts.agent.key(),
            content_hash,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    // ============== DISPUTE RESOLUTION ==============

    /// Raise a dispute on an existing escrow (buyer or seller can call)
    pub fn raise_dispute(ctx: Context<RaiseDispute>, reason: String) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let dispute = &mut ctx.accounts.dispute;
        let clock = Clock::get()?;

        // Can only dispute pending or active escrows
        require!(
            escrow.status == EscrowStatus::Pending || escrow.status == EscrowStatus::Active,
            EscrowError::InvalidStatus
        );

        // Mark escrow as disputed
        escrow.status = EscrowStatus::Disputed;

        // Initialize dispute account
        dispute.escrow = ctx.accounts.escrow.key();
        dispute.initiator = ctx.accounts.initiator.key();
        dispute.is_buyer = ctx.accounts.initiator.key() == escrow.buyer;
        dispute.reason = reason.chars().take(256).collect(); // Limit reason length
        dispute.status = DisputeStatus::Open;
        dispute.created_at = clock.unix_timestamp;
        dispute.resolved_at = 0;
        dispute.resolution = String::new();
        dispute.buyer_payout = 0;
        dispute.seller_payout = 0;
        dispute.bump = ctx.bumps.dispute;

        emit!(DisputeRaised {
            escrow: ctx.accounts.escrow.key(),
            initiator: ctx.accounts.initiator.key(),
            reason: dispute.reason.clone(),
            timestamp: clock.unix_timestamp,
        });

        msg!("Dispute raised on escrow: {}", ctx.accounts.escrow.key());
        Ok(())
    }

    /// Admin resolves a dispute by deciding fund allocation
    pub fn resolve_dispute(
        ctx: Context<ResolveDispute>,
        buyer_percentage: u8,
        resolution: String,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let dispute = &mut ctx.accounts.dispute;
        let clock = Clock::get()?;

        // Must be disputed
        require!(
            escrow.status == EscrowStatus::Disputed,
            EscrowError::InvalidStatus
        );
        require!(
            dispute.status == DisputeStatus::Open,
            EscrowError::DisputeAlreadyResolved
        );

        // Validate percentage
        require!(buyer_percentage <= 100, EscrowError::InvalidPercentage);

        // Calculate payouts
        let buyer_payout = (escrow.amount as u128 * buyer_percentage as u128 / 100) as u64;
        let seller_payout = escrow.amount.saturating_sub(buyer_payout);

        // Update dispute status
        dispute.status = DisputeStatus::Resolved;
        dispute.resolved_at = clock.unix_timestamp;
        dispute.resolution = resolution.chars().take(256).collect();
        dispute.buyer_payout = buyer_payout;
        dispute.seller_payout = seller_payout;

        // Mark escrow as settled
        escrow.status = EscrowStatus::Settled;

        // Transfer to buyer
        if buyer_payout > 0 {
            **escrow.to_account_info().try_borrow_mut_lamports()? -= buyer_payout;
            **ctx.accounts.buyer.try_borrow_mut_lamports()? += buyer_payout;
        }

        // Transfer to seller
        if seller_payout > 0 {
            **escrow.to_account_info().try_borrow_mut_lamports()? -= seller_payout;
            **ctx.accounts.seller.try_borrow_mut_lamports()? += seller_payout;
        }

        emit!(DisputeResolved {
            escrow: ctx.accounts.escrow.key(),
            admin: ctx.accounts.admin.key(),
            buyer_payout,
            seller_payout,
            resolution: dispute.resolution.clone(),
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Dispute resolved: {} to buyer, {} to seller",
            buyer_payout,
            seller_payout
        );
        Ok(())
    }
}

// ============== SOL ESCROW ACCOUNTS ==============

#[derive(Accounts)]
pub struct InitializeEscrow<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: Seller is just receiving funds, no data access
    pub seller: UncheckedAccount<'info>,

    #[account(
        init,
        payer = buyer,
        space = Escrow::LEN,
        seeds = [b"escrow", buyer.key().as_ref(), seller.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleEscrow<'info> {
    /// Oracle/Admin that verifies usage
    pub oracle: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    /// CHECK: Buyer receives refund
    #[account(mut, address = escrow.buyer)]
    pub buyer: UncheckedAccount<'info>,

    /// CHECK: Seller receives payment
    #[account(mut, address = escrow.seller)]
    pub seller: UncheckedAccount<'info>,
}

// ============== ADMIN MANAGEMENT ACCOUNTS ==============

#[derive(Accounts)]
pub struct InitializeAdmin<'info> {
    /// The initial admin who pays for account creation
    #[account(mut)]
    pub initial_admin: Signer<'info>,

    /// Admin config PDA (singleton)
    #[account(
        init,
        payer = initial_admin,
        space = AdminConfig::LEN,
        seeds = [b"admin_config"],
        bump
    )]
    pub admin_config: Account<'info, AdminConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAdmin<'info> {
    /// Current admin must sign
    pub current_admin: Signer<'info>,

    /// Admin config PDA
    #[account(
        mut,
        seeds = [b"admin_config"],
        bump = admin_config.bump,
        constraint = current_admin.key() == admin_config.admin @ EscrowError::UnauthorizedAdmin
    )]
    pub admin_config: Account<'info, AdminConfig>,
}

#[derive(Accounts)]
pub struct RefundEscrow<'info> {
    #[account(mut, address = escrow.buyer)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,
}

// ============== TOKEN ESCROW ACCOUNTS ==============

#[derive(Accounts)]
pub struct InitializeTokenEscrow<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: Seller pubkey for PDA derivation
    pub seller: UncheckedAccount<'info>,

    /// Token mint (e.g., USDC)
    pub mint: Account<'info, anchor_spl::token::Mint>,

    /// Buyer's token account
    #[account(
        mut,
        constraint = buyer_token_account.owner == buyer.key(),
        constraint = buyer_token_account.mint == mint.key()
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    /// Escrow data account
    #[account(
        init,
        payer = buyer,
        space = TokenEscrow::LEN,
        seeds = [b"token_escrow", buyer.key().as_ref(), seller.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, TokenEscrow>,

    /// Escrow token vault (holds the tokens)
    #[account(
        init,
        payer = buyer,
        token::mint = mint,
        token::authority = escrow,
        seeds = [b"token_vault", escrow.key().as_ref()],
        bump
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleTokenEscrow<'info> {
    /// Oracle/Admin that verifies usage
    pub oracle: Signer<'info>,

    #[account(
        mut,
        seeds = [b"token_escrow", escrow.buyer.as_ref(), escrow.seller.as_ref(), escrow.mint.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, TokenEscrow>,

    /// Escrow token vault
    #[account(
        mut,
        seeds = [b"token_vault", escrow.key().as_ref()],
        bump,
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    /// Buyer's token account for refund
    #[account(
        mut,
        constraint = buyer_token_account.mint == escrow.mint
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    /// Seller's token account for payout
    #[account(
        mut,
        constraint = seller_token_account.mint == escrow.mint
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RefundTokenEscrow<'info> {
    #[account(mut, address = escrow.buyer)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"token_escrow", escrow.buyer.as_ref(), escrow.seller.as_ref(), escrow.mint.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, TokenEscrow>,

    /// Escrow token vault
    #[account(
        mut,
        seeds = [b"token_vault", escrow.key().as_ref()],
        bump,
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    /// Buyer's token account for refund
    #[account(
        mut,
        constraint = buyer_token_account.owner == buyer.key(),
        constraint = buyer_token_account.mint == escrow.mint
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ============== STREAMING ACCOUNTS ==============

#[derive(Accounts)]
pub struct InitializeStream<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: Seller account
    pub seller: UncheckedAccount<'info>,

    #[account(
        init,
        payer = buyer,
        space = StreamingEscrow::LEN,
        seeds = [b"stream", buyer.key().as_ref(), seller.key().as_ref()],
        bump
    )]
    pub stream: Account<'info, StreamingEscrow>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawStream<'info> {
    // Anyone can crank this technically, but usually seller
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"stream", stream.buyer.as_ref(), stream.seller.as_ref()],
        bump = stream.bump,
    )]
    pub stream: Account<'info, StreamingEscrow>,

    #[account(mut, address = stream.seller)]
    pub seller: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct TopUpStream<'info> {
    #[account(mut, address = stream.buyer)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"stream", stream.buyer.as_ref(), stream.seller.as_ref()],
        bump = stream.bump,
    )]
// ============== JURY ACCOUNTS ==============

#[derive(Accounts)]
pub struct InitiateJuryDispute<'info> {
    #[account(mut)]
    pub initiator: Signer<'info>, // Buyer or Seller

    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        init,
        payer = initiator,
        space = Jury::LEN,
        seeds = [b"jury", escrow.key().as_ref()],
        bump
    )]
    pub jury: Account<'info, Jury>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    pub juror: Signer<'info>,

    #[account(
        mut,
        seeds = [b"jury", jury.escrow.as_ref()],
        bump = jury.bump,
    )]
    pub jury: Account<'info, Jury>,
}

#[derive(Accounts)]
pub struct ExecuteJuryVerdict<'info> {
    // Anyone can execute once resolved
    pub executor: Signer<'info>,

    #[account(
        mut,
        seeds = [b"jury", escrow.key().as_ref()],
        bump = jury.bump,
    )]
    pub jury: Account<'info, Jury>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    /// CHECK: Buyer receives refund if they won
    #[account(mut, address = escrow.buyer)]
    pub buyer: UncheckedAccount<'info>,

    /// CHECK: Seller receives payout if they won
    #[account(mut, address = escrow.seller)]
    pub seller: UncheckedAccount<'info>,
}

// ============== MISC ACCOUNTS ==============

#[derive(Accounts)]
pub struct SettleCircleEscrow<'info> {
    pub oracle: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        seeds = [b"circle", circle.name.as_bytes()],
        bump = circle.bump,
    )]
    pub circle: Account<'info, CircleConfig>,

    /// CHECK: Circle treasury address (should match config but simplified for MVP)
    #[account(mut)]
    pub circle_treasury: UncheckedAccount<'info>,

    /// CHECK: Buyer receives refund
    #[account(mut, address = escrow.buyer)]
    pub buyer: UncheckedAccount<'info>,

    /// CHECK: Seller/Provider receives their share
    #[account(mut, address = escrow.seller)]
    pub seller: UncheckedAccount<'info>,
}

// ============== MISC ACCOUNTS ==============

#[derive(Accounts)]
pub struct LogWork<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,
}

// ============== DISPUTE ACCOUNTS ==============

#[derive(Accounts)]
pub struct RaiseDispute<'info> {
    /// Initiator (buyer or seller)
    #[account(mut)]
    pub initiator: Signer<'info>,

    /// The escrow being disputed
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump,
        constraint = initiator.key() == escrow.buyer || initiator.key() == escrow.seller
    )]
    pub escrow: Account<'info, Escrow>,

    /// Dispute account (created fresh)
    #[account(
        init,
        payer = initiator,
        space = Dispute::LEN,
        seeds = [b"dispute", escrow.key().as_ref()],
        bump
    )]
    pub dispute: Account<'info, Dispute>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    /// Admin who resolves the dispute (must match admin_config.admin)
    pub admin: Signer<'info>,

    /// Admin config PDA - verifies the admin is authorized
    #[account(
        seeds = [b"admin_config"],
        bump = admin_config.bump,
        constraint = admin.key() == admin_config.admin @ EscrowError::UnauthorizedAdmin
    )]
    pub admin_config: Account<'info, AdminConfig>,

    /// The escrow being resolved
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    /// The dispute record
    #[account(
        mut,
        seeds = [b"dispute", escrow.key().as_ref()],
        bump = dispute.bump,
    )]
    pub dispute: Account<'info, Dispute>,

    /// CHECK: Buyer receives their portion
    #[account(mut, address = escrow.buyer)]
    pub buyer: UncheckedAccount<'info>,

    /// CHECK: Seller receives their portion
    #[account(mut, address = escrow.seller)]
    pub seller: UncheckedAccount<'info>,
}

// ============== EVENTS ==============

#[event]
pub struct JuryVoteCast {
    pub jury: Pubkey,
    pub juror: Pubkey,
    pub vote_for_buyer: bool,
}

#[event]
pub struct AgentWorkLogged {
    pub agent: Pubkey,
    pub content_hash: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct DisputeRaised {
    pub escrow: Pubkey,
    pub initiator: Pubkey,
    pub reason: String,
    pub timestamp: i64,
}

#[event]
pub struct DisputeResolved {
    pub escrow: Pubkey,
    pub admin: Pubkey,
    pub buyer_payout: u64,
    pub seller_payout: u64,
    pub resolution: String,
    pub timestamp: i64,
}

// ============== ERRORS ==============

#[error_code]
pub enum EscrowError {
    #[msg("Invalid escrow status for this operation")]
    InvalidStatus,
    #[msg("Escrow has not expired yet")]
    NotExpired,
    #[msg("Dispute has already been resolved")]
    DisputeAlreadyResolved,
    #[msg("Invalid percentage (must be 0-100)")]
    InvalidPercentage,
    #[msg("Invalid signature")]
    InvalidSignature,
    #[msg("Signature verification failed")]
    SignatureVerificationFailed,
    #[msg("Proof already submitted")]
    ProofAlreadySubmitted,
    #[msg("Unauthorized: caller is not the authorized admin")]
    UnauthorizedAdmin,
}

// ============== TRUSTLESS USAGE PROOFS ==============

/// Usage Proof Account - stores signed usage reports
#[account]
#[derive(Default)]
pub struct UsageProof {
    pub escrow: Pubkey,      // Reference to escrow
    pub buyer: Pubkey,       // Buyer who signed
    pub seller: Pubkey,      // Provider who signed
    pub total_bytes: u64,    // Total bytes transferred
    pub period_start: i64,   // Start of usage window
    pub period_end: i64,     // End of usage window
    pub buyer_signed: bool,  // Buyer has signed
    pub seller_signed: bool, // Seller has signed
    pub submitted_at: i64,   // When proof was finalized
    pub bump: u8,
}

impl UsageProof {
    pub const LEN: usize = 8 + // discriminator
        32 + // escrow
        32 + // buyer
        32 + // seller
        8 +  // total_bytes
        8 +  // period_start
        8 +  // period_end
        1 +  // buyer_signed
        1 +  // seller_signed
        8 +  // submitted_at
        1; // bump
}

/// Submit usage proof with dual signatures (TRUSTLESS)
/// Both buyer and provider must sign for this to succeed
#[derive(Accounts)]
pub struct SubmitUsageProof<'info> {
    /// The submitter (can be either buyer or seller)
    #[account(mut)]
    pub submitter: Signer<'info>,

    /// The escrow this proof is for
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    /// Usage proof account (created fresh)
    #[account(
        init,
        payer = submitter,
        space = UsageProof::LEN,
        seeds = [b"usage_proof", escrow.key().as_ref(), &proof_index.to_le_bytes()],
        bump
    )]
    pub usage_proof: Account<'info, UsageProof>,

    /// CHECK: Ed25519 instruction sysvar for signature verification
    #[account(address = solana_program::sysvar::instructions::id())]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct UsageProofSubmitted {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub total_bytes: u64,
    pub period_start: i64,
    pub period_end: i64,
    pub timestamp: i64,
}
