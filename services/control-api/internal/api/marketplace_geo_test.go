package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestMarketplaceGeoRoutesRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/v1")
	RegisterMarketplaceGeoRoutes(v1)
	RegisterListingRoutes(v1)

	var hasListingsGeo, hasMarketplaceGeo, hasMarketplaceMap bool
	for _, route := range r.Routes() {
		switch route.Method + " " + route.Path {
		case http.MethodGet + " /v1/listings/geo":
			hasListingsGeo = true
		case http.MethodGet + " /v1/marketplace/geo":
			hasMarketplaceGeo = true
		case http.MethodGet + " /v1/marketplace/map":
			hasMarketplaceMap = true
		}
	}
	if !hasListingsGeo {
		t.Fatal("missing GET /v1/listings/geo route")
	}
	if !hasMarketplaceGeo {
		t.Fatal("missing GET /v1/marketplace/geo route")
	}
	if !hasMarketplaceMap {
		t.Fatal("missing GET /v1/marketplace/map route")
	}
}

func TestGetListingRejectsGeoSlug(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: "geo"}}
	getListing(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "Invalid listing ID") {
		t.Fatalf("geo slug should not return invalid UUID error: %s", w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "marketplace/geo") {
		t.Fatalf("expected geo endpoint hint, got %s", w.Body.String())
	}
}

func TestParseBBox(t *testing.T) {
	w, s, e, n, ok := parseBBox("-10,20,30,50")
	if !ok || w != -10 || s != 20 || e != 30 || n != 50 {
		t.Fatalf("expected valid bbox, got ok=%v w=%v s=%v e=%v n=%v", ok, w, s, e, n)
	}
	_, _, _, _, ok = parseBBox("bad")
	if ok {
		t.Fatal("expected invalid bbox")
	}
}

func TestGetMarketplaceMap_DefaultPurchasableListingPoints(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_market_map"), "provider")
	active := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "US Active Listing",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		Country:              "US",
		PricePerGB:           3,
		AvailableBandwidthGB: 50,
		Status:               models.ListingStatusActive,
		UptimePercent:        99,
	}
	paused := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "Paused Listing",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		Country:              "US",
		PricePerGB:           2,
		AvailableBandwidthGB: 50,
		Status:               models.ListingStatusPaused,
	}
	soldOut := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "Sold Out Listing",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		Country:              "US",
		PricePerGB:           1,
		AvailableBandwidthGB: 0,
		Status:               models.ListingStatusSoldOut,
	}
	for _, listing := range []models.ProxyListing{active, paused, soldOut} {
		if err := db.DB.Create(&listing).Error; err != nil {
			t.Fatalf("failed to create listing fixture: %v", err)
		}
	}

	r := setupTestRouter()
	r.GET("/marketplace/map", getMarketplaceMap)

	req := httptest.NewRequest(http.MethodGet, "/marketplace/map?country=US&proxy_type=residential&min_price=2&max_price=4&min_uptime=90", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp MarketplaceMapResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Total != 1 || resp.ListingCount != 1 || resp.NodeCount != 0 {
		t.Fatalf("expected one listing point, got total=%d listing=%d node=%d", resp.Total, resp.ListingCount, resp.NodeCount)
	}
	point := resp.Points[0]
	if point.Kind != "listing" || !point.Purchasable || point.Status != string(models.ListingStatusActive) {
		t.Fatalf("expected active purchasable listing point, got %#v", point)
	}
	if point.ListingID == "" || point.ID != "listing:"+point.ListingID {
		t.Fatalf("expected stable listing point ids, got %#v", point)
	}
	if point.GeoSource != "country_centroid" {
		t.Fatalf("expected country centroid geo source, got %q", point.GeoSource)
	}
}

