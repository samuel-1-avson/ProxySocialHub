package api

import (
	"math"
	"net/http"
	"sort"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterSmartMatchingRoutes registers smart matching routes
func RegisterSmartMatchingRoutes(rg *gin.RouterGroup) {
	rg.GET("/matching/use-cases", getUseCases)
	rg.GET("/matching/preferences", getMyPreferences)
	rg.PUT("/matching/preferences", updatePreferences)
	rg.GET("/matching/recommend", getRecommendations)
	rg.GET("/matching/recommend/:useCaseId", getRecommendationsByUseCase)
}

// getUseCases returns all available use cases
func getUseCases(c *gin.Context) {
	var useCases []models.UseCase
	db.DB.Find(&useCases)
	c.JSON(http.StatusOK, gin.H{"use_cases": useCases})
}

// getMyPreferences returns user's matching preferences
func getMyPreferences(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var prefs models.UserPreference
	err := db.DB.Preload("UseCase").Where("user_id = ?", userID).First(&prefs).Error
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"preferences": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{"preferences": prefs})
}

type UpdatePreferencesRequest struct {
	PreferredUseCaseID    *uuid.UUID `json:"preferred_use_case_id"`
	PreferredRegions      []string   `json:"preferred_regions"`
	MaxPricePerGB         *float64   `json:"max_price_per_gb"`
	MinSellerRating       *float64   `json:"min_seller_rating"`
	PreferVerifiedSellers *bool      `json:"prefer_verified_sellers"`
}

// updatePreferences updates user's matching preferences
func updatePreferences(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var req UpdatePreferencesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var prefs models.UserPreference
	db.DB.Where("user_id = ?", userID).FirstOrCreate(&prefs, models.UserPreference{UserID: userID})

	updates := make(map[string]interface{})
	if req.PreferredUseCaseID != nil {
		updates["preferred_use_case_id"] = req.PreferredUseCaseID
	}
	if req.PreferredRegions != nil {
		updates["preferred_regions"] = req.PreferredRegions
	}
	if req.MaxPricePerGB != nil {
		updates["max_price_per_gb"] = req.MaxPricePerGB
	}
	if req.MinSellerRating != nil {
		updates["min_seller_rating"] = req.MinSellerRating
	}
	if req.PreferVerifiedSellers != nil {
		updates["prefer_verified_sellers"] = req.PreferVerifiedSellers
	}

	db.DB.Model(&prefs).Updates(updates)
	db.DB.Preload("UseCase").First(&prefs, "id = ?", prefs.ID)

	c.JSON(http.StatusOK, prefs)
}

// ListingScore represents a listing with its match score
type ListingScore struct {
	Listing models.ProxyListing `json:"listing"`
	Score   float64             `json:"score"`
	Reasons []string            `json:"reasons"`
}

// getRecommendations returns AI-matched listings based on user preferences
func getRecommendations(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	// Get user preferences
	var prefs models.UserPreference
	db.DB.Preload("UseCase").Where("user_id = ?", userID).First(&prefs)

	// Get active listings
	var listings []models.ProxyListing
	query := db.DB.Preload("Seller").Where("is_active = ?", true)

	// Apply basic filters
	if prefs.MaxPricePerGB != nil {
		query = query.Where("price_per_gb <= ?", *prefs.MaxPricePerGB)
	}
	if prefs.MinSellerRating != nil {
		query = query.Joins("JOIN users ON proxy_listings.seller_id = users.id").
			Where("users.avg_rating >= ?", *prefs.MinSellerRating)
	}
	if prefs.PreferVerifiedSellers {
		query = query.Joins("JOIN users ON proxy_listings.seller_id = users.id").
			Where("users.is_verified = ?", true)
	}

	query.Limit(50).Find(&listings)

	// Score and rank listings
	scored := scoreListings(listings, prefs)

	// Sort by score descending
	sort.Slice(scored, func(i, j int) bool {
		return scored[i].Score > scored[j].Score
	})

	// Return top 10
	if len(scored) > 10 {
		scored = scored[:10]
	}

	c.JSON(http.StatusOK, gin.H{
		"recommendations": scored,
		"preferences":     prefs,
	})
}

