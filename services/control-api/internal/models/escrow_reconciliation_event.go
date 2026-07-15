package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

const (
	EscrowReconciliationStatusUnmatched         = "unmatched"
	EscrowReconciliationStatusRefundFailed      = "refund_failed"
	EscrowReconciliationStatusInvalidState      = "invalid_state"
	EscrowReconciliationStatusResolved          = "resolved"
	EscrowReconciliationStatusActivationPending = "activation_pending"
	EscrowReconciliationStatusActivationFailed  = "activation_failed"
	EscrowReconciliationStatusActivationSynced  = "activation_synced"
)

type EscrowReconciliationEvent struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key" json:"id"`
	Source      string         `gorm:"size:64;not null;uniqueIndex:uq_escrow_reconciliation_source_event" json:"source"`
	EventType   string         `gorm:"size:64;not null;uniqueIndex:uq_escrow_reconciliation_source_event" json:"event_type"`
	EscrowPDA   string         `gorm:"size:64;not null;index;uniqueIndex:uq_escrow_reconciliation_source_event" json:"escrow_pda"`
	TxSignature string         `gorm:"size:128;not null;default:'';uniqueIndex:uq_escrow_reconciliation_source_event" json:"tx_signature"`
	OrderID     *uuid.UUID     `gorm:"type:uuid;index" json:"order_id,omitempty"`
	Status      string         `gorm:"size:32;not null;default:'unmatched';index" json:"status"`
	Reason      string         `gorm:"size:128;not null;default:''" json:"reason"`
	LastError   string         `gorm:"type:text;not null;default:''" json:"last_error"`
	Attempts    int            `gorm:"not null;default:1" json:"attempts"`
	Payload     datatypes.JSON `gorm:"type:jsonb;default:'{}'" json:"payload"`
	FirstSeenAt time.Time      `gorm:"not null" json:"first_seen_at"`
	LastSeenAt  time.Time      `gorm:"not null;index" json:"last_seen_at"`
	ResolvedAt  *time.Time     `json:"resolved_at,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`

	Order *Order `gorm:"foreignKey:OrderID" json:"order,omitempty"`
}

func (EscrowReconciliationEvent) TableName() string {
	return "escrow_reconciliation_events"
}

func (e *EscrowReconciliationEvent) BeforeCreate(tx *gorm.DB) error {
	now := time.Now()
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	if e.FirstSeenAt.IsZero() {
		e.FirstSeenAt = now
	}
	if e.LastSeenAt.IsZero() {
		e.LastSeenAt = now
	}
	if e.TxSignature == "" {
		e.TxSignature = ""
	}
	if len(e.Payload) == 0 {
		e.Payload = datatypes.JSON([]byte("{}"))
	}
	return nil
}
