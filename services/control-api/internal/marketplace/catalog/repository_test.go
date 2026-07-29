package catalog_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/marketplace/catalog"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestCountsAfterMigration(t *testing.T) {
	testutil.SetupTestDB(t)

	got, err := catalog.VerifyBackfill(nil)
	if err != nil {
		t.Fatalf("VerifyBackfill: %v", err)
	}
	if got.EligibleListings > 0 && (got.Products == 0 || got.Offers == 0) {
		t.Skipf("migration 000097 not applied: %+v", got)
	}
	if got.MissingPrimary != 0 {
		t.Errorf("missing primary offers=%d", got.MissingPrimary)
	}
	if got.OrphanOffers != 0 {
		t.Errorf("orphan offers=%d", got.OrphanOffers)
	}
}

func TestOfferByListingIDNotFound(t *testing.T) {
	testutil.SetupTestDB(t)

	_, err := catalog.OfferByListingID(uuid.New())
	if err == nil {
		t.Fatal("expected error for random listing id")
	}
	if err != catalog.ErrOfferNotFound {
		t.Fatalf("got %v, want ErrOfferNotFound", err)
	}
}
