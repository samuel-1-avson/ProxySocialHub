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

func TestStagingHotDefaults(t *testing.T) {
	t.Setenv("SOLANA_TREASURY_HOT_MIN_BALANCE", "")
	t.Setenv("SOLANA_TREASURY_REPLENISH_AMOUNT", "")
	t.Setenv("APP_ENV", "staging")
	t.Setenv("SOLANA_NETWORK", "devnet")
	if got := HotMinBalanceSOL(); got != 5.0 {
		t.Fatalf("HotMinBalanceSOL() staging default = %v, want 5", got)
	}
	if got := HotReplenishAmountSOL(); got != 15.0 {
		t.Fatalf("HotReplenishAmountSOL() staging default = %v, want 15", got)
	}
}

func TestVaultTopUpMaxEnv(t *testing.T) {
	t.Setenv("SOLANA_VAULT_TOPUP_MAX_SOL", "7.5")
	t.Setenv("SOLANA_TREASURY_REPLENISH_AMOUNT", "15")
	if got := VaultTopUpMaxSOL(); got != 7.5 {
		t.Fatalf("VaultTopUpMaxSOL() = %v, want 7.5", got)
	}
}
