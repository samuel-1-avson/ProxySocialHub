package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type StakingStatus string

const (
	StakingActive    StakingStatus = "active"
	StakingUnstaked  StakingStatus = "unstaked"
	StakingWithdrawn StakingStatus = "withdrawn"
)

// StakingPosition represents a user's staked funds
type StakingPosition struct {
	ID        uuid.UUID     `gorm:"type:uuid;primary_key" json:"id"`
	UserID    uuid.UUID     `gorm:"type:uuid;not null;index" json:"user_id"`
	WalletID  uuid.UUID     `gorm:"type:uuid;not null;index" json:"wallet_id"`
	Amount    float64       `gorm:"type:numeric(20,4);not null" json:"amount"`
	Currency  string        `gorm:"type:varchar(10);default:'TAO'" json:"currency"`
	APY       float64       `gorm:"type:numeric(5,2);default:15.0" json:"apy"` // Annual Percentage Yield (e.g. 15.0%)
	StartTime time.Time     `json:"start_time"`
	EndTime   *time.Time    `json:"end_time,omitempty"` // When it was unstaked
	Status    StakingStatus `gorm:"type:varchar(20);default:'active'" json:"status"`

	// AccruedYield is a snapshot updated periodically or on unstake
	AccruedYield float64 `gorm:"type:numeric(20,4);default:0" json:"accrued_yield"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (StakingPosition) TableName() string {
	return "staking_positions"
}

func (s *StakingPosition) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	if s.Status == "" {
		s.Status = StakingActive
	}
	return nil
}
