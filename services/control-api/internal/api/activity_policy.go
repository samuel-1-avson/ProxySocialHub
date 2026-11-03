package api

import "github.com/proxyhubb/control-api/internal/models"

func publicActivityTypes() []models.FeedEventType {
	return []models.FeedEventType{models.FeedEventNewListing, models.FeedEventListingUpdate, models.FeedEventNewReview, models.FeedEventBadgeEarned, models.FeedEventMilestone, models.FeedEventNewSale, models.FeedEventNewThread}
}
func isPublicActivityType(kind models.FeedEventType) bool {
	for _, v := range publicActivityTypes() {
		if kind == v {
			return true
		}
	}
	return false
}
