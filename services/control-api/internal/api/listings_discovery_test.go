package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestIncludeHasToken(t *testing.T) {
	if !includeHasToken("product,registry", "registry") {
		t.Fatal("expected registry token")
	}
	if includeHasToken("product", "registry") {
		t.Fatal("unexpected registry")
	}
	if !includeHasToken("REGISTRY", "registry") {
		t.Fatal("case insensitive")
	}
}

func TestDiscoveryHonestyMeta(t *testing.T) {
	t.Setenv("PROXYHUB_PROVIDER_REGISTRY_GATE", "observe")
	t.Setenv("PROXYHUB_BROWSE_REGISTRY_FILTER", "enforce")
	t.Setenv("PROXYHUB_LISTING_COMMITMENT", "")
	t.Setenv("PROXYHUB_LISTING_BUNDLE_PATH", "")
	t.Setenv("PROXYHUB_LISTING_BUNDLE_URL", "")
	t.Setenv("PROXYHUB_LISTING_BUNDLE_CID", "")
	m := discoveryHonestyMeta()
	if m.CatalogSource != "postgres" || m.DelistAuthority != "platform_moderation" {
		t.Fatalf("unexpected meta: %+v", m)
	}
	if m.RegistryGateMode != "observe" {
		t.Fatalf("gate mode: %s", m.RegistryGateMode)
	}
	if m.BrowseRegistryFilter != "enforce" {
		t.Fatalf("browse filter: %s", m.BrowseRegistryFilter)
	}
	if m.ListingCommitments != "ed25519_offer_hash" || m.ListingCommitmentMode != "off" {
		t.Fatalf("commitments field: %+v", m)
	}
	t.Setenv("PROXYHUB_LISTING_COMMITMENT", "observe")
	m = discoveryHonestyMeta()
	if m.ListingCommitments != "ed25519_offer_hash+listing_commitment_pda" {
		t.Fatalf("expected pda honesty, got %s", m.ListingCommitments)
	}
	t.Setenv("PROXYHUB_LISTING_BUNDLE_PATH", "/tmp/listings.json")
	m = discoveryHonestyMeta()
	if m.CatalogSource != "postgres_cache" {
		t.Fatalf("pinned bundle must be postgres_cache, got %s", m.CatalogSource)
	}
}

func TestGetListings_DiscoveryHonestyObserve(t *testing.T) {
	t.Setenv("PROXYHUB_LISTING_COMMITMENT", "observe")
	t.Setenv("PROXYHUB_BROWSE_REGISTRY_FILTER", "off")
	t.Setenv("PROXYHUB_LISTING_BUNDLE_PATH", "")
	t.Setenv("PROXYHUB_LISTING_BUNDLE_URL", "")
	t.Setenv("PROXYHUB_LISTING_BUNDLE_CID", "")

	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "proxy_listings")

	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("w10b_honesty"), "provider")
	listing := models.ProxyListing{
		SellerID:             seller.ID,
		Title:                "W10.B honesty soak listing",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		PricePerGB:           1.5,
		AvailableBandwidthGB: 10,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatal(err)
	}

	r := setupTestRouter()
	r.GET("/listings", getListings)
	req := httptest.NewRequest(http.MethodGet, "/listings?limit=5&seller_id="+seller.ID.String(), nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}

	var resp ListingsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Discovery.ListingCommitmentMode != "observe" {
		t.Fatalf("mode=%q", resp.Discovery.ListingCommitmentMode)
	}
	if resp.Discovery.ListingCommitments != "ed25519_offer_hash+listing_commitment_pda" {
		t.Fatalf("commitments=%q", resp.Discovery.ListingCommitments)
	}
	if resp.Discovery.CatalogSource != "postgres" || resp.Discovery.DelistAuthority != "platform_moderation" {
		t.Fatalf("unexpected honesty: %+v", resp.Discovery)
	}
}

func TestFilterListingsByBrowseRegistry(t *testing.T) {
	t.Setenv("PROXYHUB_BROWSE_REGISTRY_FILTER", "off")
	reg := true
	unreg := false
	in := []models.ProxyListing{
		{Title: "a", ProviderRegisteredOnChain: &reg},
		{Title: "b", ProviderRegisteredOnChain: &unreg},
		{Title: "c"},
	}
	if got := filterListingsByBrowseRegistry(in); len(got) != 3 {
		t.Fatalf("off must keep all, got %d", len(got))
	}
	t.Setenv("PROXYHUB_BROWSE_REGISTRY_FILTER", "enforce")
	got := filterListingsByBrowseRegistry(in)
	if len(got) != 1 || got[0].Title != "a" {
		t.Fatalf("enforce must keep only registered, got %+v", got)
	}
}

func TestFilterListingsByListingCommitment(t *testing.T) {
	t.Setenv("PROXYHUB_LISTING_COMMITMENT", "off")
	in := []models.ProxyListing{
		{Title: "a", ListingCommitmentOnChain: true},
		{Title: "b", ListingCommitmentOnChain: false},
	}
	if got := filterListingsByListingCommitment(in); len(got) != 2 {
		t.Fatalf("off must keep all, got %d", len(got))
	}
	t.Setenv("PROXYHUB_LISTING_COMMITMENT", "enforce")
	got := filterListingsByListingCommitment(in)
	if len(got) != 1 || got[0].Title != "a" {
		t.Fatalf("enforce must keep only committed, got %+v", got)
	}
}
