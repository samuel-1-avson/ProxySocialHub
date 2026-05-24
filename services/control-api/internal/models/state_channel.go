package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ChannelStatus string

const (
	ChannelOpen     ChannelStatus = "open"
	ChannelClosing  ChannelStatus = "closing"
	ChannelClosed   ChannelStatus = "closed"
	ChannelDisputed ChannelStatus = "disputed"
)

// ChannelState represents the off-chain signed state
type ChannelState struct {
	Nonce       uint64 `json:"nonce"`
	TotalAmount uint64 `json:"total_amount"` // In Lamports / Smallest unit
	TotalBytes  uint64 `json:"total_bytes"`
	Signature   string `json:"signature"` // Ed25519 hex signature
	Timestamp   int64  `json:"timestamp"`
}

type StateChannel struct {
	ID         uuid.UUID     `gorm:"type:uuid;primary_key" json:"id"`
	SessionID  uuid.UUID     `gorm:"type:uuid;not null;index" json:"session_id"`
	ProviderID uuid.UUID     `gorm:"type:uuid;not null;index" json:"provider_id"`
	BuyerID    uuid.UUID     `gorm:"type:uuid;not null;index" json:"buyer_id"`
	Status     ChannelStatus `gorm:"type:varchar(20);default:'open'" json:"status"`

	// On-Chain References
	EscrowPubkey  string `gorm:"type:varchar(44)" json:"escrow_pubkey"`   // Solana Address
	OnchainPDA    string `gorm:"type:varchar(44)" json:"onchain_pda"`     // State channel PDA (set after open_channel tx)
	OnchainTxSig  string `gorm:"type:varchar(88)" json:"onchain_tx_sig"`  // open_channel tx signature

	// State Snapshot (JSONB)
	LastState ChannelState `gorm:"type:jsonb;serializer:json" json:"last_state"`

	// Limits
	TotalDeposit uint64    `gorm:"not null" json:"total_deposit"`
	ExpiresAt    time.Time `json:"expires_at"`

	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	ClosedAt  *time.Time `json:"closed_at,omitempty"`
}

func (sc *StateChannel) BeforeCreate(tx *gorm.DB) (err error) {
	if sc.ID == uuid.Nil {
		sc.ID = uuid.New()
	}
	return
}
