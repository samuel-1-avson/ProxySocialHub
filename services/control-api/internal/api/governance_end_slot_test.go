package api

import "testing"
import "time"

func TestGovernanceEndSlotAddsCurrentSlot(t *testing.T) {
	got := governanceEndSlot(1000, 400*time.Millisecond)
	if got != 1001 {
		t.Fatalf("expected current+1 for one slot duration, got %d", got)
	}
	got = governanceEndSlot(50_000, 24*time.Hour)
	wantDuration := uint64((24 * time.Hour) / (400 * time.Millisecond))
	if got != 50_000+wantDuration {
		t.Fatalf("expected %d, got %d", 50_000+wantDuration, got)
	}
	if governanceEndSlot(9, 0) != 10 {
		t.Fatal("zero duration should still advance by 1 slot")
	}
}
