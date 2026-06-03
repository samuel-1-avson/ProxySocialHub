package db

import (
	"testing"

	"github.com/proxyhubb/control-api/internal/models"
)

func TestListingModelsToEntities_PreservesFeaturedOrder(t *testing.T) {
	listings := []models.ProxyListing{
		{Title: "A", QualityScore: 90},
		{Title: "B", QualityScore: 80},
	}
	entities := listingModelsToEntities(listings)
	if len(entities) != 2 {
		t.Fatalf("expected 2 entities, got %d", len(entities))
	}
	if entities[0].Title != "A" || entities[1].Title != "B" {
		t.Fatal("entity order should match input order")
	}
}
