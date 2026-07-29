package catalog

import (
	"fmt"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// backfillProductsSQL mirrors migrations/000097_catalog_products_offers.up.sql.
// Product id = listing id for the 1:1 migration path; ON CONFLICT keeps re-runs safe.
const backfillProductsSQL = `
INSERT INTO catalog_products (
    id,
    seller_id,
    slug,
    title,
    description,
    media,
    status,
    created_at,
    updated_at
)
SELECT
    pl.id,
    pl.seller_id,
    trim(both '-' from regexp_replace(
        coalesce(nullif(regexp_replace(lower(substring(pl.title from 1 for 80)), '[^a-z0-9]+', '-', 'g'), ''), 'listing'),
        '-{2,}', '-', 'g'
    )) || '-' || left(replace(pl.id::text, '-', ''), 8),
    pl.title,
    coalesce(pl.description, ''),
    '[]'::jsonb,
    CASE pl.status
        WHEN 'pending_review' THEN 'draft'
        ELSE 'active'
    END,
    pl.created_at,
    pl.updated_at
FROM proxy_listings pl
WHERE pl.status <> 'deleted'
ON CONFLICT (id) DO NOTHING
`

// backfillOffersSQL creates one primary offer per non-deleted listing.
const backfillOffersSQL = `
INSERT INTO catalog_offers (
    product_id,
    listing_id,
    is_primary,
    sort_order,
    created_at
)
SELECT
    pl.id,
    pl.id,
    TRUE,
    0,
    pl.created_at
FROM proxy_listings pl
WHERE pl.status <> 'deleted'
  AND EXISTS (SELECT 1 FROM catalog_products cp WHERE cp.id = pl.id)
ON CONFLICT (listing_id) DO NOTHING
`

// Promote projected draft products when the source listing left pending_review.
// Does not overwrite seller-edited active/archived products.
const repairProductStatusSQL = `
UPDATE catalog_products cp
SET status = 'active',
    updated_at = NOW()
FROM proxy_listings pl
WHERE cp.id = pl.id
  AND pl.status <> 'deleted'
  AND pl.status <> 'pending_review'
  AND cp.status = 'draft'
`

// Promote one existing non-primary offer when a product has no primary.
const repairMissingPrimarySQL = `
UPDATE catalog_offers o
SET is_primary = TRUE
FROM (
    SELECT DISTINCT ON (product_id) id
    FROM catalog_offers
    WHERE is_primary = FALSE
    ORDER BY product_id, sort_order ASC, created_at ASC
) pick
WHERE o.id = pick.id
  AND NOT EXISTS (
      SELECT 1 FROM catalog_offers o2
      WHERE o2.product_id = o.product_id AND o2.is_primary = TRUE
  )
`

// BackfillResult summarizes an idempotent catalog projection backfill.
type BackfillResult struct {
	EligibleListings  int64
	Products          int64
	Offers            int64
	MissingPrimary    int64
	OrphanOffers      int64
	DuplicatePrimaries int64
}

// BackfillFromListings projects non-deleted proxy_listings into catalog_products +
// primary catalog_offers. Safe to re-run; also repairs draft→active status drift and
// missing primary flags when an offer row already exists.
func BackfillFromListings() (*BackfillResult, error) {
	if db.DB == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	return BackfillFromListingsTx(db.DB)
}

// BackfillFromListingsTx is the transactional form used by tests and operators.
func BackfillFromListingsTx(tx *gorm.DB) (*BackfillResult, error) {
	if tx == nil {
		tx = db.DB
	}
	if tx == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	if err := tx.Exec(backfillProductsSQL).Error; err != nil {
		return nil, fmt.Errorf("backfill catalog_products: %w", err)
	}
	if err := tx.Exec(backfillOffersSQL).Error; err != nil {
		return nil, fmt.Errorf("backfill catalog_offers: %w", err)
	}
	if err := tx.Exec(repairProductStatusSQL).Error; err != nil {
		return nil, fmt.Errorf("repair catalog product status: %w", err)
	}
	if err := tx.Exec(repairMissingPrimarySQL).Error; err != nil {
		return nil, fmt.Errorf("repair missing primary offers: %w", err)
	}
	return VerifyBackfill(tx)
}

// VerifyBackfill checks listing ↔ catalog parity and integrity constraints.
func VerifyBackfill(tx *gorm.DB) (*BackfillResult, error) {
	if tx == nil {
		tx = db.DB
	}
	if tx == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	var eligible, products, offers, missingPrimary, orphans, dupPrimaries int64

	if err := tx.Model(&models.ProxyListing{}).
		Where("status <> ?", models.ListingStatusDeleted).
		Count(&eligible).Error; err != nil {
		return nil, err
	}
	if err := tx.Model(&models.CatalogProduct{}).Count(&products).Error; err != nil {
		return nil, err
	}
	if err := tx.Model(&models.CatalogOffer{}).Count(&offers).Error; err != nil {
		return nil, err
	}

	// Non-deleted listings without a primary offer (expected 0 after backfill).
	if err := tx.Raw(`
		SELECT COUNT(*) FROM proxy_listings pl
		WHERE pl.status <> ?
		  AND NOT EXISTS (
		    SELECT 1 FROM catalog_offers o
		    WHERE o.listing_id = pl.id AND o.is_primary = TRUE
		  )
	`, models.ListingStatusDeleted).Scan(&missingPrimary).Error; err != nil {
		return nil, err
	}

	// Offers whose listing row is gone (FK should prevent; still useful on soft DBs).
	if err := tx.Raw(`
		SELECT COUNT(*) FROM catalog_offers o
		WHERE NOT EXISTS (SELECT 1 FROM proxy_listings pl WHERE pl.id = o.listing_id)
	`).Scan(&orphans).Error; err != nil {
		return nil, err
	}

	if err := tx.Raw(`
		SELECT COUNT(*) FROM (
			SELECT product_id
			FROM catalog_offers
			WHERE is_primary = TRUE
			GROUP BY product_id
			HAVING COUNT(*) > 1
		) d
	`).Scan(&dupPrimaries).Error; err != nil {
		return nil, err
	}

	return &BackfillResult{
		EligibleListings:   eligible,
		Products:           products,
		Offers:             offers,
		MissingPrimary:     missingPrimary,
		OrphanOffers:       orphans,
		DuplicatePrimaries: dupPrimaries,
	}, nil
}
