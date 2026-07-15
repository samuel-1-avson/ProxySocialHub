package catalog_test

import (
	"testing"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/marketplace/catalog"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
	"gorm.io/datatypes"
)

func TestEnrichListingsWithCatalogProducts(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "catalog_offers", "catalog_products", "proxy_listings")

	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("enrich_seller"), "provider")
	listing := models.ProxyListing{
		SellerID:             seller.ID,
		Title:                "Listed supply",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
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
		Slug:     "active-pool-abc12345",
		Title:    "Merch title",
		Status:   models.CatalogProductStatusActive,
		Media:    datatypes.JSON([]byte("[]")),
	}
	if err := db.DB.Create(&product).Error; err != nil {
		t.Fatal(err)
	}
	offer := models.CatalogOffer{
		ProductID: product.ID,
		ListingID: listing.ID,
		IsPrimary: true,
	}
	if err := db.DB.Create(&offer).Error; err != nil {
		t.Fatal(err)
	}

	listings := []models.ProxyListing{{ID: listing.ID, SellerID: seller.ID, Title: listing.Title}}
	if err := catalog.EnrichListingsWithCatalogProducts(listings, nil); err != nil {
		t.Fatal(err)
	}
	if listings[0].CatalogProduct == nil {
		t.Fatal("expected catalog_product on listing")
	}
	if listings[0].CatalogProduct.Title != "Merch title" {
		t.Fatalf("title %q", listings[0].CatalogProduct.Title)
	}

	// Draft hidden from public
	draftListing := models.ProxyListing{
		SellerID:             seller.ID,
		Title:                "Draft supply",
		ProxyType:            models.ProxyTypeResidential,
		Protocol:             "http",
		PricePerGB:           2,
		AvailableBandwidthGB: 10,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&draftListing).Error; err != nil {
		t.Fatal(err)
	}
	draftProduct := models.CatalogProduct{
		ID:       draftListing.ID,
		SellerID: seller.ID,
		Slug:     "draft-only-xyz98765",
		Title:    "Hidden merch",
		Status:   models.CatalogProductStatusDraft,
		Media:    datatypes.JSON([]byte("[]")),
	}
	if err := db.DB.Create(&draftProduct).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.DB.Create(&models.CatalogOffer{
		ProductID: draftProduct.ID,
		ListingID: draftListing.ID,
		IsPrimary: true,
	}).Error; err != nil {
		t.Fatal(err)
	}

	draftBatch := []models.ProxyListing{{ID: draftListing.ID, SellerID: seller.ID}}
	if err := catalog.EnrichListingsWithCatalogProducts(draftBatch, nil); err != nil {
		t.Fatal(err)
	}
	if draftBatch[0].CatalogProduct != nil {
		t.Fatal("draft product should not appear for anonymous viewer")
	}

	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("enrich_buyer"), "buyer")
	if err := catalog.EnrichListingsWithCatalogProducts(draftBatch, &seller.ID); err != nil {
		t.Fatal(err)
	}
	if draftBatch[0].CatalogProduct == nil {
		t.Fatal("seller should see draft catalog product")
	}
	_ = buyer
}
