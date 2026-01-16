package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterFeedRoutes registers feed-related routes
func RegisterFeedRoutes(rg *gin.RouterGroup) {
	rg.GET("/feed", getFeed)
	rg.GET("/discover", discoverProviders)
	rg.GET("/trending", getTrendingListings)
}

// getFeed returns personalized feed based on who user follows
func getFeed(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	// Get users that current user follows
	var followingIDs []uuid.UUID
	db.DB.Model(&models.Follow{}).Where("follower_id = ?", userID).Pluck("following_id", &followingIDs)

	var events []models.FeedEvent
	var total int64

	query := db.DB.Model(&models.FeedEvent{})

	if len(followingIDs) > 0 {
		// Get events from followed users
		query = query.Where("actor_id IN ?", followingIDs)
	} else {
		// No follows, show all public events
		query = query.Where("event_type IN ?", []string{
			string(models.FeedEventNewListing),
			string(models.FeedEventBadgeEarned),
			string(models.FeedEventMilestone),
		})
	}

	query.Count(&total)

	if err := query.Preload("Actor").
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&events).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch feed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"events": events,
		"total":  total,
		"page":   page,
		"limit":  limit,
	})
}

// discoverProviders returns top providers to follow
func discoverProviders(c *gin.Context) {
	currentUserID, exists := c.Get("user_id")

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	var providers []models.User
	var total int64

	query := db.DB.Model(&models.User{}).
		Where("role = ? AND status = ?", "provider", "active")

	// Exclude already followed users
	if exists {
		userID := currentUserID.(uuid.UUID)
		var followingIDs []uuid.UUID
		db.DB.Model(&models.Follow{}).Where("follower_id = ?", userID).Pluck("following_id", &followingIDs)

		if len(followingIDs) > 0 {
			query = query.Where("id NOT IN ?", followingIDs)
		}
		query = query.Where("id != ?", userID)
	}

	query.Count(&total)

	// Order by rating and bandwidth sold
	if err := query.Order("avg_rating DESC, total_bandwidth_sold DESC").
		Offset(offset).Limit(limit).
		Find(&providers).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch providers"})
		return
	}

	// Convert to public profiles
	profiles := make([]models.UserPublicProfile, len(providers))
	for i, p := range providers {
		profiles[i] = p.ToPublicProfile()
	}

	c.JSON(http.StatusOK, gin.H{
		"providers": profiles,
		"total":     total,
		"page":      page,
		"limit":     limit,
	})
}

// getTrendingListings returns popular listings
func getTrendingListings(c *gin.Context) {
	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	var listings []models.ProxyListing
	var total int64

	query := db.DB.Model(&models.ProxyListing{}).
		Where("status = ?", models.ListingStatusActive)

	query.Count(&total)

	// Score by views, saves, and orders
	if err := query.Preload("Seller").
		Order("(views_count + saves_count * 2 + orders_count * 5) DESC, created_at DESC").
		Offset(offset).Limit(limit).
		Find(&listings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch trending listings"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"listings": listings,
		"total":    total,
		"page":     page,
		"limit":    limit,
	})
}
