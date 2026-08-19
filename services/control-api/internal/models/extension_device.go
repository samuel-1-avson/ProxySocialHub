package models

import (
	"time"

	"github.com/google/uuid"
)

// ExtensionDevice is a paired Chrome/Edge MV3 extension (PR-C).
type ExtensionDevice struct {
	ID               uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	UserID           uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex:idx_ext_dev_user_ext" json:"user_id"`
	ExtensionID      string     `gorm:"size:32;not null;uniqueIndex:idx_ext_dev_user_ext" json:"extension_id"`
	Name             string     `gorm:"size:100" json:"name"`
	RefreshTokenHash string     `gorm:"size:64" json:"-"`
	RefreshExpiresAt *time.Time `json:"refresh_expires_at,omitempty"`
	LastSeenAt       *time.Time `json:"last_seen_at,omitempty"`
	RevokedAt        *time.Time `json:"revoked_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

func (ExtensionDevice) TableName() string { return "extension_devices" }

// ExtensionPairCode is a one-time 60s pairing code minted by the logged-in website.
type ExtensionPairCode struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	CodeHash   string     `gorm:"size:64;not null;uniqueIndex" json:"-"`
	UserID     uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	ExpiresAt  time.Time  `gorm:"not null;index" json:"expires_at"`
	ConsumedAt *time.Time `json:"consumed_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

func (ExtensionPairCode) TableName() string { return "extension_pair_codes" }
