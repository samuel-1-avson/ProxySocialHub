package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

const MarketplaceFunnelSchemaV1 = "marketplace.funnel.v1"

// Marketplace funnel event names (schema marketplace.funnel.v1).
const (
	FunnelListingView          = "listing_view"
	FunnelListingSave          = "listing_save"
	FunnelBuyModalOpen         = "buy_modal_open"
	FunnelOrderCreated         = "order_created"
	FunnelEscrowInitiated      = "escrow_initiated"
	FunnelEscrowConfirmed      = "escrow_confirmed"
	FunnelCredentialsDelivered = "credentials_delivered"
)

// MarketplaceFunnelEvent is an append-only marketplace conversion event.
type MarketplaceFunnelEvent struct {
	ID            uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	SchemaVersion string         `gorm:"column:schema_version;not null;default:marketplace.funnel.v1" json:"schema_version"`
	EventName     string         `gorm:"column:event_name;not null;index" json:"event_name"`
	UserID        *uuid.UUID     `gorm:"type:uuid;index" json:"user_id,omitempty"`
	ListingID     *uuid.UUID     `gorm:"type:uuid;index" json:"listing_id,omitempty"`
	OrderID       *uuid.UUID     `gorm:"type:uuid;index" json:"order_id,omitempty"`
	Surface       string         `gorm:"column:surface" json:"surface,omitempty"`
	Meta          datatypes.JSON `gorm:"type:jsonb;default:'{}'" json:"meta"`
	CreatedAt     time.Time      `gorm:"index" json:"created_at"`
}

func (MarketplaceFunnelEvent) TableName() string {
	return "marketplace_funnel_events"
}
