package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/cache"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestCreateListing_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings")

	// 1. Create Provider
	providerEmail := testutil.UniqueEmail("provider_list")
	provider := testutil.CreateTestUser(t, providerEmail, "provider")

	// 2. Setup Router
	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", provider.ID.String())
	})
	r.POST("/listings", createListing)

	// 3. Request
	reqBody := models.CreateListingRequest{
		Title:                "High Speed Residential Proxy",
		Description:          "Best for scraping",
		ProxyType:            "residential",
		Protocol:             "http",
		PricePerGB:           5.0,
		MinPurchaseGB:        1,
		AvailableBandwidthGB: 100,
		MaxConcurrency:       10,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req := httptest.NewRequest("POST", "/listings", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	// 4. Verify
	if w.Code != http.StatusCreated {
		t.Errorf("Expected 201 Created, got %d. Body: %s", w.Code, w.Body.String())
	}

	var resp models.ProxyListing
	json.Unmarshal(w.Body.Bytes(), &resp)

	if resp.Title != reqBody.Title {
		t.Errorf("Expected title %s, got %s", reqBody.Title, resp.Title)
	}
	if resp.ProxyType != reqBody.ProxyType {
		t.Errorf("Expected type %s, got %s", reqBody.ProxyType, resp.ProxyType)
	}
	if resp.Status != models.ListingStatusActive {
		t.Errorf("Expected status active, got %s", resp.Status)
	}
}

func TestCreateListing_ForbiddenForBuyer(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings")

	// 1. Create Buyer
	buyerEmail := testutil.UniqueEmail("buyer_list_fail")
	buyer := testutil.CreateTestUser(t, buyerEmail, "buyer")

	// 2. Setup Router
	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", buyer.ID.String())
	})
	r.POST("/listings", createListing)

	// 3. Request
	reqBody := models.CreateListingRequest{
		Title:      "Fail Listing",
		ProxyType:  "datacenter",
		PricePerGB: 1.0,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req := httptest.NewRequest("POST", "/listings", bytes.NewBuffer(jsonBody))
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	// 4. Verify
	if w.Code != http.StatusForbidden {
		t.Errorf("Expected 403 Forbidden, got %d", w.Code)
	}
}

func TestGetListings_Filters(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "proxy_listings")

	// 1. Create Provider & Listings
	providerEmail := testutil.UniqueEmail("provider_filter")
	provider := testutil.CreateTestUser(t, providerEmail, "provider")

	// Listing 1: Residential, HTTP, $5
	l1 := models.ProxyListing{
		SellerID:   provider.ID,
		Title:      "Resi HTTP",
		ProxyType:  "residential",
		Protocol:   "http",
		PricePerGB: 5.0,
		Status:     models.ListingStatusActive,
	}
	// Listing 2: Datacenter, SOCKS5, $1
	l2 := models.ProxyListing{
		SellerID:   provider.ID,
		Title:      "DC SOCKS",
		ProxyType:  "datacenter",
		Protocol:   "socks5",
		PricePerGB: 1.0,
		Status:     models.ListingStatusActive,
	}
	db.DB.Create(&l1)
	db.DB.Create(&l2)

	// 2. Setup Router
	r := setupTestRouter()
	r.GET("/listings", getListings)

	// 3. Test Filter: Proxy Type
	req1 := httptest.NewRequest("GET", "/listings?proxy_type=residential&seller_id="+provider.ID.String(), nil)
	w1 := httptest.NewRecorder()
	r.ServeHTTP(w1, req1)

	var resp1 ListingsResponse
	json.Unmarshal(w1.Body.Bytes(), &resp1)

	if len(resp1.Listings) != 1 {
		t.Errorf("Expected 1 listing, got %d", len(resp1.Listings))
	} else if resp1.Listings[0].Title != "Resi HTTP" {
		t.Errorf("Expected 'Resi HTTP', got '%s'", resp1.Listings[0].Title)
	}

	// 4. Test Filter: Max Price
	req2 := httptest.NewRequest("GET", "/listings?max_price=2.0&seller_id="+provider.ID.String(), nil)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)

	var resp2 ListingsResponse
	json.Unmarshal(w2.Body.Bytes(), &resp2)

	if len(resp2.Listings) != 1 {
		t.Errorf("Expected 1 listing, got %d", len(resp2.Listings))
	} else if resp2.Listings[0].Title != "DC SOCKS" {
		t.Errorf("Expected 'DC SOCKS', got '%s'", resp2.Listings[0].Title)
	}
}

