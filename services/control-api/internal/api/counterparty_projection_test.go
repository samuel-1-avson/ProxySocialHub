package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// User.AfterFind refills Email and TaxID from the vault even for projected
// preloads, so projections alone cannot keep them server-side. These tests pin
// the scrub that runs after every counterparty/public seller load.

func TestScrubCounterpartyTaxID(t *testing.T) {
	tax := "TAX-KEEP-ME-SERVER-SIDE"
	name := "Counter Party"
	u := &models.User{Email: "party@test.com", TaxID: &tax, DisplayName: &name}
	scrubCounterpartyTaxID(u)
	if u.TaxID != nil {
		t.Fatal("counterparty tax_id must be scrubbed")
	}
	if u.Email != "party@test.com" {
		t.Fatal("counterparty keeps its contact email")
	}
	if u.DisplayName == nil || *u.DisplayName != name {
		t.Fatal("counterparty keeps its display fields")
	}
	scrubCounterpartyTaxID(nil) // must not panic on missing relation
}

func TestScrubPublicSeller(t *testing.T) {
	tax := "TAX-KEEP-ME-SERVER-SIDE"
	name := "Public Seller"
	u := &models.User{Email: "seller@test.com", TaxID: &tax, DisplayName: &name}
	scrubPublicSeller(u)
	if u.TaxID != nil {
		t.Fatal("public seller tax_id must be scrubbed")
	}
	if u.Email != "" {
		t.Fatal("public seller email must be scrubbed")
	}
	if u.DisplayName == nil || *u.DisplayName != name {
		t.Fatal("public seller keeps its display fields")
	}
	scrubPublicSeller(nil) // must not panic on missing relation
}

func sellerJSON(t *testing.T, body []byte, key string) map[string]interface{} {
	t.Helper()
	var resp map[string]interface{}
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	items, ok := resp[key].([]interface{})
	if !ok || len(items) == 0 {
		t.Fatalf("expected %q items, got: %s", key, string(body))
	}
	first, ok := items[0].(map[string]interface{})
	if !ok {
		t.Fatalf("expected object items, got: %s", string(body))
	}
	return first
}

func TestTrendingSellerProjection(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings")

	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("trend_seller"), "provider")
	tax := "TAX-TRENDING-1"
	name := "Trending Seller"
	seller.TaxID = &tax
	seller.DisplayName = &name
	if err := db.DB.Save(seller).Error; err != nil {
		t.Fatalf("set seller fields: %v", err)
	}
	testutil.CreateTestListing(t, seller.ID)

	r := setupTestRouter()
	r.GET("/trending", getTrendingListings)
	req := httptest.NewRequest("GET", "/trending?limit=5", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	listing := sellerJSON(t, w.Body.Bytes(), "listings")
	embedded, ok := listing["seller"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected embedded seller, got: %v", listing["seller"])
	}
	if _, present := embedded["tax_id"]; present {
		t.Fatal("public seller must not expose tax_id")
	}
	if email, _ := embedded["email"].(string); email != "" {
		t.Fatalf("public seller must not expose email, got %q", email)
	}
	if embedded["display_name"] != name {
		t.Fatalf("public seller keeps display_name, got %v", embedded["display_name"])
	}
}

func TestSalesBuyerProjection(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "orders", "proxy_listings")

	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("sales_buyer"), "buyer")
	tax := "TAX-SALES-1"
	buyer.TaxID = &tax
	if err := db.DB.Save(buyer).Error; err != nil {
		t.Fatalf("set buyer tax: %v", err)
	}
	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("sales_seller"), "provider")
	listing := testutil.CreateTestListing(t, seller.ID)
	if err := db.DB.Create(&models.Order{BuyerID: buyer.ID, SellerID: seller.ID, ListingID: listing.ID, TotalPrice: 5}).Error; err != nil {
		t.Fatalf("create order: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", seller.ID)
	})
	r.GET("/sales", getMySales)
	req := httptest.NewRequest("GET", "/sales", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	sale := sellerJSON(t, w.Body.Bytes(), "sales")
	embedded, ok := sale["buyer"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected embedded buyer, got: %v", sale["buyer"])
	}
	if _, present := embedded["tax_id"]; present {
		t.Fatal("sales buyer must not expose tax_id")
	}
	for _, key := range []string{"email", "wallet_address", "tax_id", "kyc_status"} {
		if _, present := embedded[key]; present {
			t.Fatalf("sales buyer exposes %s", key)
		}
	}
}
