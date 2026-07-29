package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
	"gorm.io/datatypes"
)

func TestCatalogProductCRUDAndOfferLink(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "catalog_offers", "catalog_products", "proxy_listings")

	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("catalog_seller"), "provider")
	other := testutil.CreateTestUser(t, testutil.UniqueEmail("catalog_other"), "provider")

	listing := models.ProxyListing{
		SellerID:             seller.ID,
		Title:                "Supply listing",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		PricePerGB:           3.5,
		AvailableBandwidthGB: 100,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatal(err)
	}

	otherListing := models.ProxyListing{
		SellerID:             other.ID,
		Title:                "Other supply",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		PricePerGB:           2.0,
		AvailableBandwidthGB: 50,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&otherListing).Error; err != nil {
		t.Fatal(err)
	}

	r := setupTestRouter()
	v1 := r.Group("/")
	v1.Use(authAs(seller.ID))
	RegisterCatalogRoutes(v1)

	// Create product
	createBody, _ := json.Marshal(map[string]interface{}{
		"title":       "Premium US Pool",
		"description": "Merchandised offer",
		"status":      "active",
	})
	req := httptest.NewRequest(http.MethodPost, "/catalog/products", bytes.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create product: %d %s", rec.Code, rec.Body.String())
	}

	var created struct {
		Product models.CatalogProduct `json:"product"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	productID := created.Product.ID

	// Link own listing
	linkBody, _ := json.Marshal(map[string]interface{}{
		"listing_id": listing.ID,
		"is_primary": true,
	})
	req = httptest.NewRequest(http.MethodPost, "/catalog/products/"+productID.String()+"/offers", bytes.NewReader(linkBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("link offer: %d %s", rec.Code, rec.Body.String())
	}

	// Cannot link another seller's listing
	linkBody, _ = json.Marshal(map[string]interface{}{"listing_id": otherListing.ID})
	req = httptest.NewRequest(http.MethodPost, "/catalog/products/"+productID.String()+"/offers", bytes.NewReader(linkBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 linking foreign listing, got %d", rec.Code)
	}

	// Public slug read
	req = httptest.NewRequest(
		http.MethodGet,
		"/catalog/sellers/"+seller.ID.String()+"/products/"+created.Product.Slug,
		nil,
	)
	rec = httptest.NewRecorder()
	r2 := setupTestRouter()
	RegisterCatalogRoutes(r2.Group("/"))
	r2.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("get by slug: %d %s", rec.Code, rec.Body.String())
	}

	// Draft hidden from public
	draft := models.CatalogProduct{
		ID:       uuid.New(),
		SellerID: seller.ID,
		Slug:     "secret-draft-" + uuid.New().String()[:8],
		Title:    "Hidden",
		Status:   models.CatalogProductStatusDraft,
		Media:    datatypes.JSON([]byte("[]")),
	}
	if err := db.DB.Create(&draft).Error; err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodGet, "/catalog/products/"+draft.ID.String(), nil)
	rec = httptest.NewRecorder()
	r2.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("draft public get want 404, got %d", rec.Code)
	}

	// Owner sees draft
	req = httptest.NewRequest(http.MethodGet, "/catalog/products/"+draft.ID.String(), nil)
	rec = httptest.NewRecorder()
	r3 := setupTestRouter()
	v3 := r3.Group("/")
	v3.Use(authAs(seller.ID))
	RegisterCatalogRoutes(v3)
	r3.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("owner draft get: %d %s", rec.Code, rec.Body.String())
	}

	// Unlink offer
	var linked models.CatalogOffer
	if err := db.DB.Where("product_id = ? AND listing_id = ?", productID, listing.ID).First(&linked).Error; err != nil {
		t.Fatalf("load linked offer: %v", err)
	}
	req = httptest.NewRequest(
		http.MethodDelete,
		"/catalog/products/"+productID.String()+"/offers/"+linked.ID.String(),
		nil,
	)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("unlink offer: %d %s", rec.Code, rec.Body.String())
	}
	var gone models.CatalogOffer
	if err := db.DB.Where("id = ?", linked.ID).First(&gone).Error; err == nil {
		t.Fatal("expected offer row deleted after unlink")
	}

	// PUT update (alias of PATCH)
	putBody, _ := json.Marshal(map[string]interface{}{
		"title":  "Premium US Pool v2",
		"status": "active",
	})
	req = httptest.NewRequest(http.MethodPut, "/catalog/products/"+productID.String(), bytes.NewReader(putBody))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("put update: %d %s", rec.Code, rec.Body.String())
	}
	var updated struct {
		Product models.CatalogProduct `json:"product"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Product.Title != "Premium US Pool v2" {
		t.Fatalf("title after put=%q", updated.Product.Title)
	}
}

func authAs(userID uuid.UUID) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	}
}
