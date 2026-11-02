package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// Regression: the country facet counted the listing's stored country, so a
// Ghana node under a stale "US" listing advertised US supply (and the
// Regional Auditor offered a US region that did not exist).
func TestGetListingFacets_NodeCountryOutranksStaleListingCountry(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings", "provider_nodes")
	invalidateMarketplaceReadModels()
	t.Cleanup(invalidateMarketplaceReadModels)

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_facet_country"), "provider")
	nodeID := uuid.New()
	mustCreateProviderNode(t, models.ProviderNode{
		ID:      nodeID,
		UserID:  provider.ID,
		Name:    "Cape Coast Provider Node",
		Country: "GH",
		City:    "Cape Coast",
		Status:  models.NodeOnline,
	})
	listings := []models.ProxyListing{
		{SellerID: provider.ID, ProviderNodeID: &nodeID, Title: "Stale country", Country: "US"},
		// No node: the stored country is all there is.
		{SellerID: provider.ID, Title: "Nodeless", Country: "NG"},
	}
	for i := range listings {
		listings[i].ProxyType = models.ProxyTypeResidential
		listings[i].Protocol = "http"
		listings[i].PricePerGB = 1
		listings[i].AvailableBandwidthGB = 10
		listings[i].Status = models.ListingStatusActive
		if err := db.DB.Create(&listings[i]).Error; err != nil {
			t.Fatalf("failed to create listing fixture: %v", err)
		}
	}

	r := setupTestRouter()
	r.GET("/listings/facets", getListingFacets)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/listings/facets", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp ListingFacetsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	got := map[string]int64{}
	for _, b := range resp.Countries {
		got[b.Value] = b.Count
	}
	if got["GH"] != 1 || got["NG"] != 1 || got["US"] != 0 {
		t.Fatalf("expected GH=1 NG=1 and no US, got %#v", resp.Countries)
	}
}
