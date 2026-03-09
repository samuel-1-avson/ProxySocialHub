package api

import (
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

var (
	smartMatchRepo     *db.SmartMatchRepository
	smartMatchRepoOnce sync.Once
)

// initSmartMatchRepo lazily initializes the smart-match repository.
func initSmartMatchRepo() *db.SmartMatchRepository {
	smartMatchRepoOnce.Do(func() {
		smartMatchRepo = db.NewSmartMatchRepository()
	})
	return smartMatchRepo
}

// SmartMatchRequest is the POST body for /v1/smart-match.
type SmartMatchRequest struct {
	UseCase          string  `json:"use_case"`
	PreferredGeo     string  `json:"preferred_geo"`
	PreferredISP     string  `json:"preferred_isp"`
	MaxPricePerGB    float64 `json:"max_price_per_gb"`
	MinUptimePercent float64 `json:"min_uptime_percent"`
	MaxLatencyMs     int     `json:"max_latency_ms"`
	SessionType      string  `json:"session_type"` // rotating|sticky
	RequiredTier     string  `json:"required_tier"`
	BandwidthGB      float64 `json:"bandwidth_gb"`
}

// SmartMatchResultItem is a single recommended provider in the response.
type SmartMatchResultItem struct {
	ListingID    uuid.UUID `json:"listing_id"`
	SellerID     uuid.UUID `json:"seller_id"`
	Title        string    `json:"title"`
	PricePerGB   float64   `json:"price_per_gb"`
	MatchScore   float64   `json:"match_score"`
	ProviderTier string    `json:"provider_tier"`
	UptimePct    float64   `json:"uptime_percent"`
	AvgLatencyMs int       `json:"avg_latency_ms"`
	Country      string    `json:"country"`
	ISP          string    `json:"isp"`
	SessionType  string    `json:"session_type"`
}

// SmartMatch is the POST /v1/smart-match handler.
// It scores active proxy listings against the caller's requirements,
// persists the match request, and returns ranked recommendations.
func SmartMatch(c *gin.Context) {
	var req SmartMatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	repo := initSmartMatchRepo()

	// Build the repository query
	findReq := db.FindProvidersRequest{
		GeoCountry:       req.PreferredGeo,
		MaxPricePerGB:    req.MaxPricePerGB,
		MinUptimePercent: req.MinUptimePercent,
		MaxLatencyMs:     req.MaxLatencyMs,
		RequiredTier:     req.RequiredTier,
		SessionType:      req.SessionType,
		Limit:            10,
	}

	results, err := repo.FindBestProviders(c.Request.Context(), findReq)
	if err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to find providers: " + err.Error()})
		return
	}

	// Build response items
	items := make([]SmartMatchResultItem, 0, len(results))
	for _, r := range results {
		items = append(items, SmartMatchResultItem{
			ListingID:    r.ID,
			SellerID:     r.SellerID,
			Title:        r.Title,
			PricePerGB:   r.PricePerGB,
			MatchScore:   r.MatchScore,
			ProviderTier: r.ProviderTier,
			UptimePct:    r.UptimePercent,
			AvgLatencyMs: r.AvgLatencyMs,
			Country:      r.Country,
			ISP:          r.ISP,
			SessionType:  r.RotationType,
		})
	}

	// Persist the MatchRequest record
	matchRecord := models.MatchRequest{
		UseCase:          req.UseCase,
		PreferredGeo:     req.PreferredGeo,
		PreferredISP:     req.PreferredISP,
		MaxPricePerGB:    req.MaxPricePerGB,
		MinUptimePercent: req.MinUptimePercent,
		MaxLatencyMs:     req.MaxLatencyMs,
		SessionType:      req.SessionType,
		RequiredTier:     req.RequiredTier,
		BandwidthGB:      req.BandwidthGB,
	}

	// Set authenticated user ID if present
	if userIDVal, exists := c.Get("user_id"); exists {
		if uid, ok := userIDVal.(uuid.UUID); ok {
			matchRecord.UserID = uid
		}
	}

	// Record best match details
	if len(results) > 0 {
		best := results[0]
		matchRecord.MatchedListingID = &best.ID
		matchRecord.MatchScore = best.MatchScore
	}

	// Fire-and-forget persist (non-blocking, best-effort)
	if db.DB != nil {
		if err := db.DB.Create(&matchRecord).Error; err != nil {
			// Log but don't fail the request
			_ = err
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"match_request_id": matchRecord.ID,
		"recommended":      items,
		"count":            len(items),
		"explanation":      "Matched providers scored on: latency (30%), uptime (25%), price (20%), tier (15%), experience (10%)",
	})
}
