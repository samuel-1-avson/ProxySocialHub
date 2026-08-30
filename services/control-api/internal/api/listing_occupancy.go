package api

import (
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/models"
)

// enrichListingsOccupancy overwrites active_sessions_count from live session rows
// so browse/detail/map consumers do not depend on the denormalized column.
func enrichListingsOccupancy(listings []models.ProxyListing) {
	if len(listings) == 0 {
		return
	}
	ids := make([]uuid.UUID, len(listings))
	for i, l := range listings {
		ids[i] = l.ID
	}
	counts := marketplace.CountActiveListingSessionsByID(ids)
	for i := range listings {
		listings[i].ActiveSessionsCount = counts[listings[i].ID]
	}
}
