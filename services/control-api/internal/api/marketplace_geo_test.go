package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
	"gorm.io/datatypes"
)

func TestMarketplaceGeoRoutesRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/v1")
	RegisterMarketplaceGeoRoutes(v1)
	RegisterListingRoutes(v1)

	var hasListingsGeo, hasMarketplaceGeo, hasMarketplaceMap, hasMapPoints bool
	for _, route := range r.Routes() {
		switch route.Method + " " + route.Path {
		case http.MethodGet + " /v1/listings/geo":
			hasListingsGeo = true
		case http.MethodGet + " /v1/marketplace/geo":
			hasMarketplaceGeo = true
		case http.MethodGet + " /v1/marketplace/map":
			hasMarketplaceMap = true
		case http.MethodGet + " /v1/map/points":
			hasMapPoints = true
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
	if !hasMapPoints {
		t.Fatal("missing GET /v1/map/points route")
	}
}

func TestDeprecatedMarketplaceGeoHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/geo", deprecatedMarketplaceGeoHeaders(), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/geo", nil)
	r.ServeHTTP(w, req)

	if w.Header().Get("Deprecation") != "true" {
		t.Fatal("expected Deprecation header")
	}
	if !strings.Contains(w.Header().Get("Link"), "/v1/marketplace/map") {
		t.Fatalf("expected successor Link header, got %q", w.Header().Get("Link"))
	}
	if w.Header().Get("Sunset") == "" {
		t.Fatal("expected Sunset header")
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

func TestGetMarketplaceMap_UsesProviderGeoWhenListingGeoBlank(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings", "provider_nodes", "explorer_nodes")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_market_provider_geo"), "provider")
	nodeID := uuid.New()
	node := models.ProviderNode{
		ID:      nodeID,
		UserID:  provider.ID,
		Name:    "Accra Provider Node",
		Country: "GH",
		City:    "Accra",
		ISP:     "MTN Ghana",
		Status:  models.NodeOnline,
	}
	mustCreateProviderNode(t, node)
	listing := models.ProxyListing{
		SellerID:             provider.ID,
		ProviderNodeID:       &nodeID,
		Title:                "Provider Geo Listing",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		PricePerGB:           3,
		AvailableBandwidthGB: 50,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("failed to create listing fixture: %v", err)
	}

	r := setupTestRouter()
	r.GET("/marketplace/map", getMarketplaceMap)

	req := httptest.NewRequest(http.MethodGet, "/marketplace/map?country=GH", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp MarketplaceMapResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Total != 1 {
		t.Fatalf("expected provider-geo listing under GH filter, got total=%d points=%#v", resp.Total, resp.Points)
	}
	point := resp.Points[0]
	if point.Country != "GH" || point.City != "Accra" {
		t.Fatalf("expected provider geo on map point, got country=%q city=%q", point.Country, point.City)
	}
	if point.NetworkClass != "residential" {
		t.Fatalf("expected residential network class, got %q", point.NetworkClass)
	}
	if point.GeoSource != "region_hub" {
		t.Fatalf("expected region_hub geo source, got %q", point.GeoSource)
	}
}

