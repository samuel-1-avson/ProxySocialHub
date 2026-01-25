package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Transaction types
const (
	TransactionTopup   = "topup"
	TransactionUsage   = "usage"
	TransactionPayout  = "payout"
	TransactionRefund  = "refund"
	TransactionEarning = "earning"
)

type Wallet struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	UserID      uuid.UUID `gorm:"type:uuid;unique;not null" json:"user_id"`
	BalanceGHS  float64   `gorm:"type:numeric(20,4);default:0" json:"balance_ghs"`  // Fiat (Legacy)
	BalanceSOL  float64   `gorm:"type:numeric(20,4);default:0" json:"balance_sol"`  // Native Token
	BalanceUSDT float64   `gorm:"type:numeric(20,4);default:0" json:"balance_usdt"` // Stablecoin
	// Deprecating single Balance/Currency fields in favor of explicit columns
	Currency  string    `gorm:"type:varchar(10);default:'MULTI'" json:"currency"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type WalletLedgerEntry struct {
	ID           uuid.UUID `gorm:"type:uuid;primary_key"`
	WalletID     uuid.UUID `gorm:"type:uuid;not null"`
	Amount       float64   `gorm:"type:numeric(20,4);not null"`
	BalanceAfter float64   `gorm:"type:numeric(20,4);not null"`
	Type         string    `gorm:"type:varchar(50);not null"` // 'topup', 'usage_charge', 'payout', 'refund'
	ReferenceID  string    `gorm:"type:varchar(128)"`         // Solana tx sigs are 88 chars
	TxHash       string    `gorm:"size:255" json:"tx_hash,omitempty"`
	Description  string
	CreatedAt    time.Time
}

func (w *Wallet) BeforeCreate(tx *gorm.DB) (err error) {
	if w.ID == uuid.Nil {
		w.ID = uuid.New()
	}
	return
}

func (e *WalletLedgerEntry) BeforeCreate(tx *gorm.DB) (err error) {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	return
}
