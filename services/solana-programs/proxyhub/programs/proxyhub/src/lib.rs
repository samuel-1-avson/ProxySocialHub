use anchor_lang::prelude::*;
use anchor_lang::system_program;

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

/// The Escrow Account PDA
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

#[program]
pub mod proxyhub {
    use super::*;

    /// Initialize escrow - Buyer deposits funds
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

    /// Settle escrow - Oracle signs off, funds released proportionally
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

    /// Refund escrow - If expired and unused
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
}

// ============== ACCOUNTS ==============

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

#[derive(Accounts)]
pub struct LogWork<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,
}

#[event]
pub struct AgentWorkLogged {
    pub agent: Pubkey,
    pub content_hash: [u8; 32],
    pub timestamp: i64,
}

// ============== ERRORS ==============

#[error_code]
pub enum EscrowError {
    #[msg("Invalid escrow status for this operation")]
    InvalidStatus,
    #[msg("Escrow has not expired yet")]
    NotExpired,
}
