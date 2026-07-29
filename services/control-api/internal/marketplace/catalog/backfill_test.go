package catalog_test

import (
	"testing"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/marketplace/catalog"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestBackfillFromListingsIdempotentAndParity(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "catalog_offers", "catalog_products", "proxy_listings")

	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("backfill_seller"), "provider")

	listings := []models.ProxyListing{
		{
			SellerID:             seller.ID,
			Title:                "US Residential Pool",
			ProxyType:            models.ProxyTypeResidential,
			Protocol:             "http",
			PricePerGB:           1.5,
			AvailableBandwidthGB: 100,
			Status:               models.ListingStatusActive,
		},
		{
			SellerID:             seller.ID,
			Title:                "EU!!! Datacenter @ Fast",
			ProxyType:            models.ProxyTypeDatacenter,
			Protocol:             "socks5",
			PricePerGB:           0.8,
			AvailableBandwidthGB: 50,
			Status:               models.ListingStatusPaused,
		},
		{
			SellerID:             seller.ID,
			Title:                "Pending review node",
			ProxyType:            models.ProxyTypeResidential,
			Protocol:             "http",
			PricePerGB:           2.0,
			AvailableBandwidthGB: 10,
			Status:               models.ListingStatusPendingReview,
		},
		{
			SellerID:             seller.ID,
			Title:                "Deleted should be skipped",
			ProxyType:            models.ProxyTypeResidential,
			Protocol:             "http",
			PricePerGB:           1.0,
			AvailableBandwidthGB: 1,
			Status:               models.ListingStatusDeleted,
		},
	}
	for i := range listings {
		if err := db.DB.Create(&listings[i]).Error; err != nil {
			t.Fatalf("create listing %d: %v", i, err)
		}
	}

	first, err := catalog.BackfillFromListings()
	if err != nil {
		t.Fatalf("first backfill: %v", err)
	}
	if first.EligibleListings != 3 {
		t.Fatalf("eligible=%d want 3", first.EligibleListings)
	}
	if first.Products != 3 || first.Offers != 3 {
		t.Fatalf("products=%d offers=%d want 3/3", first.Products, first.Offers)
	}
	if first.MissingPrimary != 0 {
		t.Fatalf("missing primary offers=%d", first.MissingPrimary)
	}
	if first.OrphanOffers != 0 {
		t.Fatalf("orphan offers=%d", first.OrphanOffers)
	}

	var pendingProduct models.CatalogProduct
	if err := db.DB.First(&pendingProduct, "id = ?", listings[2].ID).Error; err != nil {
		t.Fatalf("load pending_review product: %v", err)
	}
	if pendingProduct.Status != models.CatalogProductStatusDraft {
		t.Fatalf("pending_review listing mapped to %q, want draft", pendingProduct.Status)
	}

	second, err := catalog.BackfillFromListings()
	if err != nil {
		t.Fatalf("second backfill: %v", err)
	}
	if second.Products != first.Products || second.Offers != first.Offers {
		t.Fatalf("idempotent re-run changed counts: first=%+v second=%+v", first, second)
	}

	var primaryCount int64
	if err := db.DB.Model(&models.CatalogOffer{}).
		Where("is_primary = TRUE").
		Count(&primaryCount).Error; err != nil {
		t.Fatal(err)
	}
	if primaryCount != 3 {
		t.Fatalf("primary offers=%d want 3", primaryCount)
	}
}

func TestVerifyBackfillHealthyEmpty(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "catalog_offers", "catalog_products", "proxy_listings")

	got, err := catalog.VerifyBackfill(db.DB)
	if err != nil {
		t.Fatal(err)
	}
	if got.EligibleListings != 0 || got.Products != 0 || got.Offers != 0 {
		t.Fatalf("expected empty catalog, got %+v", got)
	}
	if got.MissingPrimary != 0 || got.OrphanOffers != 0 {
		t.Fatalf("expected clean integrity, got %+v", got)
	}
}
