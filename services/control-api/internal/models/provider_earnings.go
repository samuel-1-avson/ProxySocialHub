package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ProviderEarning records a single earning event for a provider node tied to a completed session.
type ProviderEarning struct {
	ID                 uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ProviderUserID     uuid.UUID      `gorm:"type:uuid;not null;index;uniqueIndex:idx_provider_earnings_provider_session" json:"provider_user_id"`
	NodeID             uuid.UUID      `gorm:"type:uuid;not null;index" json:"node_id"`
	SessionID          uuid.UUID      `gorm:"type:uuid;not null;index;uniqueIndex:idx_provider_earnings_provider_session" json:"session_id"`
	BandwidthGB        float64        `gorm:"type:numeric(20,8);not null;default:0" json:"bandwidth_gb"`
	GrossAmountSOL     float64        `gorm:"type:numeric(20,8);not null;default:0" json:"gross_amount_sol"`
	PlatformFeeSOL     float64        `gorm:"type:numeric(20,8);not null;default:0" json:"platform_fee_sol"`
	NetAmountSOL       float64        `gorm:"type:numeric(20,8);not null;default:0" json:"net_amount_sol"`
	EarningsMultiplier float64        `gorm:"type:numeric(5,4);not null;default:1.0" json:"earnings_multiplier"`
	PricePerGB         float64        `gorm:"type:numeric(20,8);not null;default:0" json:"price_per_gb"`
	// Status: pending | paid | failed
	Status             string         `gorm:"type:varchar(20);not null;default:'pending';index" json:"status"`
	PayoutBatchID      *uuid.UUID     `gorm:"type:uuid" json:"payout_batch_id,omitempty"`
	TxHash             string         `gorm:"type:varchar(128)" json:"tx_hash,omitempty"`
	CreatedAt          time.Time      `json:"created_at"`
	PaidAt             *time.Time     `json:"paid_at,omitempty"`
	DeletedAt          gorm.DeletedAt `gorm:"index" json:"-"`
}

func (ProviderEarning) TableName() string {
	return "provider_earnings"
}

func (e *ProviderEarning) BeforeCreate(tx *gorm.DB) error {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	return nil
}
