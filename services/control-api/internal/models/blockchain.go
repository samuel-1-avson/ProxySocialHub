package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// BlockchainType represents supported blockchain networks
type BlockchainType string

const (
	ChainSolana    BlockchainType = "solana"
	ChainEthereum  BlockchainType = "ethereum"
	ChainBittensor BlockchainType = "bittensor"
)

// LinkedWallet represents a user's linked blockchain wallet
type LinkedWallet struct {
	ID                    uuid.UUID      `gorm:"type:uuid;primary_key" json:"id"`
	UserID                uuid.UUID      `gorm:"type:uuid;not null;index:idx_linked_wallet_user" json:"user_id"`
	Chain                 BlockchainType `gorm:"size:20;not null;index:idx_linked_wallet_chain" json:"chain"`
	Address               string         `gorm:"size:64;not null;uniqueIndex:idx_linked_wallet_unique" json:"address"`
	Verified              bool           `gorm:"default:false" json:"verified"`
	VerificationSignature *string        `gorm:"type:text" json:"verification_signature,omitempty"`
	VerificationMessage   *string        `gorm:"size:255" json:"verification_message,omitempty"`
	IsPrimary             bool           `gorm:"default:false" json:"is_primary"`
	Label                 *string        `gorm:"size:50" json:"label,omitempty"` // User-defined label
	CreatedAt             time.Time      `json:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at"`

	// Relations
	User *User `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (LinkedWallet) TableName() string {
	return "linked_wallets"
}

func (w *LinkedWallet) BeforeCreate(tx *gorm.DB) error {
	if w.ID == uuid.Nil {
		w.ID = uuid.New()
	}
	return nil
}

// BlockchainAccountType represents the type of on-chain account
type BlockchainAccountType string

const (
	AccountEscrow      BlockchainAccountType = "escrow"
	AccountTokenEscrow BlockchainAccountType = "token_escrow"
	AccountDispute     BlockchainAccountType = "dispute"
	AccountVault       BlockchainAccountType = "vault"
)

// BlockchainStateCache caches on-chain account state for quick lookups
type BlockchainStateCache struct {
	ID           uuid.UUID             `gorm:"type:uuid;primary_key" json:"id"`
	PDA          string                `gorm:"size:64;not null;uniqueIndex:idx_cache_pda" json:"pda"`
	ProgramID    string                `gorm:"size:64;not null" json:"program_id"`
	AccountType  BlockchainAccountType `gorm:"size:50;not null;index:idx_cache_type" json:"account_type"`
	Data         string                `gorm:"type:jsonb;not null" json:"data"`     // Serialized account data
	Slot         uint64                `gorm:"not null" json:"slot"`                // Solana slot when fetched
	Signature    *string               `gorm:"size:128" json:"signature,omitempty"` // Last tx signature
	LastSyncedAt time.Time             `gorm:"default:now()" json:"last_synced_at"`
	CreatedAt    time.Time             `json:"created_at"`
	UpdatedAt    time.Time             `json:"updated_at"`

	// Denormalized fields for quick queries
	BuyerAddress  *string `gorm:"size:64;index:idx_cache_buyer" json:"buyer_address,omitempty"`
	SellerAddress *string `gorm:"size:64;index:idx_cache_seller" json:"seller_address,omitempty"`
	Status        *string `gorm:"size:50;index:idx_cache_status" json:"status,omitempty"`
}

func (BlockchainStateCache) TableName() string {
	return "blockchain_state_cache"
}

func (c *BlockchainStateCache) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	return nil
}

// EncryptedCredentials stores encrypted session credentials
type EncryptedCredentials struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	SessionID   uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_creds_session" json:"session_id"`
	UsernameEnc string    `gorm:"type:text;not null" json:"-"` // AES-256-GCM encrypted
	PasswordEnc string    `gorm:"type:text;not null" json:"-"` // AES-256-GCM encrypted
	EncryptedAt time.Time `gorm:"default:now()" json:"encrypted_at"`

	// Relations
	Session *Session `gorm:"foreignKey:SessionID" json:"session,omitempty"`
}

func (EncryptedCredentials) TableName() string {
	return "encrypted_credentials"
}

func (c *EncryptedCredentials) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	return nil
}
