package billing

import "testing"

// E-9: sub-1 SOL payouts must be differentiated (was int-truncated to 1).
func TestCalculatePriority_SubSolDifferentiated_P2(t *testing.T) {
	bp := &BatchPayoutProcessor{}
	if bp.calculatePriority(0.01) != 1 {
		t.Fatalf("0.01 SOL want 1 got %d", bp.calculatePriority(0.01))
	}
	if bp.calculatePriority(0.99) <= bp.calculatePriority(0.01) {
		t.Fatalf("0.99 (%d) must outrank 0.01 (%d)", bp.calculatePriority(0.99), bp.calculatePriority(0.01))
	}
	if bp.calculatePriority(9) <= bp.calculatePriority(0.99) {
		t.Fatal("9 must outrank 0.99")
	}
	if bp.calculatePriority(0) != 1 || bp.calculatePriority(-5) != 1 {
		t.Fatal("non-positive -> 1")
	}
	if bp.calculatePriority(1e12) > 100 {
		t.Fatal("capped at 100")
	}
}
