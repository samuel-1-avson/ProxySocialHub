package models

import (
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
	TransactionSwap    = "swap"
)

// Wallet represents a user's SOL-only wallet
// All balances are stored in SOL (Solana native token)
type Wallet struct {
	ID         uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	UserID     uuid.UUID `gorm:"type:uuid;unique;not null" json:"user_id"`
	BalanceSOL float64   `gorm:"column:balance_sol;type:numeric(20,9);default:0" json:"balance_sol"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`

	// Spending Limits (Security Feature)
	// P2-17: LimitsEnabled is the gate. When false, all spending is allowed
	// regardless of limit values. When true, DailyLimit/WeeklyLimit/MonthlyLimit
	// of 0 mean "zero allowed" (not "unlimited").
	LimitsEnabled    bool      `gorm:"column:limits_enabled;default:false" json:"limits_enabled"`
	DailyLimit       float64   `gorm:"column:daily_limit;type:numeric(20,9);default:0" json:"daily_limit"`
	WeeklyLimit      float64   `gorm:"column:weekly_limit;type:numeric(20,9);default:0" json:"weekly_limit"`
	MonthlyLimit     float64   `gorm:"column:monthly_limit;type:numeric(20,9);default:0" json:"monthly_limit"`
	LimitWindowStart time.Time `gorm:"column:limit_window_start" json:"limit_window_start"`
}

// WalletLedgerEntry tracks all wallet transactions
type WalletLedgerEntry struct {
	ID           uuid.UUID `gorm:"type:uuid;primary_key"`
	WalletID     uuid.UUID `gorm:"type:uuid;not null"`
	Amount       float64   `gorm:"type:numeric(20,9);not null"` // Positive = credit, Negative = debit
	BalanceAfter float64   `gorm:"type:numeric(20,9);not null"`
	Type         string    `gorm:"type:varchar(50);not null"` // topup, usage, payout, refund, earning
	ReferenceID  string    `gorm:"type:varchar(128)"`         // Solana tx signature (88 chars)
	TxHash       string    `gorm:"size:255" json:"tx_hash,omitempty"`
	Description  string
	CreatedAt    time.Time
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
