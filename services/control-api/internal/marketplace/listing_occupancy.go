package marketplace

import (
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// CountActiveListingSessions is the live occupancy for a listing: escrow-activated
// sessions that have not expired. CONNECT tunnels share this inventory.
func CountActiveListingSessions(listingID uuid.UUID) int {
	if listingID == uuid.Nil {
		return 0
	}
	var n int64
	db.DB.Model(&models.Session{}).
		Where("listing_id = ? AND status = ? AND (expires_at IS NULL OR expires_at > ?)",
			listingID, models.SessionActive, time.Now().UTC()).
		Count(&n)
	return int(n)
}

// CountActiveListingSessionsByID returns occupancy for a batch of listings.
func CountActiveListingSessionsByID(ids []uuid.UUID) map[uuid.UUID]int {
	out := make(map[uuid.UUID]int, len(ids))
	if len(ids) == 0 {
		return out
	}
	type row struct {
		ListingID uuid.UUID `gorm:"column:listing_id"`
		Count     int64     `gorm:"column:count"`
	}
	var rows []row
	db.DB.Model(&models.Session{}).
		Select("listing_id, COUNT(*) AS count").
		Where("listing_id IN ? AND status = ? AND (expires_at IS NULL OR expires_at > ?)",
			ids, models.SessionActive, time.Now().UTC()).
		Group("listing_id").
		Scan(&rows)
	for _, r := range rows {
		out[r.ListingID] = int(r.Count)
	}
	return out
}

// RefreshListingOccupancy writes proxy_listings.active_sessions_count from live sessions.
func RefreshListingOccupancy(listingID uuid.UUID) {
	if listingID == uuid.Nil || db.DB == nil {
		return
	}
	n := CountActiveListingSessions(listingID)
	_ = db.DB.Model(&models.ProxyListing{}).
		Where("id = ?", listingID).
		UpdateColumn("active_sessions_count", n).Error
}

// ListingAtConcurrencyCap is true when live sessions already fill max_concurrency.
// max_concurrency <= 0 means unlimited shared access.
func ListingAtConcurrencyCap(listing *models.ProxyListing) bool {
	if listing == nil || listing.MaxConcurrency <= 0 {
		return false
	}
	return CountActiveListingSessions(listing.ID) >= listing.MaxConcurrency
}
