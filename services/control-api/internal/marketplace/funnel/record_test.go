package funnel_test

import (
	"testing"

	"github.com/proxyhubb/control-api/internal/models"
)

func TestIsValidFunnelEventName(t *testing.T) {
	valid := []string{
		models.FunnelListingView,
		models.FunnelOrderCreated,
		models.FunnelCredentialsDelivered,
	}
	for _, name := range valid {
		if !models.IsValidFunnelEventName(name) {
			t.Fatalf("expected valid: %s", name)
		}
	}
	if models.IsValidFunnelEventName("unknown_event") {
		t.Fatal("expected invalid event name")
	}
}
