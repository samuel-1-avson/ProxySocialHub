package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// providerTierRequirement describes what a provider needs to achieve a given verification tier.
type providerTierRequirement struct {
	MinScore    float64 `json:"min_score"`
	MinUptime   float64 `json:"min_uptime_percent"`
	MinSessions int     `json:"min_sessions"`
	MaxDisputes int     `json:"max_disputes"`
	Description string  `json:"description"`
}

var providerTierRequirements = map[string]providerTierRequirement{
	"unverified": {
		MinScore:    0,
		MinUptime:   0,
		MinSessions: 0,
		MaxDisputes: -1,
		Description: "Default tier for all new providers. No requirements met yet.",
	},
	"basic": {
		MinScore:    20,
		MinUptime:   90,
		MinSessions: 0,
		MaxDisputes: -1,
		Description: "Score >= 20 and uptime >= 90%. A solid starting point.",
	},
	"verified": {
		MinScore:    50,
		MinUptime:   95,
		MinSessions: 100,
		MaxDisputes: -1,
		Description: "Score >= 50, uptime >= 95%, and at least 100 sessions.",
	},
	"premium": {
		MinScore:    75,
		MinUptime:   98,
		MinSessions: 500,
		MaxDisputes: 0,
		Description: "Score >= 75, uptime >= 98%, 500+ sessions, and zero disputes.",
	},
	"enterprise": {
		MinScore:    90,
		MinUptime:   99,
		MinSessions: 2000,
		MaxDisputes: 0,
		Description: "Score >= 90, uptime >= 99%, 2000+ sessions, and zero disputes.",
	},
}

// providerTierOrder defines the progression of tiers from lowest to highest.
var providerTierOrder = []string{"unverified", "basic", "verified", "premium", "enterprise"}

// nextProviderTier returns the tier above the given one ("" if already at top).
func nextProviderTier(current string) string {
	for i, t := range providerTierOrder {
		if t == current && i+1 < len(providerTierOrder) {
			return providerTierOrder[i+1]
		}
	}
	return ""
}

// RegisterTierRoutes registers provider verification tier routes on the protected group.
func RegisterTierRoutes(protected *gin.RouterGroup) {
	// Note: Using :id to match existing /v1/providers/:id pattern and avoid route conflicts
	protected.GET("/providers/:id/tier", GetProviderTier)
	protected.PUT("/providers/:id/tier", UpdateProviderTier)
	protected.GET("/tiers/requirements", GetTierRequirements)
}

// GetProviderTier returns the tier info for a specific provider node.
// GET /v1/providers/:id/tier
func GetProviderTier(c *gin.Context) {
	providerIDStr := c.Param("id")
	providerID, err := uuid.Parse(providerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid provider ID"})
		return
	}

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database unavailable"})
		return
	}

	var node models.ProviderNode
	if err := db.DB.Where("id = ?", providerID).First(&node).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Provider not found"})
		return
	}

	next := nextProviderTier(node.Tier)
	var nextReq interface{}
	if next != "" {
		r := providerTierRequirements[next]
		nextReq = r
	}

	c.JSON(http.StatusOK, gin.H{
		"provider_id":           node.ID,
		"tier":                  node.Tier,
		"tier_score":            node.TierScore,
		"uptime_percent":        node.UptimePercent,
		"total_sessions_served": node.TotalSessionsServed,
		"avg_latency_ms":        node.AvgLatencyMs,
		"dispute_count":         node.DisputeCount,
		"tier_verified_at":      node.TierVerifiedAt,
		"tier_requirements": gin.H{
			"current":   providerTierRequirements[node.Tier],
			"next_tier": next,
			"next":      nextReq,
		},
	})
}

// GetTierRequirements returns the full requirements map for all 5 verification tiers.
// GET /v1/tiers/requirements
func GetTierRequirements(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"tiers": providerTierRequirements,
		"order": providerTierOrder,
	})
}

// UpdateProviderTier allows a provider to update their own node's tier-related settings.
// PUT /v1/providers/:id/tier
func UpdateProviderTier(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	providerIDStr := c.Param("id")
	providerID, err := uuid.Parse(providerIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid provider ID"})
		return
	}

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database unavailable"})
		return
	}

	// Verify caller owns this provider node
	var node models.ProviderNode
	if err := db.DB.Where("id = ? AND user_id = ?", providerID, userID).First(&node).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Provider node not found or access denied"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"provider_id": node.ID,
		"tier":        node.Tier,
		"tier_score":  node.TierScore,
		"message":     "Tier settings retrieved successfully. Tier is automatically recalculated on evaluation cycle.",
	})
}
