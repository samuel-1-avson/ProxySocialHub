package moderation

import (
	"testing"
)

func TestListingModerationEnforced(t *testing.T) {
	t.Setenv("MARKETPLACE_LISTING_MODERATION", "enforce")
	if !ListingModerationEnforced() {
		t.Fatal("expected enforce mode")
	}
	t.Setenv("MARKETPLACE_LISTING_MODERATION", "off")
	if ListingModerationEnforced() {
		t.Fatal("expected moderation off")
	}
}
