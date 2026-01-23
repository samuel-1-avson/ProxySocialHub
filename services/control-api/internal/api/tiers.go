package api

import (
	"net/http"

	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// Seller Tier thresholds (GB sold) - Defaults
const (
	TierBronze  = "bronze"  // 0-99 GB
	TierSilver  = "silver"  // 100-499 GB
	TierGold    = "gold"    // 500-999 GB
	TierDiamond = "diamond" // 1000+ GB
)

// RegisterSellerTierRoutes registers seller tier routes
func RegisterSellerTierRoutes(rg *gin.RouterGroup) {
	rg.GET("/tiers", getTierInfo)
	rg.GET("/tiers/my", getMyTier)
	rg.GET("/tiers/leaderboard", getTierLeaderboard)
}

// getTierThreshold fetches the threshold from Governance Parameters or returns default
func getTierThreshold(tier string) float64 {
	defaultVal := 0.0
	paramName := ""

	switch tier {
	case TierSilver:
		defaultVal = 100.0
		paramName = "tier_threshold_silver"
	case TierGold:
		defaultVal = 500.0
		paramName = "tier_threshold_gold"
	case TierDiamond:
		defaultVal = 1000.0
		paramName = "tier_threshold_diamond"
	default:
		return 0.0
	}

	var param models.ProtocolParameter
	if err := db.DB.First(&param, "name = ?", paramName).Error; err == nil {
		if val, err := strconv.ParseFloat(param.Value, 64); err == nil {
			return val
		}
	}

	return defaultVal
}

// getTierInfo returns tier information
func getTierInfo(c *gin.Context) {
	silver := getTierThreshold(TierSilver)
	gold := getTierThreshold(TierGold)
	diamond := getTierThreshold(TierDiamond)

	tiers := []gin.H{
		{"name": "Bronze", "tier": TierBronze, "min_gb": 0, "max_gb": silver - 1, "benefits": []string{"Basic marketplace access", "Standard support"}},
		{"name": "Silver", "tier": TierSilver, "min_gb": silver, "max_gb": gold - 1, "benefits": []string{"Silver badge", "5% lower fees", "Priority listing"}},
		{"name": "Gold", "tier": TierGold, "min_gb": gold, "max_gb": diamond - 1, "benefits": []string{"Gold badge", "10% lower fees", "Featured seller", "Analytics dashboard"}},
		{"name": "Diamond", "tier": TierDiamond, "min_gb": diamond, "max_gb": nil, "benefits": []string{"Diamond badge", "15% lower fees", "VIP support", "Custom pricing", "Early access features"}},
	}

	c.JSON(http.StatusOK, gin.H{"tiers": tiers})
}

// getMyTier returns current user's seller tier
func getMyTier(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	tier := CalculateSellerTier(user.TotalBandwidthSold)
	progress := CalculateTierProgress(user.TotalBandwidthSold)

	c.JSON(http.StatusOK, gin.H{
		"current_tier":       tier,
		"total_bandwidth_gb": user.TotalBandwidthSold,
		"progress":           progress,
	})
}

// getTierLeaderboard returns top sellers
func getTierLeaderboard(c *gin.Context) {
	var users []models.User
	db.DB.Select("id, username, display_name, avatar_url, seller_tier, total_bandwidth_sold").
		Where("total_bandwidth_sold > 0").
		Order("total_bandwidth_sold DESC").
		Limit(20).
		Find(&users)

	leaderboard := make([]gin.H, len(users))
	for i, u := range users {
		leaderboard[i] = gin.H{
			"rank":         i + 1,
			"user_id":      u.ID,
			"username":     u.Username,
			"display_name": u.DisplayName,
			"avatar_url":   u.AvatarURL,
			"tier":         CalculateSellerTier(u.TotalBandwidthSold),
			"bandwidth_gb": u.TotalBandwidthSold,
		}
	}

	c.JSON(http.StatusOK, gin.H{"leaderboard": leaderboard})
}

// CalculateSellerTier determines tier based on bandwidth sold
func CalculateSellerTier(bandwidthGB float64) string {
	diamond := getTierThreshold(TierDiamond)
	gold := getTierThreshold(TierGold)
	silver := getTierThreshold(TierSilver)

	switch {
	case bandwidthGB >= diamond:
		return TierDiamond
	case bandwidthGB >= gold:
		return TierGold
	case bandwidthGB >= silver:
		return TierSilver
	default:
		return TierBronze
	}
}

// CalculateTierProgress returns progress to next tier
func CalculateTierProgress(bandwidthGB float64) gin.H {
	diamond := getTierThreshold(TierDiamond)
	gold := getTierThreshold(TierGold)
	silver := getTierThreshold(TierSilver)

	var nextTier string
	var nextThreshold, current float64

	switch {
	case bandwidthGB >= diamond:
		return gin.H{"next_tier": nil, "progress_percent": 100.0, "gb_remaining": 0}
	case bandwidthGB >= gold:
		nextTier = TierDiamond
		nextThreshold = diamond
		current = bandwidthGB - gold
	case bandwidthGB >= silver:
		nextTier = TierGold
		nextThreshold = gold
		current = bandwidthGB - silver
	default:
		nextTier = TierSilver
		nextThreshold = silver
		current = bandwidthGB
	}

	range_ := nextThreshold - (bandwidthGB - current)
	progress := (current / range_) * 100
	remaining := nextThreshold - bandwidthGB

	return gin.H{
		"next_tier":        nextTier,
		"progress_percent": progress,
		"gb_remaining":     remaining,
	}
}

// UpdateUserTier updates user's tier based on bandwidth (no-op since we don't store tier)
func UpdateUserTier(userID uuid.UUID) {
	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
		return
	}

	newTier := CalculateSellerTier(user.TotalBandwidthSold)

	// Notify user of tier (optional)
	BroadcastToUser(userID.String(), MsgTypeNotification, gin.H{
		"type":    "tier_update",
		"tier":    newTier,
		"message": "Your current tier: " + newTier,
	})

	// Award tier badge
	CheckAndAwardBadges(userID, "sale")
}
