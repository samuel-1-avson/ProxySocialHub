package decentralization

import "testing"

func TestMultisigSettleEnabled(t *testing.T) {
	t.Setenv("PROXYHUB_MULTISIG_SETTLE_ENABLED", "")
	if MultisigSettleEnabled() {
		t.Fatal("default want false")
	}
	t.Setenv("PROXYHUB_MULTISIG_SETTLE_ENABLED", "true")
	if !MultisigSettleEnabled() {
		t.Fatal("want true")
	}
	t.Setenv("PROXYHUB_MULTISIG_SETTLE_ENABLED", "0")
	if MultisigSettleEnabled() {
		t.Fatal("want false for 0")
	}
}

func TestMultisigSettleAmountLamports(t *testing.T) {
	t.Setenv("PROXYHUB_MULTISIG_SETTLE_AMOUNT_LAMPORTS", "")
	if MultisigSettleAmountLamports() != 100_000_000 {
		t.Fatalf("default want 1e8 got %d", MultisigSettleAmountLamports())
	}
	t.Setenv("PROXYHUB_MULTISIG_SETTLE_AMOUNT_LAMPORTS", "50000000")
	if MultisigSettleAmountLamports() != 50_000_000 {
		t.Fatalf("want 5e7 got %d", MultisigSettleAmountLamports())
	}
	t.Setenv("PROXYHUB_MULTISIG_SETTLE_AMOUNT_LAMPORTS", "0")
	if MultisigSettleAmountLamports() != 100_000_000 {
		t.Fatalf("zero should fall back to 1e8 got %d", MultisigSettleAmountLamports())
	}
}
