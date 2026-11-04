package geoip

import (
	"testing"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func createEnrichNode(t *testing.T, city, region string, explorer models.ExplorerNode) models.ProviderNode {
	t.Helper()
	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("geo_loc"), "provider")
	pn := models.ProviderNode{
		UserID:  provider.ID,
		Name:    "geo-loc-node",
		Country: "GH",
		City:    city,
		Region:  region,
		Status:  models.NodeOnline,
	}
	if err := db.DB.Create(&pn).Error; err != nil {
		t.Fatalf("create provider node: %v", err)
	}
	explorer.NodeID = pn.ID.String()
	explorer.Chain = "solana"
	if err := db.DB.Create(&explorer).Error; err != nil {
		t.Fatalf("create explorer node: %v", err)
	}
	return pn
}

func reloadEnrich(t *testing.T, pn models.ProviderNode) (models.ProviderNode, models.ExplorerNode) {
	t.Helper()
	var p models.ProviderNode
	if err := db.DB.Where("id = ?", pn.ID).First(&p).Error; err != nil {
		t.Fatalf("reload provider: %v", err)
	}
	var e models.ExplorerNode
	if err := db.DB.Where("node_id = ?", pn.ID.String()).First(&e).Error; err != nil {
		t.Fatalf("reload explorer: %v", err)
	}
	return p, e
}

// Regression (testnet, 2026-11-04): with IP lookup off, every Ghana node
// without a city ended up saved as "Kumasi" — the hub nearest Ghana's
// centroid — because enrich snapped the stored country-area pin.
func TestEnrichDoesNotInventCityFromCountryAreaPin(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes", "explorer_nodes", "proxy_listings")

	pn := createEnrichNode(t, "", "Unknown", models.ExplorerNode{
		Country: "GH", Region: "Unknown", Latitude: 7.9, Longitude: -1.0, GeoSource: "country_centroid",
	})
	for i := 0; i < 3; i++ { // repeated passes must stay stable
		ForceEnrichExplorerForProviderNode(pn.ID.String())
		EnrichExplorerForProviderNode(pn.ID.String())
	}
	p, e := reloadEnrich(t, pn)
	if p.City != "" || e.City != "" {
		t.Fatalf("invented a city: provider=%q explorer=%q", p.City, e.City)
	}
	if e.GeoSource != "country_centroid" {
		t.Fatalf("geo_source=%q, want country_centroid", e.GeoSource)
	}
	if !geoIsCountryArea(e) {
		t.Fatalf("pin %v,%v is not the Ghana country area", e.Latitude, e.Longitude)
	}
}

// An explorer row that already carries an invented city is cleared to match
// the node, so the map stops showing it.
func TestEnrichClearsExplorerCityTheNodeDoesNotHave(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes", "explorer_nodes", "proxy_listings")

	pn := createEnrichNode(t, "", "Unknown", models.ExplorerNode{
		Country: "GH", City: "Kumasi", Region: "Unknown", Latitude: 6.6885, Longitude: -1.6244, GeoSource: "region_hub",
	})
	ForceEnrichExplorerForProviderNode(pn.ID.String())
	p, e := reloadEnrich(t, pn)
	if p.City != "" || e.City != "" {
		t.Fatalf("got provider city %q, explorer city %q, want both empty", p.City, e.City)
	}
	if !geoIsCountryArea(e) {
		t.Fatalf("pin %v,%v should fall back to the Ghana country area", e.Latitude, e.Longitude)
	}
}

// A city the owner typed that is not on the hub list is kept, not renamed to
// the hub nearest the old pin.
func TestEnrichKeepsDeclaredCityOffTheHubList(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes", "explorer_nodes", "proxy_listings")

	pn := createEnrichNode(t, "Obuasi", "", models.ExplorerNode{
		Country: "GH", City: "Kumasi", Latitude: 6.6885, Longitude: -1.6244, GeoSource: "region_hub",
	})
	ForceEnrichExplorerForProviderNode(pn.ID.String())
	p, e := reloadEnrich(t, pn)
	if p.City != "Obuasi" || e.City != "Obuasi" {
		t.Fatalf("got provider city %q, explorer city %q, want Obuasi", p.City, e.City)
	}
}

// A declared hub city still gets its exact hub pin.
func TestEnrichPinsDeclaredHubCity(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes", "explorer_nodes", "proxy_listings")

	pn := createEnrichNode(t, "Sunyani", "", models.ExplorerNode{
		Country: "GH", City: "Kumasi", Latitude: 6.6885, Longitude: -1.6244, GeoSource: "region_hub",
	})
	ForceEnrichExplorerForProviderNode(pn.ID.String())
	_, e := reloadEnrich(t, pn)
	if e.City != "Sunyani" || e.Latitude != 7.3399 || e.Longitude != -2.3268 || e.GeoSource != "region_hub" {
		t.Fatalf("got %q %v,%v src=%q, want Sunyani hub", e.City, e.Latitude, e.Longitude, e.GeoSource)
	}
}

func geoIsCountryArea(e models.ExplorerNode) bool {
	return e.Latitude > 7.83 && e.Latitude < 7.97 && e.Longitude > -1.05 && e.Longitude < -0.95
}
