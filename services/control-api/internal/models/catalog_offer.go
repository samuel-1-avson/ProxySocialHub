package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CatalogOffer links a catalog product to a fulfillment listing.
type CatalogOffer struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key;default:gen_random_uuid()" json:"id"`
	ProductID   uuid.UUID `gorm:"type:uuid;not null;index:idx_catalog_offers_product" json:"product_id"`
	ListingID   uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:uq_catalog_offers_listing" json:"listing_id"`
	SKU         string    `gorm:"size:64" json:"sku,omitempty"`
	DisplayName string    `gorm:"size:200" json:"display_name,omitempty"`
	IsPrimary   bool      `gorm:"not null;default:false" json:"is_primary"`
	SortOrder   int       `gorm:"not null;default:0" json:"sort_order"`
	CreatedAt   time.Time `json:"created_at"`

	Product *CatalogProduct `gorm:"foreignKey:ProductID" json:"product,omitempty"`
	Listing *ProxyListing   `gorm:"foreignKey:ListingID" json:"listing,omitempty"`
}

func (CatalogOffer) TableName() string {
	return "catalog_offers"
}

func (o *CatalogOffer) BeforeCreate(tx *gorm.DB) error {
	if o.ID == uuid.Nil {
		o.ID = uuid.New()
	}
	return nil
}
