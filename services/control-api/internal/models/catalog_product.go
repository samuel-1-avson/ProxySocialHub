package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// CatalogProductStatus is merchandising lifecycle (distinct from listing moderation).
type CatalogProductStatus string

const (
	CatalogProductStatusDraft    CatalogProductStatus = "draft"
	CatalogProductStatusActive   CatalogProductStatus = "active"
	CatalogProductStatusArchived CatalogProductStatus = "archived"
)

// CatalogProduct is seller merchandising metadata (Phase 3A projection).
type CatalogProduct struct {
	ID          uuid.UUID              `gorm:"type:uuid;primary_key" json:"id"`
	SellerID    uuid.UUID              `gorm:"type:uuid;not null;index:idx_catalog_products_seller" json:"seller_id"`
	Slug        string                 `gorm:"size:120;not null" json:"slug"`
	Title       string                 `gorm:"size:200;not null" json:"title"`
	Description string                 `json:"description"`
	Media       datatypes.JSON         `gorm:"type:jsonb;default:'[]'" json:"media"`
	Status      CatalogProductStatus   `gorm:"size:32;not null;default:'active';index:idx_catalog_products_status" json:"status"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
	Offers      []CatalogOffer         `gorm:"foreignKey:ProductID" json:"offers,omitempty"`
	Seller      *User                  `gorm:"foreignKey:SellerID" json:"seller,omitempty"`
}

func (CatalogProduct) TableName() string {
	return "catalog_products"
}

func (p *CatalogProduct) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}
