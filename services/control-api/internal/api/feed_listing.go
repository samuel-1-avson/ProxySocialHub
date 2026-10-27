package api

import (
	"fmt"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/core/domain"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

// publishNewListingFeedEvent records and broadcasts a marketplace listing launch.
func publishNewListingFeedEvent(sellerID uuid.UUID, published domain.ListingEntity) {
	if published.ID == uuid.Nil {
		return
	}

	content := fmt.Sprintf("listed \"%s\"", published.Title)
	meta := map[string]interface{}{
		"listing_title": published.Title,
		"proxy_type":    string(published.ProxyType),
		"protocol":      published.Protocol,
		"country":       published.Country,
		"price_per_gb":  published.PricePerGB,
	}

	feedEvent := models.CreateFeedEvent(
		&sellerID,
		models.FeedEventNewListing,
		"listing",
		&published.ID,
		content,
		meta,
	)
	if err := db.Social().Create(feedEvent).Error; err != nil {
		logging.Warn().Err(err).Str("listing_id", published.ID.String()).Msg("publishNewListingFeedEvent: db create failed")
		return
	}

	// Take the shared handles now: the goroutine can outlive the request (in tests,
	// the test that started it, while the next test swaps the Redis client).
	gdb, rc := db.DB, redisClient.Client
	go func(eventID uuid.UUID) {
		var fullEvent models.FeedEvent
		if err := gdb.Preload("Actor").First(&fullEvent, "id = ?", eventID).Error; err == nil {
			publishFeedEvent(rc, fullEvent)
		}
	}(feedEvent.ID)
}
