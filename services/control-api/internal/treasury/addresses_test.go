package treasury

import "testing"

func TestGetHotTreasuryPubkeyFallback(t *testing.T) {
	t.Setenv("SOLANA_TREASURY_HOT_ADDRESS", "")
	t.Setenv("SOLANA_TREASURY_ADDRESS", "11111111111111111111111111111112")

	pk := GetHotTreasuryPubkey()
	if pk.IsZero() {
		t.Fatal("expected hot pubkey from legacy treasury env")
	}
}

func TestHotMinBalanceEnv(t *testing.T) {
	t.Setenv("SOLANA_TREASURY_HOT_MIN_BALANCE", "42.5")
	if got := HotMinBalanceSOL(); got != 42.5 {
		t.Fatalf("HotMinBalanceSOL() = %v, want 42.5", got)
	}
}
