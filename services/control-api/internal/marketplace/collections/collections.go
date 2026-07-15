package collections

import (
	"context"
	"fmt"
	"strings"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/marketplace/discovery"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// Meta describes a curated listing collection for browse merchandising.
type Meta struct {
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

var definitions = []Meta{
	{
		Slug:        "featured",
		Title:       "Featured",
		Description: "High-quality nodes prioritized for the grid.",
	},
	{
		Slug:        "verified",
		Title:       "Verified offers",
		Description: "Listings with a verified provider-signed offer.",
	},
	{
		Slug:        "editors-pick",
		Title:       "Editor's pick",
		Description: "Top performers with proven order volume or priority placement.",
	},
}

// Definitions returns configured collection metadata.
func Definitions() []Meta {
	out := make([]Meta, len(definitions))
	copy(out, definitions)
	return out
}

// ResolveMeta returns collection metadata for a slug.
func ResolveMeta(slug string) (Meta, bool) {
	slug = strings.ToLower(strings.TrimSpace(slug))
	for _, def := range definitions {
		if def.Slug == slug {
			return def, true
		}
	}
	return Meta{}, false
}

// CountActive returns how many active listings match a collection slug.
func CountActive(ctx context.Context, slug string) (int64, error) {
	query, err := applyCollectionScope(slug)
	if err != nil {
		return 0, err
	}
	var total int64
	if err := query.WithContext(ctx).Count(&total).Error; err != nil {
		return 0, err
	}
	return total, nil
}

// Fetch returns a paginated slice of listings for a collection slug.
func Fetch(ctx context.Context, slug string, page, limit int) ([]models.ProxyListing, int64, error) {
	if page < 1 {
		page = 1
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	query, err := applyCollectionScope(slug)
	if err != nil {
		return nil, 0, err
	}

	var total int64
	if err := query.WithContext(ctx).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	query = applyCollectionOrder(slug, query)
	var listings []models.ProxyListing
	if err := query.WithContext(ctx).
		Preload("Seller").
		Offset((page - 1) * limit).
		Limit(limit).
		Find(&listings).Error; err != nil {
		return nil, 0, err
	}

	return listings, total, nil
}

func applyCollectionScope(slug string) (*gorm.DB, error) {
	slug = strings.ToLower(strings.TrimSpace(slug))
	switch slug {
	case "featured":
		return db.DB.Model(&models.ProxyListing{}).
			Where("status = ? AND quality_score > ?", models.ListingStatusActive, 70), nil
	case "verified":
		return discovery.Apply(discovery.BaseQuery(db.DB), discovery.Query{}).
			Where("proxy_listings.listing_offer_verified = ?", true), nil
	case "editors-pick":
		return discovery.BaseQuery(db.DB).
			Where("proxy_listings.quality_score >= ?", 85).
			Where("proxy_listings.orders_count > 0"), nil
	default:
		return nil, fmt.Errorf("unknown collection")
	}
}

func applyCollectionOrder(slug string, query *gorm.DB) *gorm.DB {
	switch slug {
	case "featured":
		return query.Order("proxy_listings.quality_score DESC, proxy_listings.orders_count DESC, proxy_listings.created_at DESC")
	case "verified":
		return query.Order("proxy_listings.quality_score DESC, proxy_listings.created_at DESC")
	case "editors-pick":
		return query.Order("proxy_listings.orders_count DESC, proxy_listings.quality_score DESC")
	default:
		return query.Order("proxy_listings.created_at DESC")
	}
}