// Regression: a stale "US" listing country must not outrank the physical
// node's country — it once pinned a Ghana (Cape Coast) node to Boston.
func TestGetMarketplaceMap_NodeCountryOutranksStaleListingCountry(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings", "provider_nodes", "explorer_nodes")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_stale_country"), "provider")
	nodeID := uuid.New()
	node := models.ProviderNode{
		ID:      nodeID,
		UserID:  provider.ID,
		Name:    "Cape Coast Provider Node",
		Country: "GH",
		City:    "Cape Coast",
		ISP:     "MTN Ghana",
		Status:  models.NodeOnline,
	}
	mustCreateProviderNode(t, node)
	listing := models.ProxyListing{
		SellerID:             provider.ID,
		ProviderNodeID:       &nodeID,
		Title:                "Stale Country Listing",
		Country:              "US",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		PricePerGB:           1,
		AvailableBandwidthGB: 50,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("failed to create listing fixture: %v", err)
	}

	r := setupTestRouter()
	r.GET("/marketplace/map", getMarketplaceMap)

	req := httptest.NewRequest(http.MethodGet, "/marketplace/map", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp MarketplaceMapResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Total != 1 {
		t.Fatalf("expected 1 point, got total=%d points=%#v", resp.Total, resp.Points)
	}
	point := resp.Points[0]
	if point.Country != "GH" || point.City != "Cape Coast" {
		t.Fatalf("expected node geo GH/Cape Coast, got country=%q city=%q", point.Country, point.City)
	}
	if point.Latitude != 5.1053 || point.Longitude != -1.2466 {
		t.Fatalf("expected Cape Coast hub coords, got lat=%v lon=%v", point.Latitude, point.Longitude)
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

func TestGetMarketplaceMap_ExcludesSoftDeletedProviderNodeFootprints(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings", "provider_nodes", "explorer_nodes")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_deleted_map"), "provider")
	liveID := uuid.New()
	deletedID := uuid.New()

	live := models.ProviderNode{
		ID:      liveID,
		UserID:  provider.ID,
		Name:    "Live Accra",
		Country: "GH",
		City:    "Accra",
		Status:  models.NodeOnline,
	}
	deleted := models.ProviderNode{
		ID:      deletedID,
		UserID:  provider.ID,
		Name:    "Deleted Accra",
		Country: "GH",
		City:    "Accra",
		Status:  models.NodeOffline,
	}
	mustCreateProviderNode(t, live)
	mustCreateProviderNode(t, deleted)
	if err := db.DB.Delete(&deleted).Error; err != nil {
		t.Fatalf("soft-delete provider node: %v", err)
	}

	nodes := []models.ExplorerNode{
		{
			NodeID:        liveID.String(),
			Name:          "Live footprint",
			Latitude:      5.6037,
			Longitude:     -0.1870,
			IsActive:      true,
			UptimePercent: 99,
			Country:       "GH",
			City:          "Accra",
		},
		{
			NodeID:        deletedID.String(),
			Name:          "Ghost footprint",
			Latitude:      5.61,
			Longitude:     -0.19,
			IsActive:      false,
			IsValidator:   true,
			UptimePercent: 100,
			Country:       "GH",
			City:          "Accra",
		},
	}
	for _, node := range nodes {
		if err := db.DB.Create(&node).Error; err != nil {
			t.Fatalf("create explorer node: %v", err)
		}
	}

	r := setupTestRouter()
	r.GET("/marketplace/map", getMarketplaceMap)

	req := httptest.NewRequest(http.MethodGet, "/marketplace/map?include_nodes=true", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp MarketplaceMapResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.NodeCount != 1 {
		t.Fatalf("expected only live provider footprint, got node_count=%d points=%#v", resp.NodeCount, resp.Points)
	}
	wantOpaque := mapOpaqueID("node", liveID.String())
	if resp.Points[0].Kind != "node" || resp.Points[0].NodeID != wantOpaque {
		t.Fatalf("expected live opaque node point %q, got %#v", wantOpaque, resp.Points[0])
	}
}

func TestGetMarketplaceMap_IncludeNodes(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings", "provider_nodes", "explorer_nodes")

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
	activeID := uuid.New()
	offlineID := uuid.New()
	now := time.Now().UTC()
	providerNodes := []models.ProviderNode{
		{
			ID:         activeID,
			UserID:     provider.ID,
			Name:       "Active US Node",
			Country:    "US",
			City:       "New York",
			Status:     models.NodeOnline,
			LastSeenAt: &now,
		},
		{
			ID:         offlineID,
			UserID:     provider.ID,
			Name:       "Offline US Node",
			Country:    "US",
			City:       "San Francisco",
			Status:     models.NodeOffline,
			LastSeenAt: &now,
		},
	}
	for _, pn := range providerNodes {
		mustCreateProviderNode(t, pn)
	}
	nodes := []models.ExplorerNode{
		{
			NodeID:         activeID.String(),
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
			NodeID:        offlineID.String(),
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
		mustCreateExplorerNode(t, node)
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
	if resp.ListingCount != 1 || resp.NodeCount != 1 || resp.Total != 2 {
		t.Fatalf("expected one listing and one live node (offline dead filtered), got listing=%d node=%d total=%d", resp.ListingCount, resp.NodeCount, resp.Total)
	}

	var activeNode *MarketplaceMapPoint
	wantActiveOpaque := mapOpaqueID("node", activeID.String())
	for i := range resp.Points {
		if resp.Points[i].Kind == "node" && resp.Points[i].NodeID == wantActiveOpaque {
			activeNode = &resp.Points[i]
			break
		}
	}
	if activeNode == nil {
		t.Fatal("expected active node point")
	}
	if activeNode.Purchasable || activeNode.Status != "active" || activeNode.ActiveSessions != 4 {
		t.Fatalf("unexpected active node payload: %#v", activeNode)
	}
	if activeNode.TrustBadge == "" || activeNode.TrustLabel == "" {
		t.Fatalf("expected trust badge on node point, got %#v", activeNode)
	}
	if activeNode.Title == "Active US Node" || strings.Contains(activeNode.Title, "ExampleNet") {
		t.Fatalf("expected privacy title, got %q", activeNode.Title)
	}
	if activeNode.GeoSource != "region_hub" {
		t.Fatalf("expected region_hub geo source for NYC hub match, got %q", activeNode.GeoSource)
	}
	if activeNode.Geo == nil || activeNode.Geo.Source != "region_hub" {
		t.Fatalf("expected geo metadata on node point, got %#v", activeNode.Geo)
	}
	if activeNode.Region != "us-east" {
		t.Fatalf("expected region us-east on node point, got %q", activeNode.Region)
	}
}

func TestGetMarketplaceMap_ActiveNodesOnly(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings", "provider_nodes", "explorer_nodes")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_active_only"), "provider")
	activeID := uuid.New()
	offlineID := uuid.New()
	now := time.Now().UTC()
	for _, pn := range []models.ProviderNode{
		{ID: activeID, UserID: provider.ID, Name: "Active", Country: "US", Status: models.NodeOnline, LastSeenAt: &now},
		{ID: offlineID, UserID: provider.ID, Name: "Offline", Country: "US", Status: models.NodeOffline, LastSeenAt: &now},
	} {
		mustCreateProviderNode(t, pn)
	}
	nodes := []models.ExplorerNode{
		{
			NodeID:        activeID.String(),
			Latitude:      40,
			Longitude:     -74,
			IsActive:      true,
			UptimePercent: 99,
			Country:       "US",
			Region:        "us-east",
		},
		{
			NodeID:        offlineID.String(),
			Latitude:      41,
			Longitude:     -75,
			IsActive:      false,
			UptimePercent: 50,
			Country:       "US",
			Region:        "us-east",
		},
	}
	for _, node := range nodes {
		mustCreateExplorerNode(t, node)
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
	wantOpaque := mapOpaqueID("node", activeID.String())
	if resp.Points[0].Kind != "node" || resp.Points[0].NodeID != wantOpaque {
		t.Fatalf("expected active opaque node point %q, got %#v", wantOpaque, resp.Points)
	}
}

func TestGetMarketplaceMap_ValidatorsOnly(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings", "provider_nodes", "explorer_nodes")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_validator_only"), "provider")
	validatorID := uuid.New()
	proxyID := uuid.New()
	now := time.Now().UTC()
	for _, pn := range []models.ProviderNode{
		{ID: validatorID, UserID: provider.ID, Name: "Validator", Country: "US", Status: models.NodeOnline, LastSeenAt: &now},
		{ID: proxyID, UserID: provider.ID, Name: "Proxy", Country: "US", Status: models.NodeOnline, LastSeenAt: &now},
	} {
		mustCreateProviderNode(t, pn)
	}
	nodes := []models.ExplorerNode{
		{
			NodeID:        validatorID.String(),
			Latitude:      40,
			Longitude:     -74,
			IsActive:      true,
			IsValidator:   true,
			UptimePercent: 99,
			Country:       "US",
			Region:        "us-east",
		},
		{
			NodeID:        proxyID.String(),
			Latitude:      41,
			Longitude:     -75,
			IsActive:      true,
			IsValidator:   false,
			UptimePercent: 98,
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

	req := httptest.NewRequest(http.MethodGet, "/marketplace/map?include_nodes=true&validator=true", nil)
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
		t.Fatalf("expected one validator node, got node_count=%d", resp.NodeCount)
	}
	wantOpaque := mapOpaqueID("node", validatorID.String())
	if resp.Points[0].Kind != "node" || resp.Points[0].NodeID != wantOpaque {
		t.Fatalf("expected validator opaque node point %q, got %#v", wantOpaque, resp.Points[0])
	}
	if resp.Points[0].TrustBadge == "" {
		t.Fatalf("expected trust badge on validator node, got %#v", resp.Points[0])
	}
}

func TestGetMarketplaceMap_IncludeCatalog(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "catalog_offers", "catalog_products", "proxy_listings")

	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("map_catalog_seller"), "provider")
	listing := models.ProxyListing{
		SellerID:             seller.ID,
		Title:                "Catalog map listing",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		Country:              "US",
		PricePerGB:           2,
		AvailableBandwidthGB: 10,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatal(err)
	}
	product := models.CatalogProduct{
		ID:       listing.ID,
		SellerID: seller.ID,
		Slug:     "map-catalog-slug",
		Title:    "Map catalog title",
		Status:   models.CatalogProductStatusActive,
		Media:    datatypes.JSON([]byte("[]")),
	}
	if err := db.DB.Create(&product).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.DB.Create(&models.CatalogOffer{
		ProductID: product.ID,
		ListingID: listing.ID,
		IsPrimary: true,
	}).Error; err != nil {
		t.Fatal(err)
	}

	r := setupTestRouter()
	r.GET("/marketplace/map", getMarketplaceMap)

	req := httptest.NewRequest(http.MethodGet, "/marketplace/map?include_catalog=true", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var withCatalog MarketplaceMapResponse
	if err := json.Unmarshal(w.Body.Bytes(), &withCatalog); err != nil {
		t.Fatal(err)
	}
	if len(withCatalog.Points) != 1 || withCatalog.Points[0].CatalogProduct == nil {
		t.Fatalf("expected catalog_product on map point, got %#v", withCatalog.Points)
	}
	if withCatalog.Points[0].CatalogProduct.Slug != "map-catalog-slug" {
		t.Fatalf("slug %q", withCatalog.Points[0].CatalogProduct.Slug)
	}

	req2 := httptest.NewRequest(http.MethodGet, "/marketplace/map", nil)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w2.Code, w2.Body.String())
	}
	var withoutCatalog MarketplaceMapResponse
	if err := json.Unmarshal(w2.Body.Bytes(), &withoutCatalog); err != nil {
		t.Fatal(err)
	}
	if len(withoutCatalog.Points) != 1 || withoutCatalog.Points[0].CatalogProduct != nil {
		t.Fatalf("expected no catalog_product without include_catalog, got %#v", withoutCatalog.Points[0])
	}
}

