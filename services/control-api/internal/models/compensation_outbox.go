package models

import (
	"time"

	"github.com/google/uuid"
)

const (
	CompensationKindWithdrawalRefund = "withdrawal_refund"
	CompensationKindP2PRefund        = "p2p_refund"
	CompensationKindP2PSettle        = "p2p_settle"

	CompensationStatusPending         = "pending"
	CompensationStatusSucceeded       = "succeeded"
	CompensationStatusFailedPermanent = "failed_permanent"
)

// CompensationOutbox retries failed DB compensating refunds after on-chain
// withdraw/P2P sends fail, and durable forward P2P settles after ledger commit.
type CompensationOutbox struct {
	ID                 uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Kind               string     `gorm:"size:40;not null;uniqueIndex:idx_comp_kind_ref" json:"kind"`
	UserID             uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	CounterpartyUserID *uuid.UUID `gorm:"type:uuid" json:"counterparty_user_id,omitempty"`
	AmountSOL          float64    `gorm:"column:amount_sol;type:numeric(20,9);not null" json:"amount_sol"`
	ReferenceID        string     `gorm:"size:128;not null;uniqueIndex:idx_comp_kind_ref" json:"reference_id"`
	Metadata           string     `gorm:"column:metadata;type:jsonb;not null;default:'{}'" json:"metadata,omitempty"`
	AttemptCount       int        `gorm:"not null;default:0" json:"attempt_count"`
	LastAttemptedAt    *time.Time `json:"last_attempted_at,omitempty"`
	NextRetryAt        time.Time  `gorm:"not null;default:now()" json:"next_retry_at"`
	Status             string     `gorm:"size:20;not null;default:'pending'" json:"status"`
	LastError          *string    `gorm:"type:text" json:"last_error,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

func (CompensationOutbox) TableName() string {
	return "compensation_outbox"
}
