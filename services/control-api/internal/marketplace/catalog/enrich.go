package catalog

import (
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/datatypes"
)

type listingProductRow struct {
	ListingID uuid.UUID                  `gorm:"column:listing_id"`
	ID        uuid.UUID                  `gorm:"column:id"`
	Slug      string                     `gorm:"column:slug"`
	Title     string                     `gorm:"column:title"`
	Media     datatypes.JSON             `gorm:"column:media"`
	Status    models.CatalogProductStatus `gorm:"column:status"`
	SellerID  uuid.UUID                  `gorm:"column:seller_id"`
}

// EnrichListingsWithCatalogProducts attaches catalog_product when an offer exists.
// Draft/archived products are omitted unless viewerUserID is the product seller.
func EnrichListingsWithCatalogProducts(listings []models.ProxyListing, viewerUserID *uuid.UUID) error {
	if len(listings) == 0 {
		return nil
	}

	ids := make([]uuid.UUID, len(listings))
	for i := range listings {
		ids[i] = listings[i].ID
	}

	var rows []listingProductRow
	err := db.DB.Table("catalog_offers AS o").
		Select("o.listing_id, p.id, p.slug, p.title, p.media, p.status, p.seller_id").
		Joins("INNER JOIN catalog_products p ON p.id = o.product_id").
		Where("o.listing_id IN ?", ids).
		Scan(&rows).Error
	if err != nil {
		return err
	}

	byListing := make(map[uuid.UUID]listingProductRow, len(rows))
	for _, row := range rows {
		byListing[row.ListingID] = row
	}

	for i := range listings {
		row, ok := byListing[listings[i].ID]
		if !ok {
			continue
		}
		if !productVisibleToViewer(row, viewerUserID) {
			continue
		}
		listings[i].CatalogProduct = &models.CatalogProductSummary{
			ID:     row.ID,
			Slug:   row.Slug,
			Title:  row.Title,
			Media:  row.Media,
			Status: row.Status,
		}
	}
	return nil
}

func productVisibleToViewer(row listingProductRow, viewerUserID *uuid.UUID) bool {
	if row.Status == models.CatalogProductStatusActive {
		return true
	}
	if viewerUserID != nil && *viewerUserID == row.SellerID {
		return true
	}
	return false
}

// SummariesByListingIDs returns visible catalog_product summaries keyed by listing id.
func SummariesByListingIDs(listingIDs []uuid.UUID, viewerUserID *uuid.UUID) (map[uuid.UUID]models.CatalogProductSummary, error) {
	out := make(map[uuid.UUID]models.CatalogProductSummary)
	if len(listingIDs) == 0 || db.DB == nil {
		return out, nil
	}

	var rows []listingProductRow
	err := db.DB.Table("catalog_offers AS o").
		Select("o.listing_id, p.id, p.slug, p.title, p.media, p.status, p.seller_id").
		Joins("INNER JOIN catalog_products p ON p.id = o.product_id").
		Where("o.listing_id IN ?", listingIDs).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		if !productVisibleToViewer(row, viewerUserID) {
			continue
		}
		out[row.ListingID] = models.CatalogProductSummary{
			ID:     row.ID,
			Slug:   row.Slug,
			Title:  row.Title,
			Media:  row.Media,
			Status: row.Status,
		}
	}
	return out, nil
}
