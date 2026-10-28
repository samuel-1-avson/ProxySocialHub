package marketplace

import (
	"testing"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestCountActiveListingSessions_IgnoresDisabledAndExpired(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "sessions", "proxy_listings", "wallets", "users")

	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("occ_seller"), "provider")
	listing := models.ProxyListing{
		SellerID:             seller.ID,
		Title:                "occ",
		PricePerGB:           1,
		AvailableBandwidthGB: 10,
		MaxConcurrency:       2,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("create listing: %v", err)
	}
	lid := listing.ID
	now := time.Now().UTC()
	expired := now.Add(-time.Hour)
	future := now.Add(time.Hour)

	mustSession := func(status models.SessionStatus, exp *time.Time) {
		s := models.Session{
			UserID:    seller.ID,
			ListingID: &lid,
			Type:      models.SessionRotating,
			Status:    status,
			Config:    "{}", // sessions.config is jsonb; the zero value "" is not valid JSON
			ExpiresAt: exp,
		}
		if err := db.DB.Create(&s).Error; err != nil {
			t.Fatalf("create session: %v", err)
		}
	}
	mustSession(models.SessionActive, &future)
	mustSession(models.SessionActive, nil)
	mustSession(models.SessionDisabled, &future)
	mustSession(models.SessionActive, &expired)

	if got := CountActiveListingSessions(listing.ID); got != 2 {
		t.Fatalf("active sessions: got %d want 2", got)
	}
	RefreshListingOccupancy(listing.ID)
	var reloaded models.ProxyListing
	if err := db.DB.First(&reloaded, "id = ?", listing.ID).Error; err != nil {
		t.Fatalf("reload listing: %v", err)
	}
	if reloaded.ActiveSessionsCount != 2 {
		t.Fatalf("denormalized count: got %d want 2", reloaded.ActiveSessionsCount)
	}

	listing.MaxConcurrency = 2
	if !ListingAtConcurrencyCap(&listing) {
		t.Fatal("expected listing at cap with 2/2 sessions")
	}
	listing.MaxConcurrency = 3
	if ListingAtConcurrencyCap(&listing) {
		t.Fatal("did not expect cap at 2/3")
	}
}