func TestBuildListingFiltersAndCacheKey(t *testing.T) {
	r := setupTestRouter()
	r.GET("/listings", func(c *gin.Context) {
		filters := buildListingFilters(c)

		expectedStrings := map[string]string{
			"proxy_type":    "residential",
			"protocol":      "http",
			"rotation_type": "sticky",
			"country":       "US",
			"isp":           "ExampleNet",
			"min_price":     "1.25",
			"max_price":     "6.50",
			"min_rating":    "4",
			"seller_id":     "11111111-1111-1111-1111-111111111111",
			"sort_by":       "price_asc",
			"sort_order":    "asc",
		}
		for key, expected := range expectedStrings {
			if filters[key] != expected {
				t.Fatalf("expected %s=%q, got %#v", key, expected, filters[key])
			}
		}
		if filters["page"] != 2 {
			t.Fatalf("expected page=2, got %#v", filters["page"])
		}
		if filters["limit"] != 50 {
			t.Fatalf("expected limit=50, got %#v", filters["limit"])
		}

		keyA := listingCacheKey(filters)
		keyB := listingCacheKey(map[string]interface{}{
			"sort_order":    "asc",
			"sort_by":       "price_asc",
			"seller_id":     "11111111-1111-1111-1111-111111111111",
			"min_rating":    "4",
			"max_price":     "6.50",
			"min_price":     "1.25",
			"isp":           "ExampleNet",
			"country":       "US",
			"rotation_type": "sticky",
			"protocol":      "http",
			"proxy_type":    "residential",
			"limit":         50,
			"page":          2,
		})
		if keyA != keyB {
			t.Fatalf("expected deterministic cache keys, got %q and %q", keyA, keyB)
		}
		if keyA == listingCacheKey(map[string]interface{}{"page": 2, "limit": 50, "proxy_type": "residential"}) {
			t.Fatal("expected cache key to include all active filters")
		}
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest("GET", "/listings?proxy_type=residential&protocol=http&rotation_type=sticky&country=US&isp=ExampleNet&min_price=1.25&max_price=6.50&min_rating=4&seller_id=11111111-1111-1111-1111-111111111111&sort_by=price_asc&sort_order=asc&page=2&limit=50", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetListings_FrontendFiltersSortAndPagination(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "proxy_listings")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_market_filters"), "provider")
	otherProvider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_market_other"), "provider")

	listings := []models.ProxyListing{
		{
			SellerID:             provider.ID,
			Title:                "US Mid",
			ProxyType:            models.ProxyTypeResidential,
			Protocol:             "http",
			RotationType:         "sticky",
			Country:              "US",
			ISP:                  "ExampleNet",
			PricePerGB:           3.00,
			AvailableBandwidthGB: 100,
			QualityScore:         80,
			OrdersCount:          10,
			Status:               models.ListingStatusActive,
		},
		{
			SellerID:             provider.ID,
			Title:                "US Premium",
			ProxyType:            models.ProxyTypeResidential,
			Protocol:             "http",
			RotationType:         "sticky",
			Country:              "US",
			ISP:                  "ExampleNet",
			PricePerGB:           5.00,
			AvailableBandwidthGB: 100,
			QualityScore:         95,
			OrdersCount:          5,
			Status:               models.ListingStatusActive,
		},
		{
			SellerID:             provider.ID,
			Title:                "CA Cheap",
			ProxyType:            models.ProxyTypeResidential,
			Protocol:             "http",
			RotationType:         "sticky",
			Country:              "CA",
			ISP:                  "ExampleNet",
			PricePerGB:           1.00,
			AvailableBandwidthGB: 100,
			QualityScore:         99,
			Status:               models.ListingStatusActive,
		},
		{
			SellerID:             otherProvider.ID,
			Title:                "Other Seller US",
			ProxyType:            models.ProxyTypeResidential,
			Protocol:             "http",
			Country:              "US",
			PricePerGB:           2.00,
			AvailableBandwidthGB: 100,
			QualityScore:         100,
			Status:               models.ListingStatusActive,
		},
	}
	for _, listing := range listings {
		if err := db.DB.Create(&listing).Error; err != nil {
			t.Fatalf("failed to create listing fixture: %v", err)
		}
	}

	r := setupTestRouter()
	r.GET("/listings", getListings)

	req := httptest.NewRequest("GET", "/listings?seller_id="+provider.ID.String()+"&country=US&min_price=2&max_price=6&sort_by=price_asc&page=2&limit=1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var pageResp ListingsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &pageResp); err != nil {
		t.Fatalf("failed to decode listing response: %v", err)
	}
	if pageResp.Total != 2 || pageResp.Page != 2 || pageResp.Limit != 1 {
		t.Fatalf("expected total=2 page=2 limit=1, got total=%d page=%d limit=%d", pageResp.Total, pageResp.Page, pageResp.Limit)
	}
	if len(pageResp.Listings) != 1 || pageResp.Listings[0].Title != "US Premium" {
		t.Fatalf("expected second price_asc page to contain US Premium, got %#v", pageResp.Listings)
	}

	req = httptest.NewRequest("GET", "/listings?seller_id="+provider.ID.String()+"&country=US&sort_by=price_desc&page=1&limit=2", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var descResp ListingsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &descResp); err != nil {
		t.Fatalf("failed to decode price_desc response: %v", err)
	}
	if len(descResp.Listings) != 2 || descResp.Listings[0].Title != "US Premium" || descResp.Listings[1].Title != "US Mid" {
		t.Fatalf("expected price_desc order [US Premium, US Mid], got %#v", descResp.Listings)
	}

	req = httptest.NewRequest("GET", "/listings?seller_id="+provider.ID.String()+"&country=US&sort_by=popular&page=1&limit=2", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var popularResp ListingsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &popularResp); err != nil {
		t.Fatalf("failed to decode popular response: %v", err)
	}
	if len(popularResp.Listings) != 2 || popularResp.Listings[0].Title != "US Premium" {
		t.Fatalf("expected popular sort to prefer higher quality listing, got %#v", popularResp.Listings)
	}
}

func TestListingState_BlocksDeletedFromBrowseAndSave(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "saved_listings", "proxy_listings")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_listing_state"), "provider")
	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("buyer_listing_state"), "buyer")

	deletedListing := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "Deleted Listing",
		ProxyType:            models.ProxyTypeResidential,
		PricePerGB:           2,
		AvailableBandwidthGB: 10,
		Status:               models.ListingStatusDeleted,
	}
	activeListing := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "Active Listing",
		ProxyType:            models.ProxyTypeResidential,
		PricePerGB:           3,
		AvailableBandwidthGB: 10,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&deletedListing).Error; err != nil {
		t.Fatalf("failed to create deleted listing: %v", err)
	}
	if err := db.DB.Create(&activeListing).Error; err != nil {
		t.Fatalf("failed to create active listing: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", buyer.ID.String())
	})
	r.GET("/listings", getListings)
	r.POST("/listings/:id/save", saveListing)

	req := httptest.NewRequest("GET", "/listings?seller_id="+provider.ID.String()+"&sort_by=newest", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp ListingsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode listings: %v", err)
	}
	if resp.Total != 1 || len(resp.Listings) != 1 || resp.Listings[0].Title != "Active Listing" {
		t.Fatalf("expected only active listing in browse response, got total=%d listings=%#v", resp.Total, resp.Listings)
	}

	req = httptest.NewRequest("POST", "/listings/"+deletedListing.ID.String()+"/save", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 saving deleted listing, got %d: %s", w.Code, w.Body.String())
	}
}