func TestMarketplaceGeoSource_RegionalHubNotGPS(t *testing.T) {
	row := marketplaceGeoRow{City: "Accra", Country: "GH", SLASource: "gateway"}
	if got := marketplaceGeoSource(row, "gps"); got != "region_hub" {
		t.Fatalf("expected region_hub, got %q", got)
	}
	row = marketplaceGeoRow{Country: "GH", SLASource: "explorer"}
	if got := marketplaceGeoSource(row, "gps"); got != "country_centroid" {
		t.Fatalf("expected country_centroid, got %q", got)
	}
}

func TestGetMarketplaceMap_PrivacyHardening(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings", "provider_nodes", "explorer_nodes")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_map_privacy"), "provider")
	nodeID := uuid.New()
	node := models.ProviderNode{
		ID:      nodeID,
		UserID:  provider.ID,
		Name:    "Sensitive Node Name",
		Country: "US",
		City:    "New York",
		ISP:     "SecretCarrier ISP",
		Status:  models.NodeOnline,
	}
	mustCreateProviderNode(t, node)
	listing := models.ProxyListing{
		SellerID:             provider.ID,
		ProviderNodeID:       &nodeID,
		Title:                "Public Listing Title",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		Country:              "US",
		ISP:                  "SecretCarrier ISP",
		PricePerGB:           2.5,
		AvailableBandwidthGB: 20,
		Status:               models.ListingStatusActive,
		QualityScore:         92,
		SuccessRate:          97,
		UptimePercent:        99.2,
		ListingOfferVerified: true,
		ListingOfferSigner:   "SensitiveSignerPubkey11111111111111111111",
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("create listing: %v", err)
	}
	if err := db.DB.Create(&models.ExplorerNode{
		NodeID:         nodeID.String(),
		Name:           "Sensitive Explorer Name",
		Latitude:       40.7128,
		Longitude:      -74.0060,
		IsActive:       true,
		IsValidator:    true,
		UptimePercent:  99.2,
		ActiveSessions: 3,
		Country:        "US",
		City:           "New York",
		ISP:            "SecretCarrier ISP",
	}).Error; err != nil {
		t.Fatalf("create explorer node: %v", err)
	}

	r := setupTestRouter()
	r.GET("/marketplace/map", getMarketplaceMap)

	req := httptest.NewRequest(http.MethodGet, "/marketplace/map?include_nodes=true&include_proofs=true&country=US", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	raw := w.Body.String()
	for _, forbidden := range []string{
		`"seller_id"`,
		`"isp"`,
		"SecretCarrier",
		"SensitiveSigner",
		"Sensitive Node",
		"Sensitive Explorer",
		provider.ID.String(),
		nodeID.String(),
		`"listing_offer_signer"`,
		`"heartbeat_signer"`,
	} {
		if strings.Contains(raw, forbidden) {
			t.Fatalf("public map leaked %q in payload: %s", forbidden, raw)
		}
	}

	var resp MarketplaceMapResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.ListingCount < 1 || resp.NodeCount < 1 {
		t.Fatalf("expected listing+node points, got %#v", resp)
	}

	var listingPt, nodePt *MarketplaceMapPoint
	for i := range resp.Points {
		switch resp.Points[i].Kind {
		case "listing":
			listingPt = &resp.Points[i]
		case "node":
			nodePt = &resp.Points[i]
		}
	}
	if listingPt == nil || nodePt == nil {
		t.Fatalf("missing listing/node points: %#v", resp.Points)
	}
	if listingPt.TrustBadge == "" || listingPt.QualityScore < 90 {
		t.Fatalf("expected quality trust on listing, got %#v", listingPt)
	}
	if listingPt.NetworkClass != "residential" {
		t.Fatalf("expected residential class, got %q", listingPt.NetworkClass)
	}
	wantOpaque := mapOpaqueID("node", nodeID.String())
	if nodePt.NodeID != wantOpaque || listingPt.NodeID != wantOpaque {
		t.Fatalf("expected opaque node id %q, listing=%q node=%q", wantOpaque, listingPt.NodeID, nodePt.NodeID)
	}
	if nodePt.ID != "node:"+wantOpaque {
		t.Fatalf("expected opaque point id, got %q", nodePt.ID)
	}
}

