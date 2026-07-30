package funnel

import (
	"testing"

	"github.com/proxyhubb/control-api/internal/models"
)

func TestComputeConversion(t *testing.T) {
	got := computeConversion(map[string]int64{
		models.FunnelListingView:     100,
		models.FunnelOrderCreated:    10,
		models.FunnelEscrowConfirmed: 5,
	})
	if got["view_to_order"] != 0.1 {
		t.Fatalf("view_to_order=%v", got["view_to_order"])
	}
	if got["order_to_escrow_confirmed"] != 0.5 {
		t.Fatalf("order_to_escrow_confirmed=%v", got["order_to_escrow_confirmed"])
	}
	if got["view_to_escrow_confirmed"] != 0.05 {
		t.Fatalf("view_to_escrow_confirmed=%v", got["view_to_escrow_confirmed"])
	}

	empty := computeConversion(map[string]int64{})
	if empty["view_to_order"] != 0 {
		t.Fatalf("expected zero conversion with no views")
	}
}

func TestOrderedSteps(t *testing.T) {
	if len(OrderedSteps) != 7 {
		t.Fatalf("expected 7 funnel steps, got %d", len(OrderedSteps))
	}
	if OrderedSteps[0] != models.FunnelListingView {
		t.Fatalf("funnel must start with listing_view")
	}
	if OrderedSteps[len(OrderedSteps)-1] != models.FunnelCredentialsDelivered {
		t.Fatalf("funnel must end with credentials_delivered")
	}
}
