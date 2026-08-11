package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Withdrawal payout queue statuses (FIFO drain by worker).
const (
	WithdrawalPayoutRequested   = "requested"
	WithdrawalPayoutFunding     = "funding"
	WithdrawalPayoutPaying      = "paying"
	WithdrawalPayoutCompleted   = "completed"
	WithdrawalPayoutFailed      = "failed"
	WithdrawalPayoutOpsRequired = "ops_required"
)

// WithdrawalPayout is a user SOL withdrawal waiting on hot-wallet liquidity.
type WithdrawalPayout struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	UserID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	WalletID    *uuid.UUID `gorm:"type:uuid" json:"wallet_id,omitempty"`
	Reference   string     `gorm:"type:varchar(128);uniqueIndex;not null" json:"reference"`
	Destination string     `gorm:"type:varchar(64);not null" json:"destination"`
	AmountSOL   float64    `gorm:"column:amount_sol;type:numeric(20,9);not null" json:"amount_sol"`
	Status      string     `gorm:"type:varchar(20);not null;default:'requested';index" json:"status"`
	Attempts    int        `gorm:"not null;default:0" json:"attempts"`
	LastError   string     `gorm:"type:text" json:"last_error,omitempty"`
	TxHash      string     `gorm:"type:varchar(128)" json:"tx_hash,omitempty"`
	FundedAt    *time.Time `json:"funded_at,omitempty"`
	PaidAt      *time.Time `json:"paid_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

func (WithdrawalPayout) TableName() string {
	return "withdrawal_payout_queue"
}

func (w *WithdrawalPayout) BeforeCreate(tx *gorm.DB) error {
	if w.ID == uuid.Nil {
		w.ID = uuid.New()
	}
	if w.Status == "" {
		w.Status = WithdrawalPayoutRequested
	}
	return nil
}

// ActiveWithdrawalPayoutStatuses are rows the worker may still process.
func ActiveWithdrawalPayoutStatuses() []string {
	return []string{
		WithdrawalPayoutRequested,
		WithdrawalPayoutFunding,
		WithdrawalPayoutPaying,
		WithdrawalPayoutOpsRequired,
	}
}
