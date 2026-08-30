package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/cache"
	"github.com/proxyhubb/control-api/internal/catalog"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/marketplace/collections"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/privacy"
)

const listingFacetsCacheKey = "listings:facets:v1"

// FacetBucket is a single facet value with listing count.
type FacetBucket struct {
	Value string `json:"value"`
	Count int64  `json:"count"`
}

// PriceBucket groups listings by USD/GB price band.
type PriceBucket struct {
	Min   float64 `json:"min"`
	Max   float64 `json:"max"`
	Count int64   `json:"count"`
}

// ListingFacetsResponse is returned by GET /v1/listings/facets.
type ListingFacetsResponse struct {
	Countries    []FacetBucket `json:"countries"`
	ProxyTypes   []FacetBucket `json:"proxy_types"`
	ISPs         []FacetBucket `json:"isps"`
	PriceBuckets []PriceBucket `json:"price_buckets"`
}

// ListingCollectionSummary includes metadata and active listing count.
type ListingCollectionSummary struct {
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Count       int64  `json:"count"`
}

// RegisterListingCatalogRoutes registers facets and collections (must be before /listings/:id).
func RegisterListingCatalogRoutes(rg *gin.RouterGroup) {
	rg.GET("/listings/facets", getListingFacets)
	rg.GET("/listings/collections", getListingCollections)
	rg.GET("/listings/collections/:slug", getListingCollectionBySlug)
	rg.GET("/listings/commitments/bundle", exportListingCommitmentBundle)
}

func getListingFacets(c *gin.Context) {
	var cached ListingFacetsResponse
	if hit, _ := cache.Get(listingFacetsCacheKey, &cached); hit {
		c.JSON(http.StatusOK, cached)
		return
	}

	active := models.ListingStatusActive
	var countries []FacetBucket
	if err := db.DB.Model(&models.ProxyListing{}).
		Select("country AS value, COUNT(*) AS count").
		Where("status = ? AND country <> ''", active).
		Group("country").
		Order("count DESC").
		Limit(50).
		Scan(&countries).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load country facets"})
		return
	}

	var proxyTypes []FacetBucket
	if err := db.DB.Model(&models.ProxyListing{}).
		Select("proxy_type AS value, COUNT(*) AS count").
		Where("status = ?", active).
		Group("proxy_type").
		Order("count DESC").
		Scan(&proxyTypes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load proxy type facets"})
		return
	}

	var isps []FacetBucket
	if err := db.DB.Model(&models.ProxyListing{}).
		Select("isp AS value, COUNT(*) AS count").
		Where("status = ? AND isp <> ''", active).
		Group("isp").
		Order("count DESC").
		Limit(50).
		Scan(&isps).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load ISP facets"})
		return
	}

	priceBuckets := []PriceBucket{
		{Min: 0, Max: 1},
		{Min: 1, Max: 2},
		{Min: 2, Max: 5},
		{Min: 5, Max: 10},
		{Min: 10, Max: 1_000_000},
	}
	for i := range priceBuckets {
		bucket := &priceBuckets[i]
		q := db.DB.Model(&models.ProxyListing{}).Where("status = ?", active)
		if bucket.Max >= 1_000_000 {
			q = q.Where("price_per_gb >= ?", bucket.Min)
		} else {
			q = q.Where("price_per_gb >= ? AND price_per_gb < ?", bucket.Min, bucket.Max)
		}
		q.Count(&bucket.Count)
	}

	response := ListingFacetsResponse{
		Countries:    countries,
		ProxyTypes:   proxyTypes,
		ISPs:         isps,
		PriceBuckets: priceBuckets,
	}
	cache.Set(listingFacetsCacheKey, response, 10*time.Minute)
	c.JSON(http.StatusOK, response)
}

func getListingCollections(c *gin.Context) {
	cacheKey := "listings:collections:v1"
	var cached []ListingCollectionSummary
	if hit, _ := cache.Get(cacheKey, &cached); hit {
		c.JSON(http.StatusOK, gin.H{"collections": cached})
		return
	}

	summaries := make([]ListingCollectionSummary, 0, len(collections.Definitions()))
	for _, def := range collections.Definitions() {
		count, err := collections.CountActive(c.Request.Context(), def.Slug)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load collections"})
			return
		}
		summaries = append(summaries, ListingCollectionSummary{
			Slug:        def.Slug,
			Title:       def.Title,
			Description: def.Description,
			Count:       count,
		})
	}

	cache.Set(cacheKey, summaries, 5*time.Minute)
	c.JSON(http.StatusOK, gin.H{"collections": summaries})
}

func getListingCollectionBySlug(c *gin.Context) {
	slug := strings.ToLower(strings.TrimSpace(c.Param("slug")))
	meta, ok := collections.ResolveMeta(slug)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Collection not found"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)

	listings, total, err := collections.Fetch(c.Request.Context(), slug, page, limit)
	if err != nil {
		if err.Error() == "unknown collection" {
			c.JSON(http.StatusNotFound, gin.H{"error": "Collection not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load collection"})
		return
	}

	enrichListingsSLA(listings)
	enrichListingsOccupancy(listings)

	sentry := privacy.NewZKMetadataSentry()
	for i := range listings {
		sentry.SanitizeListing(&listings[i])
	}

	apiListings := make([]models.ProxyListing, len(listings))
	copy(apiListings, listings)
	maybeEnrichListingsWithCatalog(c, apiListings)

	c.JSON(http.StatusOK, gin.H{
		"collection": meta,
		"listings":   apiListings,
		"total":      total,
		"page":       page,
		"limit":      limit,
	})
}

// exportListingCommitmentBundle is Wave 9.B: signed offer-hash set (optional PDAs).
// Registered before /listings/:id. Not a merchandising catalog.
func exportListingCommitmentBundle(c *gin.Context) {
	secret := catalog.SigningKey()
	if secret == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "listing bundle signing key not configured",
			"honesty": gin.H{"catalog_source": catalog.Source(), "not_a_catalog": true},
		})
		return
	}
	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database unavailable"})
		return
	}
	var listings []models.ProxyListing
	q := db.DB.Where("COALESCE(TRIM(listing_offer_hash), '') <> ''").
		Order("updated_at DESC").
		Limit(500)
	if err := q.Find(&listings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load listing commitments"})
		return
	}
	bundle, err := catalog.BuildBundle(listings, secret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, bundle)
}
