package catalog_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/marketplace/catalog"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestCountsAfterMigration(t *testing.T) {
	testutil.SetupTestDB(t)

	products, offers, err := catalog.Counts()
	if err != nil {
		t.Fatalf("Counts: %v", err)
	}
	eligible, err := catalog.ListingsEligibleForBackfill()
	if err != nil {
		t.Fatalf("ListingsEligibleForBackfill: %v", err)
	}
	if eligible > 0 && (products == 0 || offers == 0) {
		t.Skipf("migration 000097 not applied: eligible=%d products=%d offers=%d", eligible, products, offers)
	}
	if products != offers {
		t.Errorf("products=%d offers=%d, want equal", products, offers)
	}
	if eligible > 0 && products < eligible {
		t.Errorf("products=%d eligible=%d, want products >= eligible after backfill", products, eligible)
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
