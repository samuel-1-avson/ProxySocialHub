package treasury

import "testing"

func TestExcessHotSweepSOL(t *testing.T) {
	if got := ExcessHotSweepSOL(40, 50); got != 0 {
		t.Fatalf("below max: got %v", got)
	}
	if got := ExcessHotSweepSOL(50, 50); got != 0 {
		t.Fatalf("at max: got %v", got)
	}
	if got := ExcessHotSweepSOL(50.02, 50); got != 0 {
		t.Fatalf("dust excess should be 0, got %v", got)
	}
	if got := ExcessHotSweepSOL(75, 50); got != 25 {
		t.Fatalf("excess: got %v want 25", got)
	}
}

func TestSweepEnabledDefault(t *testing.T) {
	t.Setenv("SOLANA_TREASURY_SWEEP_ENABLED", "")
	if !SweepEnabled() {
		t.Fatal("expected sweep enabled by default")
	}
	t.Setenv("SOLANA_TREASURY_SWEEP_ENABLED", "false")
	if SweepEnabled() {
		t.Fatal("expected sweep disabled")
	}
	t.Setenv("SOLANA_TREASURY_SWEEP_ENABLED", "true")
	if !SweepEnabled() {
		t.Fatal("expected sweep enabled")
	}
}
