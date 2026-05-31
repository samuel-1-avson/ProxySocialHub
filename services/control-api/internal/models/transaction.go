package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// PendingTransaction tracks crypto transactions awaiting confirmation
type PendingTransaction struct {
	ID             uuid.UUID `gorm:"type:uuid;primary_key"`
	Reference      string    `gorm:"type:varchar(128);unique;not null"`              // Our internal reference (Solana sigs are 88 chars)
	ExternalRef    string    `gorm:"type:varchar(128)"`                              // Provider's transaction ID
	IdempotencyKey string    `gorm:"type:varchar(128);uniqueIndex" json:"idempotency_key"` // Client provided key for retries; unique enforced by DB
	UserID         uuid.UUID `gorm:"type:uuid;not null;index"` // P2-16: changed from string to uuid.UUID for FK consistency
	Type           string    `gorm:"type:varchar(20);not null"` // "deposit" or "withdrawal"
	Amount         float64   `gorm:"type:numeric(20,9);not null"` // Amount in SOL
	Currency       string    `gorm:"type:varchar(20);default:'SOL'"` // SOL only
	Provider       string    `gorm:"type:varchar(20);not null"`      // "blockchain" (SOL only)
	Phone          *string   `gorm:"type:varchar(20)"`               // Deprecated: kept for backward compatibility
	Status         string    `gorm:"type:varchar(20);default:'pending'"` // "pending", "completed", "failed"
	FailureReason  string    `gorm:"type:text"`
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

func (p *PendingTransaction) BeforeCreate(tx *gorm.DB) (err error) {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	// Empty string violates UNIQUE on idempotency_key (only one '' allowed). Use on-chain ref when unset.
	if p.IdempotencyKey == "" && p.Reference != "" {
		p.IdempotencyKey = p.Reference
	}
	return
}
