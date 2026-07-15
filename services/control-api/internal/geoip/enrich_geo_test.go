package geoip

import (
	"testing"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestEnrichExplorerForProviderNode_PersistsGeoSource(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "provider_nodes", "explorer_nodes", "proxy_listings")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("geo_enrich"), "provider")
	pn := models.ProviderNode{
		UserID:  provider.ID,
		Name:    "geo-enrich-node",
		Country: "GH",
		City:    "Accra",
		Status:  models.NodeOnline,
	}
	if err := db.DB.Create(&pn).Error; err != nil {
		t.Fatalf("create provider node: %v", err)
	}
	explorer := models.ExplorerNode{
		NodeID:  pn.ID.String(),
		Chain:   "solana",
		Country: "GH",
		City:    "Accra",
		ISP:     "MTN Ghana",
		Region:  "west-africa",
	}
	if err := db.DB.Create(&explorer).Error; err != nil {
		t.Fatalf("create explorer node: %v", err)
	}
	listing := models.ProxyListing{
		SellerID:             provider.ID,
		ProviderNodeID:       &pn.ID,
		Title:                "Geo enrich listing",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		PricePerGB:           1,
		AvailableBandwidthGB: 10,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("create listing: %v", err)
	}

	if !EnrichExplorerForProviderNode(pn.ID.String()) {
		t.Fatal("expected enrich to update explorer node")
	}

	var updated models.ExplorerNode
	if err := db.DB.Where("node_id = ?", pn.ID.String()).First(&updated).Error; err != nil {
		t.Fatalf("reload explorer: %v", err)
	}
	if updated.GeoSource != "region_hub" {
		t.Fatalf("expected region_hub geo_source, got %q", updated.GeoSource)
	}
	if updated.GeoResolvedAt == nil {
		t.Fatal("expected geo_resolved_at to be set")
	}
	if updated.Latitude == 0 && updated.Longitude == 0 {
		t.Fatal("expected resolved coordinates")
	}

	var updatedProvider models.ProviderNode
	if err := db.DB.Where("id = ?", pn.ID).First(&updatedProvider).Error; err != nil {
		t.Fatalf("reload provider node: %v", err)
	}
	if updatedProvider.ISP != "MTN Ghana" {
		t.Fatalf("expected provider ISP backfill, got %q", updatedProvider.ISP)
	}

	var updatedListing models.ProxyListing
	if err := db.DB.Where("id = ?", listing.ID).First(&updatedListing).Error; err != nil {
		t.Fatalf("reload listing: %v", err)
	}
	if updatedListing.Country != "GH" || updatedListing.ISP != "MTN Ghana" {
		t.Fatalf("expected listing geo backfill, got country=%q isp=%q", updatedListing.Country, updatedListing.ISP)
	}
}
