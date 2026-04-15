package models

import (
	"time"

	"github.com/google/uuid"
)

// PayoutRetryQueue holds failed on-chain payout attempts for later retry with exponential backoff.
type PayoutRetryQueue struct {
	ID              uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	ProviderID      uuid.UUID `gorm:"type:uuid;not null;index"`
	WalletAddress   string    `gorm:"size:64;not null"`
	AmountSOL       float64   `gorm:"type:decimal(20,8);not null"`
	AttemptCount    int       `gorm:"default:0"`
	LastAttemptedAt *time.Time
	NextRetryAt     time.Time `gorm:"default:now();not null"`
	Status          string    `gorm:"size:20;default:'pending';not null"`
	ErrorMessage    *string   `gorm:"type:text"`
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (PayoutRetryQueue) TableName() string {
	return "payout_retry_queue"
}
