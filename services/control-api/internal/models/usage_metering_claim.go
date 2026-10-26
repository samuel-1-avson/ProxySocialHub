package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// UsageMeteringClaim statuses (W-16 durable metering claims).
const (
	MeteringClaimClaimed  = "claimed"           // bytes atomically taken from Redis, settlement in flight
	MeteringClaimSettled  = "settled"           // debit/credit/journal committed in the same tx
	MeteringClaimExternal = "consumed_external" // bytes consumed by on-chain (escrow/PDA) settlement
	MeteringClaimRequeued = "requeued"          // settlement failed; bytes restored to Redis pending
)

// UsageMeteringClaim is the durable record of billable bytes taken out of
// Redis for settlement. Redis is a metering cache; once bytes are claimed,
// this row is the evidence — a crash between claim and settle is recovered
// by the stale-claim sweeper requeueing from the row, never by hoping the
// Redis key survived (W-16).
type UsageMeteringClaim struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	SessionID   uuid.UUID  `gorm:"type:uuid;not null;index" json:"session_id"`
	Bytes       int64      `gorm:"not null" json:"bytes"`
	SOLPriceUSD *float64   `gorm:"column:sol_price_usd" json:"sol_price_usd,omitempty"`
	Status      string     `gorm:"type:varchar(24);not null;default:'claimed';index" json:"status"`
	LastError   string     `gorm:"type:text" json:"last_error,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	SettledAt   *time.Time `json:"settled_at,omitempty"`
}

func (UsageMeteringClaim) TableName() string { return "usage_metering_claims" }

func (c *UsageMeteringClaim) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	if c.CreatedAt.IsZero() {
		c.CreatedAt = time.Now().UTC()
	}
	if c.Status == "" {
		c.Status = MeteringClaimClaimed
	}
	return nil
}
