package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ListingAppealStatus is the lifecycle of a moderation appeal (Wave 3.5 / ADR 0008).
type ListingAppealStatus string

const (
	ListingAppealOpen     ListingAppealStatus = "open"
	ListingAppealUpheld   ListingAppealStatus = "upheld"   // listing restored to active
	ListingAppealDenied   ListingAppealStatus = "denied"   // listing → deleted
	ListingAppealExpired  ListingAppealStatus = "expired"
	ListingAppealWithdrawn ListingAppealStatus = "withdrawn"
)

// ListingModerationAppeal is a seller appeal of a delisted listing.
type ListingModerationAppeal struct {
	ID               uuid.UUID           `gorm:"type:uuid;primary_key" json:"id"`
	ListingID        uuid.UUID           `gorm:"type:uuid;not null;index:idx_listing_appeals_listing" json:"listing_id"`
	SellerID         uuid.UUID           `gorm:"type:uuid;not null;index:idx_listing_appeals_seller" json:"seller_id"`
	Status           ListingAppealStatus `gorm:"type:varchar(32);not null;default:'open';index:idx_listing_appeals_status" json:"status"`
	Reason           string              `gorm:"type:text;not null" json:"reason"`
	Evidence         string              `gorm:"type:text" json:"evidence"`
	ListingOfferHash string              `gorm:"type:varchar(64)" json:"listing_offer_hash,omitempty"`
	DelistReason     string              `gorm:"type:text" json:"delist_reason,omitempty"`
	Resolution       string              `gorm:"type:varchar(32)" json:"resolution,omitempty"`
	ResolutionNotes  string              `gorm:"type:text" json:"resolution_notes,omitempty"`
	ResolvedBy       *uuid.UUID          `gorm:"type:uuid" json:"resolved_by,omitempty"`
	ResolvedAt       *time.Time          `json:"resolved_at,omitempty"`
	AppealDeadlineAt time.Time           `gorm:"not null" json:"appeal_deadline_at"`
	CreatedAt        time.Time           `json:"created_at"`
	UpdatedAt        time.Time           `json:"updated_at"`
}

func (ListingModerationAppeal) TableName() string {
	return "listing_moderation_appeals"
}

func (a *ListingModerationAppeal) BeforeCreate(tx *gorm.DB) error {
	if a.ID == uuid.Nil {
		a.ID = uuid.New()
	}
	return nil
}
