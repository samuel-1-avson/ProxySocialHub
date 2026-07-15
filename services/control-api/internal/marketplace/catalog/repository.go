package catalog

import (
	"errors"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// OfferByListingID returns the offer (and preloaded product) for a listing, if any.
func OfferByListingID(listingID uuid.UUID) (*models.CatalogOffer, error) {
	var offer models.CatalogOffer
	err := db.DB.
		Preload("Product").
		Where("listing_id = ?", listingID).
		First(&offer).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrOfferNotFound // package-level from errors.go
	}
	if err != nil {
		return nil, err
	}
	return &offer, nil
}

// ProductByID loads a catalog product owned by sellerID when sellerID is non-nil; otherwise any seller.
func ProductByID(productID uuid.UUID, sellerID *uuid.UUID) (*models.CatalogProduct, error) {
	q := db.DB.Where("id = ?", productID)
	if sellerID != nil {
		q = q.Where("seller_id = ?", *sellerID)
	}
	var product models.CatalogProduct
	if err := q.First(&product).Error; err != nil {
		return nil, err
	}
	return &product, nil
}

// Counts returns row counts for backfill verification.
func Counts() (products int64, offers int64, err error) {
	if err = db.DB.Model(&models.CatalogProduct{}).Count(&products).Error; err != nil {
		return 0, 0, err
	}
	if err = db.DB.Model(&models.CatalogOffer{}).Count(&offers).Error; err != nil {
		return 0, 0, err
	}
	return products, offers, nil
}

// ListingsEligibleForBackfill counts non-deleted listings (expected offer count after migration).
func ListingsEligibleForBackfill() (int64, error) {
	var n int64
	err := db.DB.Model(&models.ProxyListing{}).
		Where("status <> ?", models.ListingStatusDeleted).
		Count(&n).Error
	return n, err
}