func TestListingState_InvalidTransitionFromDeleted(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_listing_deleted"), "provider")
	listing := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "Deleted Listing",
		PricePerGB:           2,
		AvailableBandwidthGB: 10,
		Status:               models.ListingStatusDeleted,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("failed to create listing: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", provider.ID.String())
	})
	r.PATCH("/listings/:id", updateListing)

	newStatus := models.ListingStatusActive
	reqBody := models.UpdateListingRequest{Status: &newStatus}
	jsonBody, _ := json.Marshal(reqBody)
	req := httptest.NewRequest("PATCH", "/listings/"+listing.ID.String(), bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for deleted->active transition, got %d: %s", w.Code, w.Body.String())
	}
}

func TestInvalidateMarketplaceReadModels(t *testing.T) {
	testutil.SetupTestRedis(t)

	ctx := context.Background()
	if err := cache.Client.Set(ctx, "listings:sla:test", "listing", 0).Err(); err != nil {
		t.Fatalf("failed to seed listing cache: %v", err)
	}
	if err := redisClient.Client.Set(ctx, "marketplace:geo:test", "geo", 0).Err(); err != nil {
		t.Fatalf("failed to seed marketplace geo cache: %v", err)
	}
	if err := redisClient.Client.Set(ctx, "discovery:test", "discovery", 0).Err(); err != nil {
		t.Fatalf("failed to seed discovery cache: %v", err)
	}
	if err := redisClient.Client.LPush(ctx, "public:feed", "event").Err(); err != nil {
		t.Fatalf("failed to seed feed cache: %v", err)
	}
	if err := redisClient.Client.Set(ctx, "unrelated:key", "keep", 0).Err(); err != nil {
		t.Fatalf("failed to seed unrelated key: %v", err)
	}

	invalidateMarketplaceReadModels()

	for _, key := range []string{"listings:sla:test", "marketplace:geo:test", "discovery:test", "public:feed"} {
		exists, err := redisClient.Client.Exists(ctx, key).Result()
		if err != nil {
			t.Fatalf("failed to check key %s: %v", key, err)
		}
		if exists != 0 {
			t.Fatalf("expected key %s to be invalidated", key)
		}
	}

	exists, err := redisClient.Client.Exists(ctx, "unrelated:key").Result()
	if err != nil {
		t.Fatalf("failed to check unrelated key: %v", err)
	}
	if exists != 1 {
		t.Fatal("expected unrelated key to remain")
	}
}

