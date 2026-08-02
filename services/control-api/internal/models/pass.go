package models

import (
	"time"

	"github.com/google/uuid"
)

// Pass purchase / migration status for Access Pass primary sales.
type PassPurchaseStatus string

const (
	PassPurchasePending   PassPurchaseStatus = "pending"
	PassPurchaseConfirmed PassPurchaseStatus = "confirmed"
	PassPurchaseFulfilled PassPurchaseStatus = "fulfilled"
	PassPurchaseFailed    PassPurchaseStatus = "failed"
)

// PassPurchase records a primary-sale SOL payment toward an Access Pass NFT.
// Entitlement may briefly use a confirmed receipt until on-chain ATA ownership is detected.
type PassPurchase struct {
	ID               uuid.UUID          `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID           uuid.UUID          `gorm:"type:uuid;not null;index" json:"user_id"`
	Tier             string             `gorm:"type:varchar(20);not null" json:"tier"`
	Mint             string             `gorm:"type:varchar(64)" json:"mint"`
	BuyerWallet      string             `gorm:"type:varchar(64);not null" json:"buyer_wallet"`
	TreasuryWallet   string             `gorm:"type:varchar(64);not null" json:"treasury_wallet"`
	AmountSOL        float64            `gorm:"type:numeric(20,9);not null" json:"amount_sol"`
	TxSignature      string             `gorm:"type:varchar(128)" json:"tx_signature,omitempty"`
	Status           PassPurchaseStatus `gorm:"type:varchar(20);not null;default:'pending'" json:"status"`
	IdempotencyKey   string             `gorm:"type:varchar(64)" json:"idempotency_key,omitempty"`
	CreatedAt        time.Time          `json:"created_at"`
	UpdatedAt        time.Time          `json:"updated_at"`
}

func (PassPurchase) TableName() string { return "pass_purchases" }

// PassAirdropClaim tracks one-time Silver/Gold migration airdrops for legacy subscribers.
type PassAirdropStatus string

const (
	PassAirdropEligible  PassAirdropStatus = "eligible"
	PassAirdropQueued    PassAirdropStatus = "queued"
	PassAirdropCompleted PassAirdropStatus = "completed"
	PassAirdropSkipped   PassAirdropStatus = "skipped"
)

type PassAirdropClaim struct {
	ID             uuid.UUID         `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID         uuid.UUID         `gorm:"type:uuid;not null;uniqueIndex:idx_pass_airdrop_user_tier" json:"user_id"`
	Tier           string            `gorm:"type:varchar(20);not null;uniqueIndex:idx_pass_airdrop_user_tier" json:"tier"`
	WalletAddress  string            `gorm:"type:varchar(64)" json:"wallet_address"`
	SourcePlanName string            `gorm:"type:varchar(100)" json:"source_plan_name"`
	Status         PassAirdropStatus `gorm:"type:varchar(20);not null;default:'eligible'" json:"status"`
	TxSignature    string            `gorm:"type:varchar(128)" json:"tx_signature,omitempty"`
	Notes          string            `gorm:"type:text" json:"notes,omitempty"`
	CreatedAt      time.Time         `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`
}

func (PassAirdropClaim) TableName() string { return "pass_airdrop_claims" }
