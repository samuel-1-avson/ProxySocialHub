package models

import (
	"encoding/json"

	"github.com/google/uuid"
)

// CreateCatalogProductRequest creates a merchandising product (offers linked separately).
type CreateCatalogProductRequest struct {
	Title       string               `json:"title" binding:"required,max=200"`
	Description string               `json:"description"`
	Slug        string               `json:"slug" binding:"omitempty,max=120"`
	Media       json.RawMessage      `json:"media"`
	Status      CatalogProductStatus `json:"status" binding:"omitempty,oneof=draft active archived"`
}

// UpdateCatalogProductRequest updates product fields (partial).
type UpdateCatalogProductRequest struct {
	Title       *string               `json:"title" binding:"omitempty,max=200"`
	Description *string               `json:"description"`
	Slug        *string               `json:"slug" binding:"omitempty,max=120"`
	Media       json.RawMessage       `json:"media"`
	Status      *CatalogProductStatus `json:"status" binding:"omitempty,oneof=draft active archived"`
}

// LinkCatalogOfferRequest attaches a listing to a product.
type LinkCatalogOfferRequest struct {
	ListingID   uuid.UUID `json:"listing_id" binding:"required"`
	SKU         string    `json:"sku" binding:"omitempty,max=64"`
	DisplayName string    `json:"display_name" binding:"omitempty,max=200"`
	IsPrimary   *bool     `json:"is_primary"`
	SortOrder   *int      `json:"sort_order"`
}

// CatalogProductView is the public API shape for a product with offers.
type CatalogProductView struct {
	Product CatalogProduct      `json:"product"`
	Offers  []CatalogOfferView  `json:"offers"`
}

// CatalogOfferView includes optional listing summary for manage UI.
type CatalogOfferView struct {
	CatalogOffer
	Listing *ProxyListing `json:"listing,omitempty"`
}
