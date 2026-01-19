package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/matching"
	"github.com/proxyhubb/control-api/internal/models"
)

var matchEngine *matching.Matcher

func init() {
	matchEngine = matching.NewMatcher()
}

// RegisterSmartMatchingRoutes registers routes for the AI matching engine
func RegisterSmartMatchingRoutes(r *gin.RouterGroup) {
	group := r.Group("/matching")
	{
		group.GET("/use-cases", getUseCases)
		group.GET("/recommend", getRecommendations)
		group.POST("/recommend", getRecommendations)
		group.GET("/recommend/:useCaseId", getRecommendationsByUseCase)
		group.GET("/preferences", getMyPreferences)
		group.PUT("/preferences", updatePreferences)
	}
}

// getUseCases returns the list of supported use cases from DB, falling back to engine profiles if empty
func getUseCases(c *gin.Context) {
	var useCases []models.UseCase
	if err := db.DB.Order("name asc").Find(&useCases).Error; err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to fetch use cases"})
		return
	}

	// If DB is empty (first run or test), seed with engine defaults
	if len(useCases) == 0 {
		profiles := matchEngine.GetProfiles()
		for _, profile := range profiles {
			uc := models.UseCase{
				ID:          uuid.New(), // In reality we might want fixed IDs or slugs
				Name:        profile.Name,
				Description: profile.Description,
			}
			db.DB.Create(&uc)
			useCases = append(useCases, uc)
		}
	}

	c.JSON(http.StatusOK, gin.H{"use_cases": useCases})
}

// getRecommendations returns the best nodes for a specific request
func getRecommendations(c *gin.Context) {
	var req matching.RecommendationRequest

	// If GET, try to load user preferences as base
	if c.Request.Method == http.MethodGet {
		userIDStr, exists := c.Get("user_id")
		if exists {
			var prefs models.UserPreference
			if err := db.DB.Where("user_id = ?", userIDStr).First(&prefs).Error; err == nil {
				if prefs.PreferredUseCaseID != nil {
					req.UseCase = matching.UseCaseType(prefs.PreferredUseCaseID.String())
				}
				if prefs.MaxPricePerGB != nil {
					req.MaxPrice = *prefs.MaxPricePerGB
				}
				// Preferences for regions etc would go here
			}
		}
	} else {
		// POST: Bind ad-hoc request
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
			return
		}
	}

	recommendations, err := matchEngine.Recommend(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to generate recommendations"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"recommendations": recommendations})
}

// getRecommendationsByUseCase allows simple GET access for quick recommendations
func getRecommendationsByUseCase(c *gin.Context) {
	useCaseID := c.Param("useCaseId")
	region := c.Query("region")

	req := matching.RecommendationRequest{
		UseCase: matching.UseCaseType(useCaseID),
		Region:  region,
		Count:   5,
	}

	recommendations, err := matchEngine.Recommend(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to generate recommendations"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"recommendations": recommendations})
}

// Placeholder preference handlers for user specific settings
// In a real app these would save to the User model

// UpdatePreferencesRequest for binding
type UpdatePreferencesRequest struct {
	PreferredUseCaseID *string  `json:"preferred_use_case_id"`
	PreferredRegions   []string `json:"preferred_regions"`
	MaxPricePerGB      *float64 `json:"max_price_per_gb"`
	MinSellerRating    *float64 `json:"min_seller_rating"`
}

func getMyPreferences(c *gin.Context) {
	userIDStr, _ := c.Get("user_id")
	var prefs models.UserPreference
	if err := db.DB.Where("user_id = ?", userIDStr).First(&prefs).Error; err != nil {
		c.JSON(http.StatusNotFound, ErrorResponse{Error: "Preferences not found"})
		return
	}
	c.JSON(http.StatusOK, prefs)
}

func updatePreferences(c *gin.Context) {
	var req UpdatePreferencesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	userIDStr, _ := c.Get("user_id")

	var prefs models.UserPreference
	err := db.DB.Where("user_id = ?", userIDStr).First(&prefs).Error

	if err != nil {
		// Create
		prefs = models.UserPreference{
			UserID: userIDStr.(uuid.UUID),
		}
	}

	if req.MaxPricePerGB != nil {
		prefs.MaxPricePerGB = req.MaxPricePerGB
	}
	if req.PreferredRegions != nil {
		prefs.PreferredRegions = req.PreferredRegions
	}

	if err := db.DB.Save(&prefs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to save preferences"})
		return
	}

	c.JSON(http.StatusOK, prefs)
}
