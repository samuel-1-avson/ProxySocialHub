package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
	"gorm.io/datatypes"
)

func TestGetListingIncludeProduct(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "catalog_offers", "catalog_products", "proxy_listings")

	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("inc_prod_seller"), "provider")
	listing := models.ProxyListing{
		SellerID:             seller.ID,
		Title:                "API listing",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		PricePerGB:           4,
		AvailableBandwidthGB: 20,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatal(err)
	}
	product := models.CatalogProduct{
		ID:       listing.ID,
		SellerID: seller.ID,
		Slug:     "api-product-slug01",
		Title:    "Catalog card title",
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
	r.GET("/listings/:id", getListing)

	req := httptest.NewRequest(http.MethodGet, "/listings/"+listing.ID.String()+"?include=product", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Listing models.ProxyListing `json:"listing"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Listing.CatalogProduct == nil {
		t.Fatal("missing catalog_product")
	}
	if resp.Listing.CatalogProduct.Slug != product.Slug {
		t.Fatalf("slug %q", resp.Listing.CatalogProduct.Slug)
	}
}

func TestGetListingWithoutIncludeOmitsProduct(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "catalog_offers", "catalog_products", "proxy_listings")

	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("no_inc_seller"), "provider")
	listing := models.ProxyListing{
		SellerID:             seller.ID,
		Title:                "Plain",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		PricePerGB:           1,
		AvailableBandwidthGB: 5,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.DB.Create(&models.CatalogProduct{
		ID: listing.ID, SellerID: seller.ID, Slug: "x-" + listing.ID.String()[:8],
		Title: "P", Status: models.CatalogProductStatusActive, Media: datatypes.JSON([]byte("[]")),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.DB.Create(&models.CatalogOffer{ProductID: listing.ID, ListingID: listing.ID, IsPrimary: true}).Error; err != nil {
		t.Fatal(err)
	}

	r := setupTestRouter()
	r.GET("/listings/:id", getListing)
	req := httptest.NewRequest(http.MethodGet, "/listings/"+listing.ID.String(), nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var resp struct {
		Listing models.ProxyListing `json:"listing"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Listing.CatalogProduct != nil {
		t.Fatal("catalog_product should be omitted without include=product")
	}
}
