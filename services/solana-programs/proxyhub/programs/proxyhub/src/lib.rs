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

#[program]
pub mod proxyhub {
    use super::*;

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

    /// Settle escrow - Oracle signs off, SOL released proportionally
    pub fn settle_escrow(ctx: Context<SettleEscrow>, bandwidth_used_gb: u64) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        require!(
            escrow.status == EscrowStatus::Pending || escrow.status == EscrowStatus::Active,
            EscrowError::InvalidStatus
        );

        escrow.bandwidth_used_gb = bandwidth_used_gb;
        escrow.status = EscrowStatus::Settled;

        // Calculate payout
        let usage_ratio = if escrow.bandwidth_limit_gb > 0 {
            std::cmp::min(bandwidth_used_gb, escrow.bandwidth_limit_gb) as f64
                / escrow.bandwidth_limit_gb as f64
        } else {
            0.0
        };

        let seller_payout = (escrow.amount as f64 * usage_ratio) as u64;
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

        // Calculate payout
        let usage_ratio = if escrow.bandwidth_limit_gb > 0 {
            std::cmp::min(bandwidth_used_gb, escrow.bandwidth_limit_gb) as f64
                / escrow.bandwidth_limit_gb as f64
        } else {
            0.0
        };

        let seller_payout = (escrow.amount as f64 * usage_ratio) as u64;
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
    /// Admin who resolves the dispute (must be oracle/admin key)
    pub admin: Signer<'info>,

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
}
