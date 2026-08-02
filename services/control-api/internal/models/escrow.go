package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Escrow Status
type EscrowStatus string

const (
	EscrowHeld      EscrowStatus = "held"
	EscrowReleasing EscrowStatus = "releasing" // claimed for settle; not yet released
	EscrowReleased  EscrowStatus = "released"
	EscrowRefunded  EscrowStatus = "refunded"
	EscrowDisputed  EscrowStatus = "disputed"
)

// EscrowTransaction represents funds held in escrow
type EscrowTransaction struct {
	ID            uuid.UUID    `gorm:"type:uuid;primary_key" json:"id"`
	OrderID       uuid.UUID    `gorm:"type:uuid;not null" json:"order_id"`
	BuyerID       uuid.UUID    `gorm:"type:uuid;not null" json:"buyer_id"`
	SellerID      uuid.UUID    `gorm:"type:uuid;not null" json:"seller_id"`
	Amount        float64      `gorm:"type:numeric(20,4);not null" json:"amount"`
	Status        EscrowStatus `gorm:"type:varchar(50);default:'held'" json:"status"`
	HeldAt        time.Time    `gorm:"default:now()" json:"held_at"`
	ReleasedAt    *time.Time   `json:"released_at,omitempty"`
	AutoReleaseAt *time.Time   `json:"auto_release_at,omitempty"`
	CreatedAt     time.Time    `json:"created_at"`
	UpdatedAt     time.Time    `json:"updated_at"`

	// Relations
	Order      *Order            `gorm:"foreignKey:OrderID" json:"order,omitempty"`
	Buyer      *User             `gorm:"foreignKey:BuyerID" json:"buyer,omitempty"`
	Seller     *User             `gorm:"foreignKey:SellerID" json:"seller,omitempty"`
	Milestones []EscrowMilestone `gorm:"foreignKey:EscrowID" json:"milestones,omitempty"`
}

// EscrowMilestone represents a granular release stage
type EscrowMilestone struct {
	ID                uuid.UUID  `gorm:"type:uuid;primary_key" json:"id"`
	EscrowID          uuid.UUID  `gorm:"type:uuid;not null;index" json:"escrow_id"`
	ByteThreshold     int64      `json:"byte_threshold"` // Release after X bytes
	Amount            float64    `json:"amount"`         // Release amount
	Status            string     `json:"status"`         // pending, released
	ReleasedAt        *time.Time `json:"released_at,omitempty"`
	VerificationProof string     `json:"verification_proof"` // ZK Proof Link/Hash
}

func (EscrowMilestone) TableName() string {
	return "escrow_milestones"
}

func (m *EscrowMilestone) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	return nil
}

func (EscrowTransaction) TableName() string {
	return "escrow_transactions"
}

func (e *EscrowTransaction) BeforeCreate(tx *gorm.DB) error {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	return nil
}

// Dispute Status
type DisputeStatus string

const (
	DisputeOpen           DisputeStatus = "open"
	DisputeUnderReview    DisputeStatus = "under_review"
	DisputeResolvedBuyer  DisputeStatus = "resolved_buyer"
	DisputeResolvedSeller DisputeStatus = "resolved_seller"
)

// Dispute Reasons
type DisputeReason string

const (
	DisputeQuality     DisputeReason = "quality"
	DisputeNonDelivery DisputeReason = "non_delivery"
	DisputeFraud       DisputeReason = "fraud"
	DisputeOther       DisputeReason = "other"
)

// EscrowDispute represents a buyer-seller dispute on an escrow/order.
// For provider session disputes see models.Dispute in dispute.go.
type EscrowDispute struct {
	ID           uuid.UUID     `gorm:"type:uuid;primary_key" json:"id"`
	EscrowID     uuid.UUID     `gorm:"type:uuid;not null" json:"escrow_id"`
	OrderID      uuid.UUID     `gorm:"type:uuid;not null" json:"order_id"`
	InitiatedBy  uuid.UUID     `gorm:"type:uuid;not null" json:"initiated_by"`
	Reason       DisputeReason `gorm:"type:varchar(50);not null" json:"reason"`
	Description  string        `gorm:"type:text" json:"description"`
	EvidenceURLs []string      `gorm:"type:jsonb;serializer:json" json:"evidence_urls"`
	Status       DisputeStatus `gorm:"type:varchar(50);default:'open'" json:"status"`
	Resolution   string        `gorm:"type:text" json:"resolution,omitempty"`
	ResolvedBy   *uuid.UUID    `gorm:"type:uuid" json:"resolved_by,omitempty"`
	ResolvedAt   *time.Time    `json:"resolved_at,omitempty"`
	CreatedAt    time.Time     `json:"created_at"`
	UpdatedAt    time.Time     `json:"updated_at"`

	// Relations
	Escrow    *EscrowTransaction `gorm:"foreignKey:EscrowID" json:"escrow,omitempty"`
	Order     *Order             `gorm:"foreignKey:OrderID" json:"order,omitempty"`
	Initiator *User              `gorm:"foreignKey:InitiatedBy" json:"initiator,omitempty"`
}

func (EscrowDispute) TableName() string {
	return "escrow_disputes"
}

func (d *EscrowDispute) BeforeCreate(tx *gorm.DB) error {
	if d.ID == uuid.Nil {
		d.ID = uuid.New()
	}
	return nil
}

// Request/Response types

type ReleaseEscrowRequest struct {
	OrderID uuid.UUID `json:"order_id" binding:"required"`
}

type CreateDisputeRequest struct {
	OrderID     uuid.UUID     `json:"order_id" binding:"required"`
	Reason      DisputeReason `json:"reason" binding:"required"`
	Description string        `json:"description" binding:"required"`
}

type ResolveDisputeRequest struct {
	Resolution string `json:"resolution" binding:"required"`
	InFavorOf  string `json:"in_favor_of" binding:"required"` // "buyer" or "seller"
}
