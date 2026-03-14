package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type SessionType string

const (
	SessionRotating SessionType = "rotating"
	SessionSticky   SessionType = "sticky"
)

type SessionStatus string

const (
	SessionActive     SessionStatus = "active"
	SessionDisabled   SessionStatus = "disabled"
	SessionTerminated SessionStatus = "terminated"
)

type Session struct {
	ID              uuid.UUID     `gorm:"type:uuid;primary_key" json:"id"`
	UserID          uuid.UUID     `gorm:"type:uuid;not null;index:idx_session_user" json:"user_id"`
	NodeID          *uuid.UUID    `gorm:"type:uuid;index:idx_session_node" json:"node_id"`       // Nullable
	ListingID       *uuid.UUID    `gorm:"type:uuid;index:idx_session_listing" json:"listing_id"` // Link to marketplace listing
	Type            SessionType   `gorm:"type:varchar(50);not null" json:"type"`
	Status          SessionStatus `gorm:"type:varchar(50);default:'active';index:idx_session_status" json:"status"`
	TxHash          string        `gorm:"size:255" json:"tx_hash,omitempty"`
	CredentialsUser string        `gorm:"type:varchar(255)" json:"credentials_user"`
	CredentialsPass string        `gorm:"type:varchar(255)" json:"credentials_pass"`
	Config          string        `gorm:"type:jsonb" json:"config"`
	BandwidthLimit  int64         `gorm:"default:0" json:"bandwidth_limit"` // in bytes, 0 = unlimited
	StartTime       time.Time     `json:"start_time"`
	EndTime         time.Time     `json:"end_time"`
	BytesUsed       int64         `json:"bytes_used"`
	ExpiresAt       *time.Time    `json:"expires_at"`
	CreatedAt       time.Time     `json:"created_at"`
	// N-06: soft-delete — GORM automatically adds WHERE deleted_at IS NULL to all queries.
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`

	// Relations
	Listing *ProxyListing `gorm:"foreignKey:ListingID" json:"listing,omitempty"`

	// Universal Session Fields
	Strategy string  `gorm:"size:50" json:"strategy,omitempty"` // e.g., "fastest", "cheapest", "random"
	MaxPrice float64 `json:"max_price,omitempty"`               // Max price per GB user is willing to pay
}

func (s *Session) BeforeCreate(tx *gorm.DB) (err error) {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return
}
