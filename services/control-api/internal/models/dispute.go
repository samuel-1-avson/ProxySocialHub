package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Dispute represents a consumer-raised complaint against a provider session.
type Dispute struct {
	ID          uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	SessionID   uuid.UUID      `gorm:"type:uuid;not null;index" json:"session_id"`
	ConsumerID  uuid.UUID      `gorm:"type:uuid;not null;index" json:"consumer_id"`
	ProviderID  uuid.UUID      `gorm:"type:uuid;not null;index" json:"provider_id"`
	NodeID      uuid.UUID      `gorm:"type:uuid;not null" json:"node_id"`
	// Reason: no_service | slow_speed | wrong_geo | connection_drops | other
	Reason      string         `gorm:"type:varchar(50);not null" json:"reason"`
	Description string         `gorm:"type:text" json:"description,omitempty"`
	// Status: open | resolved | dismissed
	Status      string         `gorm:"type:varchar(20);not null;default:'open';index" json:"status"`
	Resolution  string         `gorm:"type:text" json:"resolution,omitempty"`
	RefundSOL   float64        `gorm:"type:numeric(20,8);default:0" json:"refund_sol"`
	CreatedAt   time.Time      `json:"created_at"`
	ResolvedAt  *time.Time     `json:"resolved_at,omitempty"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}

func (Dispute) TableName() string { return "disputes" }

func (d *Dispute) BeforeCreate(tx *gorm.DB) error {
	if d.ID == uuid.Nil {
		d.ID = uuid.New()
	}
	return nil
}
