package models

import (
	"time"

	"github.com/google/uuid"
)

// Lifecycle of a provider pairing: pending -> approved -> redeemed, or pending -> denied.
// A pending or approved row past ExpiresAt is treated as expired; there is no stored
// "expired" state.
const (
	ProviderPairingPending  = "pending"
	ProviderPairingApproved = "approved"
	ProviderPairingDenied   = "denied"
	ProviderPairingRedeemed = "redeemed"
)

// ProviderPairing is one device-pairing request (see migrations/000169). The node holds
// the device code; only its SHA-256 is stored here.
type ProviderPairing struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	DeviceCodeHash string     `gorm:"type:varchar(64);not null;uniqueIndex" json:"-"`
	UserCode       string     `gorm:"type:varchar(16);not null;uniqueIndex" json:"user_code"`
	Status         string     `gorm:"type:varchar(16);not null;default:'pending'" json:"status"`
	DeviceName     string     `gorm:"type:varchar(100);not null" json:"device_name"`
	Platform       string     `gorm:"type:varchar(32);not null" json:"platform"`
	Arch           string     `gorm:"type:varchar(32);not null" json:"arch"`
	ClientVersion  string     `gorm:"type:varchar(32);not null" json:"client_version"`
	CreatedIP      string     `gorm:"type:varchar(64);not null" json:"created_ip"`
	UserID         *uuid.UUID `gorm:"type:uuid" json:"user_id,omitempty"`
	TokenID        *uuid.UUID `gorm:"type:uuid" json:"token_id,omitempty"`
	NodeID         *uuid.UUID `gorm:"type:uuid" json:"node_id,omitempty"`
	NextPollAt     time.Time  `gorm:"not null" json:"-"`
	ExpiresAt      time.Time  `gorm:"not null" json:"expires_at"`
	ApprovedAt     *time.Time `json:"approved_at,omitempty"`
	RedeemedAt     *time.Time `json:"redeemed_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// TableName specifies the table name.
func (ProviderPairing) TableName() string {
	return "provider_pairings"
}
