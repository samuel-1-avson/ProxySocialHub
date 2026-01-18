package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
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
	req1 := httptest.NewRequest("GET", "/listings?proxy_type=residential", nil)
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
	req2 := httptest.NewRequest("GET", "/listings?max_price=2.0", nil)
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
