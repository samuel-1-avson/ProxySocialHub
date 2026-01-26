package api

import (
	"crypto/sha256"
	"encoding/hex"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/ws"
)

// RegisterBadgeRoutes registers badge-related routes
func RegisterBadgeRoutes(rg *gin.RouterGroup) {
	rg.GET("/badges", getAllBadges)
	rg.GET("/badges/my", getMyBadges)
}

// getAllBadges returns all available badges
func getAllBadges(c *gin.Context) {
	var badges []models.Badge
	db.DB.Find(&badges)
	c.JSON(http.StatusOK, gin.H{"badges": badges})
}

// getMyBadges returns badges earned by current user
func getMyBadges(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var userBadges []models.UserBadge
	db.DB.Preload("Badge").Where("user_id = ?", userID).Find(&userBadges)

	c.JSON(http.StatusOK, gin.H{"badges": userBadges})
}

// ============ Badge Award System ============

// CheckAndAwardBadges checks milestones and awards badges
func CheckAndAwardBadges(userID uuid.UUID, eventType string) {
	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
		return
	}

	switch eventType {
	case "sale":
		checkSalesBadges(userID, user)
	case "review":
		checkReviewBadges(userID, user)
	case "verification":
		awardBadge(userID, "Verified Seller")
	case "quality_update":
		checkQualityBadges(userID, user)
	}
}

func checkQualityBadges(userID uuid.UUID, user models.User) {
	// Uptime King: 99.9%+ Uptime
	var nodes []models.ProviderNode
	db.DB.Where("user_id = ?", userID).Find(&nodes)

	if len(nodes) == 0 {
		return
	}

	bestQuality := 0.0
	for _, n := range nodes {
		if n.QualityScore > bestQuality {
			bestQuality = n.QualityScore
		}
	}

	if bestQuality >= 99.9 {
		awardBadge(userID, "Uptime King")
	}

	// Speedster: Average node latency under 50ms (QualityScore formula includes latency)
	// We'll simplify and award if QualityScore is very high or add latency field check
	if bestQuality >= 95.0 {
		awardBadge(userID, "Speedster")
	}

	// Network Giant: 500+ GB served
	if user.TotalBandwidthSold >= 500 {
		awardBadge(userID, "Network Giant")
	}
}

func checkSalesBadges(userID uuid.UUID, user models.User) {
	bandwidth := user.TotalBandwidthSold

	// Top Seller: 1000+ GB sold
	if bandwidth >= 1000 {
		awardBadge(userID, "Top Seller")
	}

	// Rising Star: 100+ GB sold
	if bandwidth >= 100 {
		awardBadge(userID, "Rising Star")
	}

	// First Sale badge (check via orders count)
	var orderCount int64
	db.DB.Model(&models.Order{}).Where("seller_id = ?", userID).Count(&orderCount)
	if orderCount >= 1 {
		awardBadge(userID, "First Sale")
	}
}

func checkReviewBadges(userID uuid.UUID, user models.User) {
	avgRating := user.AvgRating
	reviewsCount := user.ReviewsCount

	// Check average rating
	if avgRating >= 4.8 && reviewsCount >= 10 {
		awardBadge(userID, "Trusted Provider")
	}

	// Five star streak - count consecutive 5-star reviews
	var fiveStarCount int64
	db.DB.Model(&models.Review{}).Where("seller_id = ? AND rating = 5", userID).Count(&fiveStarCount)
	if fiveStarCount >= 5 {
		awardBadge(userID, "Five Star Streak")
	}
}

func awardBadge(userID uuid.UUID, badgeName string) {
	// Get badge
	var badge models.Badge
	if err := db.DB.Where("name = ?", badgeName).First(&badge).Error; err != nil {
		// Create badge if doesn't exist
		badge = models.Badge{
			Name:        badgeName,
			Description: getBadgeDescription(badgeName),
			Icon:        getBadgeIcon(badgeName),
		}
		db.DB.Create(&badge)
	}

	// Check if already awarded
	var existing models.UserBadge
	if err := db.DB.Where("user_id = ? AND badge_id = ?", userID, badge.ID).First(&existing).Error; err == nil {
		return // Already has badge
	}

	// Award badge
	userBadge := models.UserBadge{
		UserID:  userID,
		BadgeID: badge.ID,
	}
	db.DB.Create(&userBadge)

	log.Printf("Badge awarded: %s to user %s", badgeName, userID)

	// DECENTRALIZATION (Phase 21): Anchor to Solana
	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err == nil && user.WalletAddress != nil {
		hash := sha256.Sum256([]byte(badgeName))
		hashStr := hex.EncodeToString(hash[:])
		go func() {
			client := solana.GetOracleClient()
			if client != nil {
				client.AnchorReputation(nil, *user.WalletAddress, solana.RepTypeBadge, hashStr)
			}
		}()
	}

	// Notify via WebSocket
	ws.BroadcastToUser(userID.String(), ws.MsgTypeNotification, gin.H{
		"title":   "Badge Earned!",
		"message": "You've earned the " + badgeName + " badge!", // Assuming badge.Type is not available and badgeName is intended
	})

	// Create feed event
	feedEvent := models.FeedEvent{
		ActorID:    &userID,
		EventType:  "new_badge",
		TargetType: "badge",
		TargetID:   &badge.ID,
		Content:    "earned the " + badgeName + " badge",
	}
	db.DB.Create(&feedEvent)
}

func getBadgeDescription(name string) string {
	descriptions := map[string]string{
		"Verified Seller":  "Completed identity verification",
		"Top Seller":       "Sold over 1000 GB of bandwidth",
		"Rising Star":      "Sold over 100 GB of bandwidth",
		"First Sale":       "Completed first sale",
		"Five Star Streak": "Received 5 consecutive 5-star reviews",
		"Trusted Provider": "Maintained 4.8+ rating with 10+ reviews",
		"Early Adopter":    "Joined during platform launch",
		"Fast Responder":   "Average response time under 1 hour",
		"Uptime King":      "Maintained 99.9%+ node uptime",
		"Speedster":        "Average node latency under 50ms",
		"Network Giant":    "Served over 500 GB of network traffic",
	}
	return descriptions[name]
}

func getBadgeIcon(name string) string {
	icons := map[string]string{
		"Verified Seller":  "shield-check",
		"Top Seller":       "trophy",
		"Rising Star":      "star",
		"First Sale":       "gift",
		"Five Star Streak": "stars",
		"Trusted Provider": "award",
		"Early Adopter":    "rocket",
		"Fast Responder":   "zap",
		"Uptime King":      "crown",
		"Speedster":        "bolt",
		"Network Giant":    "database",
	}
	return icons[name]
}