func TestGetMarketplaceMap_BBoxFiltersResolvedPoints(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_market_bbox"), "provider")
	listing := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "US BBox Listing",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		Country:              "US",
		PricePerGB:           3,
		AvailableBandwidthGB: 50,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("failed to create listing fixture: %v", err)
	}

	r := setupTestRouter()
	r.GET("/marketplace/map", getMarketplaceMap)

	req := httptest.NewRequest(http.MethodGet, "/marketplace/map?bbox=-130,20,-60,60", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var inResp MarketplaceMapResponse
	if err := json.Unmarshal(w.Body.Bytes(), &inResp); err != nil {
		t.Fatalf("failed to decode in-bounds response: %v", err)
	}
	if !inResp.BBoxApplied || inResp.Total != 1 {
		t.Fatalf("expected bbox-applied one-point response, got %#v", inResp)
	}

	req = httptest.NewRequest(http.MethodGet, "/marketplace/map?bbox=0,35,40,60", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var outResp MarketplaceMapResponse
	if err := json.Unmarshal(w.Body.Bytes(), &outResp); err != nil {
		t.Fatalf("failed to decode out-of-bounds response: %v", err)
	}
	if !outResp.BBoxApplied || outResp.Total != 0 {
		t.Fatalf("expected bbox-applied empty response, got %#v", outResp)
	}
}

func TestGetMarketplaceMap_NeverReturnsDeletedListings(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_market_deleted"), "provider")
	deleted := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "Deleted Listing",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		Country:              "US",
		PricePerGB:           3,
		AvailableBandwidthGB: 50,
		Status:               models.ListingStatusDeleted,
	}
	paused := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "Paused Listing",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		Country:              "US",
		PricePerGB:           2,
		AvailableBandwidthGB: 50,
		Status:               models.ListingStatusPaused,
	}
	for _, listing := range []models.ProxyListing{deleted, paused} {
		if err := db.DB.Create(&listing).Error; err != nil {
			t.Fatalf("failed to create listing fixture: %v", err)
		}
	}

	r := setupTestRouter()
	r.GET("/marketplace/map", getMarketplaceMap)

	req := httptest.NewRequest(http.MethodGet, "/marketplace/map?purchasable_only=false", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp MarketplaceMapResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Total != 1 || resp.Points[0].Title != paused.Title || resp.Points[0].Purchasable {
		t.Fatalf("expected only paused non-purchasable point, got %#v", resp.Points)
	}
}

func TestGetMarketplaceMap_IncludeNodes(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings", "explorer_nodes")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_market_nodes"), "provider")
	listing := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "US Listing With Nodes",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		Country:              "US",
		PricePerGB:           3,
		AvailableBandwidthGB: 50,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("failed to create listing fixture: %v", err)
	}
	nodes := []models.ExplorerNode{
		{
			NodeID:         "node-active-us",
			Name:           "Active US Node",
			Latitude:       40.7128,
			Longitude:      -74.0060,
			IsActive:       true,
			IsValidator:    true,
			UptimePercent:  98,
			ActiveSessions: 4,
			Country:        "US",
			Region:         "us-east",
			City:           "New York",
			ISP:            "ExampleNet",
		},
		{
			NodeID:        "node-offline-us",
			Name:          "Offline US Node",
			Latitude:      37.7749,
			Longitude:     -122.4194,
			IsActive:      false,
			UptimePercent: 40,
			Country:       "US",
			Region:        "us-west",
			City:          "San Francisco",
		},
	}
	for _, node := range nodes {
		if err := db.DB.Create(&node).Error; err != nil {
			t.Fatalf("failed to create node fixture: %v", err)
		}
	}

	r := setupTestRouter()
	r.GET("/marketplace/map", getMarketplaceMap)

	req := httptest.NewRequest(http.MethodGet, "/marketplace/map?include_nodes=true&country=US", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp MarketplaceMapResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.ListingCount != 1 || resp.NodeCount != 2 || resp.Total != 3 {
		t.Fatalf("expected one listing and two node points, got listing=%d node=%d total=%d", resp.ListingCount, resp.NodeCount, resp.Total)
	}

	var activeNode *MarketplaceMapPoint
	for i := range resp.Points {
		if resp.Points[i].Kind == "node" && resp.Points[i].NodeID == "node-active-us" {
			activeNode = &resp.Points[i]
			break
		}
	}
	if activeNode == nil {
		t.Fatal("expected active node point")
	}
	if activeNode.Purchasable || activeNode.Status != "active" || !activeNode.IsValidator || activeNode.ActiveSessions != 4 {
		t.Fatalf("unexpected active node payload: %#v", activeNode)
	}
	if activeNode.GeoSource != "explorer" {
		t.Fatalf("expected explorer geo source, got %q", activeNode.GeoSource)
	}
}

func TestGetMarketplaceMap_ActiveNodesOnly(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings", "explorer_nodes")

	nodes := []models.ExplorerNode{
		{
			NodeID:        "node-active-only",
			Latitude:      40,
			Longitude:     -74,
			IsActive:      true,
			UptimePercent: 99,
			Country:       "US",
			Region:        "us-east",
		},
		{
			NodeID:        "node-offline-filtered",
			Latitude:      41,
			Longitude:     -75,
			IsActive:      false,
			UptimePercent: 50,
			Country:       "US",
			Region:        "us-east",
		},
	}
	for _, node := range nodes {
		if err := db.DB.Create(&node).Error; err != nil {
			t.Fatalf("failed to create node fixture: %v", err)
		}
	}

	r := setupTestRouter()
	r.GET("/marketplace/map", getMarketplaceMap)

	req := httptest.NewRequest(http.MethodGet, "/marketplace/map?include_nodes=true&active_nodes_only=true", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp MarketplaceMapResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.NodeCount != 1 {
		t.Fatalf("expected only one active node, got node_count=%d points=%#v", resp.NodeCount, resp.Points)
	}
	if resp.Points[0].Kind != "node" || resp.Points[0].NodeID != "node-active-only" {
		t.Fatalf("expected active node point, got %#v", resp.Points)
	}
}
