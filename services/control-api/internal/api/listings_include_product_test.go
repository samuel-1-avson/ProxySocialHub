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

func TestGetListingIncludeProductUnlinkedStillOK(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "catalog_offers", "catalog_products", "proxy_listings")

	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("unlinked_inc"), "provider")
	listing := models.ProxyListing{
		SellerID:             seller.ID,
		Title:                "No catalog link",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		PricePerGB:           1.2,
		AvailableBandwidthGB: 8,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
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
	if resp.Listing.CatalogProduct != nil {
		t.Fatal("unlinked listing must not embed catalog_product")
	}
}

func TestListListingsIncludeProduct(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "catalog_offers", "catalog_products", "proxy_listings")

	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("list_inc_seller"), "provider")
	listing := models.ProxyListing{
		SellerID:             seller.ID,
		Title:                "Browse listing",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		PricePerGB:           2.5,
		AvailableBandwidthGB: 40,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatal(err)
	}
	product := models.CatalogProduct{
		ID:       listing.ID,
		SellerID: seller.ID,
		Slug:     "browse-product-" + listing.ID.String()[:8],
		Title:    "Browse merch title",
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
	r.GET("/listings", getListings)

	req := httptest.NewRequest(http.MethodGet, "/listings?include=product&seller_id="+seller.ID.String(), nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}

	var resp ListingsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range resp.Listings {
		if item.ID != listing.ID {
			continue
		}
		found = true
		if item.CatalogProduct == nil {
			t.Fatal("expected catalog_product on list item")
		}
		if item.CatalogProduct.Title != product.Title {
			t.Fatalf("title %q", item.CatalogProduct.Title)
		}
	}
	if !found {
		t.Fatalf("listing %s not in browse response (%d items)", listing.ID, len(resp.Listings))
	}
}
