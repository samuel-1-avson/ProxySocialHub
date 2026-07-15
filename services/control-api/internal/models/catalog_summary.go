package models

import (
	"github.com/google/uuid"
	"gorm.io/datatypes"
)

// CatalogProductSummary is embedded on listings when ?include=product is set.
type CatalogProductSummary struct {
	ID     uuid.UUID            `json:"id"`
	Slug   string               `json:"slug"`
	Title  string               `json:"title"`
	Media  datatypes.JSON       `json:"media,omitempty"`
	Status CatalogProductStatus `json:"status,omitempty"`
}
