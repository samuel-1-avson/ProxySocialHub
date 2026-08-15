package models

import (
	"time"

	"github.com/google/uuid"
)

// ProtocolIncentiveEvent is Wave 4.3/5.C.4 fee/reward accounting.
// Observe mode never moves funds. Settle mode may dual-gate hot-wallet SendSOL
// for the provider incentive share — still no PHB/PHUBB mint.
type ProtocolIncentiveEvent struct {
	ID                   uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	SessionID            *uuid.UUID `gorm:"type:uuid;index" json:"session_id,omitempty"`
	ProviderUserID       *uuid.UUID `gorm:"type:uuid;index" json:"provider_user_id,omitempty"`
	NodeID               *uuid.UUID `gorm:"type:uuid" json:"node_id,omitempty"`
	EventType            string     `gorm:"type:varchar(64);not null;default:'settlement_split'" json:"event_type"`
	Mode                 string     `gorm:"type:varchar(16);not null;default:'observe'" json:"mode"`
	Status               string     `gorm:"type:varchar(32);not null;default:'observed'" json:"status"`
	GrossAmountSOL       float64    `gorm:"type:numeric(20,8);not null;default:0" json:"gross_amount_sol"`
	ProtocolFeeSOL       float64    `gorm:"type:numeric(20,8);not null;default:0" json:"protocol_fee_sol"`
	ProviderIncentiveSOL float64    `gorm:"type:numeric(20,8);not null;default:0" json:"provider_incentive_sol"`
	GatewayIncentiveSOL  float64    `gorm:"type:numeric(20,8);not null;default:0" json:"gateway_incentive_sol"`
	TreasuryRetainSOL    float64    `gorm:"type:numeric(20,8);not null;default:0" json:"treasury_retain_sol"`
	FeeBPS               int        `gorm:"not null;default:0" json:"fee_bps"`
	ProviderShareBPS     int        `gorm:"not null;default:0" json:"provider_share_bps"`
	GatewayShareBPS      int        `gorm:"not null;default:0" json:"gateway_share_bps"`
	RecipientWallet      string     `gorm:"type:varchar(64);not null;default:''" json:"recipient_wallet,omitempty"`
	TxHash               string     `gorm:"type:varchar(128);not null;default:''" json:"tx_hash,omitempty"`
	SettledAt            *time.Time `json:"settled_at,omitempty"`
	Note                 string     `gorm:"type:text;not null;default:''" json:"note"`
	CreatedAt            time.Time  `json:"created_at"`
}

func (ProtocolIncentiveEvent) TableName() string {
	return "protocol_incentive_events"
}
