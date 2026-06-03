package moderation

import (
	"os"
	"strings"
)

// ListingModerationEnforced returns true when new listings require admin approval before going public.
// Set MARKETPLACE_LISTING_MODERATION=enforce (aliases: strict, required, true, 1).
func ListingModerationEnforced() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("MARKETPLACE_LISTING_MODERATION"))) {
	case "enforce", "strict", "required", "true", "1", "on", "yes":
		return true
	default:
		return false
	}
}