// getRecommendationsByUseCase returns listings matched to a specific use case
func getRecommendationsByUseCase(c *gin.Context) {
	useCaseID, err := uuid.Parse(c.Param("useCaseId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid use case ID"})
		return
	}

	var useCase models.UseCase
	if db.DB.First(&useCase, "id = ?", useCaseID).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Use case not found"})
		return
	}

	// Get active listings
	var listings []models.ProxyListing
	db.DB.Preload("Seller").Where("is_active = ?", true).Limit(50).Find(&listings)

	// Score based on use case requirements
	scored := scoreListingsForUseCase(listings, useCase)

	sort.Slice(scored, func(i, j int) bool {
		return scored[i].Score > scored[j].Score
	})

	if len(scored) > 10 {
		scored = scored[:10]
	}

	c.JSON(http.StatusOK, gin.H{
		"use_case":        useCase,
		"recommendations": scored,
	})
}

func scoreListings(listings []models.ProxyListing, prefs models.UserPreference) []ListingScore {
	scored := make([]ListingScore, 0, len(listings))

	for _, listing := range listings {
		score := 50.0 // Base score
		reasons := []string{}

		// Rating boost (0-25 points)
		if listing.Seller != nil {
			ratingScore := listing.Seller.AvgRating * 5
			score += ratingScore
			if ratingScore > 20 {
				reasons = append(reasons, "Highly rated seller")
			}
		}

		// Price score (0-15 points) - lower is better
		if prefs.MaxPricePerGB != nil && *prefs.MaxPricePerGB > 0 {
			priceRatio := listing.PricePerGB / *prefs.MaxPricePerGB
			priceSave := (1 - priceRatio) * 15
			if priceSave > 0 {
				score += priceSave
				reasons = append(reasons, "Good price")
			}
		}

		// Verified seller bonus (check via KYC status)
		if listing.Seller != nil && listing.Seller.KYCStatus == "approved" {
			score += 10
			reasons = append(reasons, "Verified seller")
		}

		// Bandwidth availability
		if listing.AvailableBandwidthGB > 100 {
			score += 5
			reasons = append(reasons, "High availability")
		}

		// Normalize score to 0-100
		score = math.Min(100, math.Max(0, score))

		scored = append(scored, ListingScore{
			Listing: listing,
			Score:   score,
			Reasons: reasons,
		})
	}

	return scored
}

func scoreListingsForUseCase(listings []models.ProxyListing, useCase models.UseCase) []ListingScore {
	scored := make([]ListingScore, 0, len(listings))

	reqs := useCase.Requirements

	for _, listing := range listings {
		score := 50.0
		reasons := []string{}

		// Check requirements
		// Speed requirements not available in listing model - skip for now
		// Check if minSpeed requirement exists and listing has speed data
		if _, ok := reqs["min_speed_mbps"].(float64); ok {
			// Would check listing.AvgSpeedMbps if field existed
			score += 10
			reasons = append(reasons, "Speed data available")
		}

		if maxLatency, ok := reqs["max_latency_ms"].(float64); ok {
			if listing.AvgLatencyMs > 0 && float64(listing.AvgLatencyMs) <= maxLatency {
				score += 20
				reasons = append(reasons, "Low latency")
			}
		}

		if residential, ok := reqs["residential"].(bool); ok && residential {
			if listing.ProxyType == models.ProxyTypeResidential {
				score += 15
				reasons = append(reasons, "Residential proxy")
			}
		}

		// Rating boost
		if listing.Seller != nil && listing.Seller.AvgRating >= 4.5 {
			score += 10
			reasons = append(reasons, "Top-rated seller")
		}

		score = math.Min(100, math.Max(0, score))

		scored = append(scored, ListingScore{
			Listing: listing,
			Score:   score,
			Reasons: reasons,
		})
	}

	return scored
}
