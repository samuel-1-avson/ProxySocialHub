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

type servicesDiscoveryResponse struct {
	Services []models.ProxyListing `json:"services"`
	Total    int64               `json:"total"`
}

// TestServiceDiscoveryParity_ActiveListingsSubset verifies deprecated GET /v1/services
// only returns active listings that also appear under GET /v1/listings for equivalent filters.
func TestServiceDiscoveryParity_ActiveListingsSubset(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "proxy_listings")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("discovery_parity"), "provider")

	activeUS := models.ProxyListing{
		SellerID:     provider.ID,
		Title:        "US Active",
		Country:      "US",
		ProxyType:    "residential",
		Protocol:     "http",
		PricePerGB:   3.0,
		Status:       models.ListingStatusActive,
		QualityScore: 90,
	}
	activeDE := models.ProxyListing{
		SellerID:     provider.ID,
		Title:        "DE Active",
		Country:      "DE",
		ProxyType:    "residential",
		Protocol:     "http",
		PricePerGB:   2.0,
		Status:       models.ListingStatusActive,
		QualityScore: 85,
	}
	pendingUS := models.ProxyListing{
		SellerID:   provider.ID,
		Title:      "US Pending",
		Country:    "US",
		ProxyType:  "residential",
		Protocol:   "http",
		PricePerGB: 1.0,
		Status:     models.ListingStatusPendingReview,
	}
	if err := db.DB.Create(&activeUS).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.DB.Create(&activeDE).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.DB.Create(&pendingUS).Error; err != nil {
		t.Fatal(err)
	}

	r := setupTestRouter()
	r.GET("/listings", getListings)
	r.GET("/services", discoverServices)

	listingsReq := httptest.NewRequest(
		"GET",
		"/listings?country=US&seller_id="+provider.ID.String()+"&limit=100&page=1",
		nil,
	)
	listingsRec := httptest.NewRecorder()
	r.ServeHTTP(listingsRec, listingsReq)
	if listingsRec.Code != http.StatusOK {
		t.Fatalf("listings status %d: %s", listingsRec.Code, listingsRec.Body.String())
	}

	var listingsResp ListingsResponse
	if err := json.Unmarshal(listingsRec.Body.Bytes(), &listingsResp); err != nil {
		t.Fatal(err)
	}

	servicesReq := httptest.NewRequest(
		"GET",
		"/services?target_countries=US&page=0&limit=100",
		nil,
	)
	servicesRec := httptest.NewRecorder()
	r.ServeHTTP(servicesRec, servicesReq)
	if servicesRec.Code != http.StatusOK {
		t.Fatalf("services status %d: %s", servicesRec.Code, servicesRec.Body.String())
	}

	var servicesResp servicesDiscoveryResponse
	if err := json.Unmarshal(servicesRec.Body.Bytes(), &servicesResp); err != nil {
		t.Fatal(err)
	}

	listingIDs := make(map[string]struct{}, len(listingsResp.Listings))
	for _, l := range listingsResp.Listings {
		listingIDs[l.ID.String()] = struct{}{}
		if l.Status != models.ListingStatusActive {
			t.Fatalf("listings browse returned non-active status %s", l.Status)
		}
	}
	if len(listingsResp.Listings) != 1 || listingsResp.Listings[0].Title != "US Active" {
		t.Fatalf("expected only US active listing, got %+v", listingsResp.Listings)
	}

	for _, svc := range servicesResp.Services {
		if _, ok := listingIDs[svc.ID.String()]; !ok {
			t.Fatalf("service discovery returned listing %s not in canonical listings set", svc.ID)
		}
		if svc.Status != models.ListingStatusActive {
			t.Fatalf("services returned non-active status %s", svc.Status)
		}
	}
	if len(servicesResp.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(servicesResp.Services))
	}
}

func TestServiceDiscoveryParity_PageOneMatchesListingsFirstPage(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("discovery_page1"), "provider")
	listing := models.ProxyListing{
		SellerID:     provider.ID,
		Title:        "Page one",
		Country:      "US",
		ProxyType:    "residential",
		Protocol:     "http",
		PricePerGB:   1.0,
		Status:       models.ListingStatusActive,
		QualityScore: 99,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatal(err)
	}

	r := setupTestRouter()
	r.GET("/listings", getListings)
	r.GET("/services", discoverServices)

	qualityQuery := "min_quality_score=99"
	listingsRec := httptest.NewRecorder()
	r.ServeHTTP(listingsRec, httptest.NewRequest(
		"GET",
		"/listings?seller_id="+provider.ID.String()+"&"+qualityQuery+"&limit=10&page=1",
		nil,
	))
	servicesRec := httptest.NewRecorder()
	r.ServeHTTP(servicesRec, httptest.NewRequest(
		"GET",
		"/services?"+qualityQuery+"&page=1&limit=10",
		nil,
	))

	var listingsResp ListingsResponse
	var servicesResp servicesDiscoveryResponse
	if err := json.Unmarshal(listingsRec.Body.Bytes(), &listingsResp); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(servicesRec.Body.Bytes(), &servicesResp); err != nil {
		t.Fatal(err)
	}

	if len(listingsResp.Listings) < 1 || len(servicesResp.Services) < 1 {
		t.Fatalf("expected results listings=%d services=%d", len(listingsResp.Listings), len(servicesResp.Services))
	}
	if listingsResp.Listings[0].ID != servicesResp.Services[0].ID {
		t.Fatalf("page=1 mismatch listing=%s service=%s", listingsResp.Listings[0].ID, servicesResp.Services[0].ID)
	}
}

