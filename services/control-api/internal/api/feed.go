package api

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

// RegisterFeedRoutes registers feed-related routes
func RegisterFeedRoutes(rg *gin.RouterGroup) {
	rg.GET("/feed", getFeed)
	rg.GET("/discover", discoverProviders)
	rg.GET("/trending", getTrendingListings)
}

// getFeed returns personalized feed based on who user follows
func getFeed(c *gin.Context) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid user ID"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	// Get users that current user follows
	var followingIDs []uuid.UUID
	db.Social().Model(&models.Follow{}).Where("follower_id = ?", userID).Pluck("following_id", &followingIDs)

	var events []models.FeedEvent
	var total int64

	query := db.Social().Model(&models.FeedEvent{})

	if len(followingIDs) > 0 {
		// Get events from followed users
		query = query.Where("actor_id IN ?", followingIDs)
	} else {
		// No follows, show all public events
		// TRY REDIS CACHE FIRST (For Page 1)
		if page == 1 && redisClient.Client != nil {
			val, err := redisClient.Client.LRange(context.Background(), "public:feed", 0, int64(limit-1)).Result()
			if err == nil && len(val) > 0 {
				var cachedEvents []models.FeedEvent
				for _, v := range val {
					var e models.FeedEvent
					json.Unmarshal([]byte(v), &e)
					cachedEvents = append(cachedEvents, e)
				}
				// Return cached
				c.JSON(http.StatusOK, gin.H{
					"events": cachedEvents,
					"total":  100, // Estimate
					"page":   page,
					"limit":  limit,
					"source": "cache",
				})
				return
			}
		}

		query = query.Where("event_type IN ?", []string{
			string(models.FeedEventNewListing),
			string(models.FeedEventBadgeEarned),
			string(models.FeedEventMilestone),
			string(models.FeedEventNewSale), // Added New Sale
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
	userIDStr := c.GetString("userID")
	// Note: discover can be public, but if we have a user, we exclude followed.
	// The middleware ensures userID is set if auth header is present.

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	var providers []models.User
	var total int64

	query := db.DB.Model(&models.User{}).
		Where("role = ?", "provider")

	// Exclude already followed users
	if userIDStr != "" {
		userID, err := uuid.Parse(userIDStr)
		if err == nil {
			var followingIDs []uuid.UUID
			db.Social().Model(&models.Follow{}).Where("follower_id = ?", userID).Pluck("following_id", &followingIDs)

			if len(followingIDs) > 0 {
				query = query.Where("id NOT IN ?", followingIDs)
			}
			query = query.Where("id != ?", userID)
		}
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

// PublishFeedEvent broadcasts and caches a feed event
func PublishFeedEvent(event models.FeedEvent) {
	publishFeedEvent(redisClient.Client, event)
}

// publishFeedEvent is PublishFeedEvent with the Redis client chosen by the
// caller, for goroutines that must not read the package-level client later.
func publishFeedEvent(rc redisClient.RedisClient, event models.FeedEvent) {
	// 1. WebSocket Broadcast
	BroadcastToAll(string(event.EventType), event)

	// 2. Redis Cache (Public Feed)
	// We only cache public events (e.g. listings, sales)
	key := "public:feed"

	// Marshal
	data, _ := json.Marshal(event)

	// LPUSH + LTRIM
	if rc != nil {
		ctx := context.Background()
		rc.LPush(ctx, key, data)
		rc.LTrim(ctx, key, 0, 99) // Keep last 100
	}
}

// Updated getFeed to use Cache
// ... (I will update getFeed separately to avoid huge replace block)