func TestUpdateListing_CalculatedUpdates(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings")

	// 1. Setup
	providerEmail := testutil.UniqueEmail("provider_update")
	provider := testutil.CreateTestUser(t, providerEmail, "provider")

	l1 := models.ProxyListing{
		SellerID:   provider.ID,
		Title:      "Original Title",
		PricePerGB: 5.0,
		Status:     models.ListingStatusActive,
	}
	db.DB.Create(&l1)

	// 2. Router
	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", provider.ID.String())
	})
	r.PATCH("/listings/:id", updateListing)

	// 3. Request
	newTitle := "Updated Title"
	newPrice := 6.0
	reqBody := models.UpdateListingRequest{
		Title:      &newTitle,
		PricePerGB: &newPrice,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req := httptest.NewRequest("PATCH", "/listings/"+l1.ID.String(), bytes.NewBuffer(jsonBody))
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	// 4. Verify
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200 OK, got %d", w.Code)
	}

	var updated models.ProxyListing
	db.DB.First(&updated, "id = ?", l1.ID)
	if updated.Title != newTitle {
		t.Errorf("Expected title %s, got %s", newTitle, updated.Title)
	}
	if updated.PricePerGB != newPrice {
		t.Errorf("Expected price %f, got %f", newPrice, updated.PricePerGB)
	}
}