func mustCreateProviderNode(t *testing.T, node models.ProviderNode) {
	t.Helper()
	if node.IPAddress == "" {
		node.IPAddress = "10.0.0.5"
	}
	if err := db.DB.Create(&node).Error; err != nil {
		t.Fatalf("failed to create provider node: %v", err)
	}
}

func mustCreateExplorerNode(t *testing.T, node models.ExplorerNode) {
	t.Helper()
	active := node.IsActive
	if err := db.DB.Create(&node).Error; err != nil {
		t.Fatalf("failed to create explorer node: %v", err)
	}
	if !active {
		if err := db.DB.Model(&models.ExplorerNode{}).Where("node_id = ?", node.NodeID).Update("is_active", false).Error; err != nil {
			t.Fatalf("failed to persist explorer is_active=false: %v", err)
		}
	}
}

func TestMarketplaceOccupancySQLCastsListingID(t *testing.T) {
	src, err := os.ReadFile("marketplace_geo.go")
	if err != nil {
		t.Fatal(err)
	}
	body := string(src)
	if strings.Contains(body, "s.listing_id = pl.id\n") || strings.Contains(body, "s.listing_id = pl.id\r") {
		t.Fatal("uncast listing_id comparison would 500 on live (uuid = text)")
	}
	if strings.Contains(body, "en.provider_user_id = pl.seller_id::text") {
		t.Fatal("provider_user_id is uuid; comparing it to seller_id::text 500s the map")
	}
	if !strings.Contains(body, "en.provider_user_id::text = pl.seller_id::text") {
		t.Fatal("explorer_nodes join must cast provider_user_id to text")
	}
}
