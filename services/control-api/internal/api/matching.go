package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/matching"
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
		group.POST("/recommend", getRecommendations)
		group.GET("/recommend/:useCaseId", getRecommendationsByUseCase)
		group.GET("/preferences", getMyPreferences)
		group.PUT("/preferences", updatePreferences)
	}
}

// getUseCases returns the list of supported use cases and their descriptions
func getUseCases(c *gin.Context) {
	profiles := matchEngine.GetProfiles()

	type UseCaseResponse struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description"`
	}

	var response []UseCaseResponse
	for id, profile := range profiles {
		response = append(response, UseCaseResponse{
			ID:          string(id),
			Name:        profile.Name,
			Description: profile.Description,
		})
	}

	c.JSON(http.StatusOK, gin.H{"use_cases": response})
}

// getRecommendations returns the best nodes for a specific request
func getRecommendations(c *gin.Context) {
	var req matching.RecommendationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
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

func getMyPreferences(c *gin.Context) {
	// Mock response
	c.JSON(http.StatusOK, gin.H{
		"preferred_regions": []string{"us", "eu"},
		"default_use_case":  "general",
	})
}

func updatePreferences(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "updated"})
}
