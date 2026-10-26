package models

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Transaction types for SOL-only system
const (
	TransactionTopup   = "topup"
	TransactionUsage   = "usage"
	TransactionPayout  = "payout"
	TransactionRefund  = "refund"
	TransactionEarning = "earning"
)

// Wallet represents a user's SOL-only wallet
// All balances are stored in SOL (Solana native token)
type Wallet struct {
	ID         uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	UserID     uuid.UUID `gorm:"type:uuid;unique;not null" json:"user_id"`
	BalanceSOL float64   `gorm:"column:balance_sol;type:numeric(20,9);default:0" json:"balance_sol"`
	// BalanceLamports mirrors balance_sol at 1e9 scale (DB trigger keeps them aligned).
	BalanceLamports int64 `gorm:"column:balance_lamports;default:0" json:"balance_lamports"`
	// W-10: subset of BalanceLamports that is provider earnings payable
	// on-chain. Invariant: 0 <= payable <= balance. Payouts sweep only this.
	EarningsPayableLamports    int64 `gorm:"column:earnings_payable_lamports;default:0" json:"earnings_payable_lamports"`
	AutoPayoutEnabled          bool  `gorm:"column:auto_payout_enabled;default:false" json:"auto_payout_enabled"`
	AutoPayoutThresholdLamports int64 `gorm:"column:auto_payout_threshold_lamports;default:50000000" json:"auto_payout_threshold_lamports"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`

	// Spending Limits (Security Feature)
	// P2-17: LimitsEnabled is the gate. When false, all spending is allowed
	// regardless of limit values. When true, DailyLimit/WeeklyLimit/MonthlyLimit
	// of 0 mean "zero allowed" (not "unlimited").
	LimitsEnabled    bool      `gorm:"column:limits_enabled;default:true" json:"limits_enabled"`
	DailyLimit       float64   `gorm:"column:daily_limit;type:numeric(20,9);default:0" json:"daily_limit"`
	WeeklyLimit      float64   `gorm:"column:weekly_limit;type:numeric(20,9);default:0" json:"weekly_limit"`
	MonthlyLimit     float64   `gorm:"column:monthly_limit;type:numeric(20,9);default:0" json:"monthly_limit"`
	LimitWindowStart time.Time `gorm:"column:limit_window_start" json:"limit_window_start"`

	// Withdrawal Security (Cooldown and Whitelist)
	WithdrawalWhitelist        []string   `gorm:"column:withdrawal_whitelist;serializer:json" json:"withdrawal_whitelist"`
	PrimaryWithdrawalAddress   *string    `gorm:"column:primary_withdrawal_address" json:"primary_withdrawal_address"`
	WithdrawalAddressChangedAt *time.Time `gorm:"column:withdrawal_address_changed_at" json:"withdrawal_address_changed_at"`
}

// WalletLedgerEntry tracks all wallet transactions (append-only in Postgres).
type WalletLedgerEntry struct {
	ID                   uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	WalletID             uuid.UUID `gorm:"type:uuid;not null" json:"wallet_id"`
	Amount               float64   `gorm:"type:numeric(20,9);not null" json:"amount"` // Positive = credit, Negative = debit
	BalanceAfter         float64   `gorm:"type:numeric(20,9);not null" json:"balance_after"`
	AmountLamports       int64     `gorm:"column:amount_lamports;default:0" json:"amount_lamports"`
	BalanceAfterLamports int64     `gorm:"column:balance_after_lamports;default:0" json:"balance_after_lamports"`
	Type                 string    `gorm:"type:varchar(50);not null" json:"type"` // topup, usage, payout, refund, earning
	ReferenceID          string    `gorm:"type:varchar(128)" json:"reference_id,omitempty"` // Solana tx signature (88 chars)
	TxHash               string    `gorm:"size:255" json:"tx_hash,omitempty"`
	Description          string    `json:"description"`
	CreatedAt            time.Time `json:"created_at"`
}

// WithdrawalDestination returns the on-chain address for payouts.
// W-34: the withdrawal whitelist was removed - the destination is
// pinned to the proven linked wallet (enforced below), which made the
// separate whitelist redundant. The withdrawal_whitelist column is
// retained for data compatibility and no longer consulted.
func (w *Wallet) WithdrawalDestination(linkedAddress *string) (string, error) {
	var dest string
	if w.PrimaryWithdrawalAddress != nil && *w.PrimaryWithdrawalAddress != "" {
		dest = *w.PrimaryWithdrawalAddress
	} else if linkedAddress != nil && *linkedAddress != "" {
		dest = *linkedAddress
	} else {
		return "", errors.New("no withdrawal destination configured")
	}

	if linkedAddress == nil || *linkedAddress == "" {
		return "", errors.New("link a Solana wallet before withdrawing")
	}
	if dest != *linkedAddress {
		return "", fmt.Errorf("withdrawal destination must match your linked wallet; re-link or update primary address")
	}

	return dest, nil
}

// BeforeSave keeps the deprecated float shadow consistent with the
// authoritative lamports balance (W-19). Struct-level Saves in tests and
// legacy writers that only set BalanceSOL are repaired here, once.
func (w *Wallet) BeforeSave(tx *gorm.DB) (err error) {
	w.SyncLamportsFromSOLForLegacyRow()
	return nil
}

// BeforeCreate generates UUID if not set
func (w *Wallet) BeforeCreate(tx *gorm.DB) (err error) {
	if w.ID == uuid.Nil {
		w.ID = uuid.New()
	}
	return
}

// BeforeCreate generates UUID if not set
func (e *WalletLedgerEntry) BeforeCreate(tx *gorm.DB) (err error) {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	return
}
