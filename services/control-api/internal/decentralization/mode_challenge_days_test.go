package decentralization

import "testing"

func TestEscrowChallengeDays(t *testing.T) {
	t.Setenv("PROXYHUB_ESCROW_CHALLENGE_DAYS", "")
	if EscrowChallengeDays() != 7 {
		t.Fatalf("default want 7 got %d", EscrowChallengeDays())
	}
	t.Setenv("PROXYHUB_ESCROW_CHALLENGE_DAYS", "3")
	if EscrowChallengeDays() != 3 {
		t.Fatalf("want 3 got %d", EscrowChallengeDays())
	}
	t.Setenv("PROXYHUB_ESCROW_CHALLENGE_DAYS", "0")
	if EscrowChallengeDays() != 7 {
		t.Fatalf("invalid 0 should fall back to 7 got %d", EscrowChallengeDays())
	}
	t.Setenv("PROXYHUB_ESCROW_CHALLENGE_DAYS", "nope")
	if EscrowChallengeDays() != 7 {
		t.Fatalf("non-int should fall back to 7 got %d", EscrowChallengeDays())
	}
}
