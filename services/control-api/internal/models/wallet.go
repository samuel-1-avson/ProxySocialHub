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
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID    uuid.UUID `gorm:"type:uuid;unique;not null"`
	Balance   float64   `gorm:"type:numeric(20,4);default:0"`
	Currency  string    `gorm:"type:varchar(3);default:'GHS'"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

type WalletLedgerEntry struct {
	ID           uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	WalletID     uuid.UUID `gorm:"type:uuid;not null"`
	Amount       float64   `gorm:"type:numeric(20,4);not null"`
	BalanceAfter float64   `gorm:"type:numeric(20,4);not null"`
	Type         string    `gorm:"type:varchar(50);not null"` // 'topup', 'usage_charge', 'payout', 'refund'
	ReferenceID  string
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
