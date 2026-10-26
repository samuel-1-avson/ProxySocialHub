package models

import "testing"

// P2 §9: the registry is closed and consistent with its consumers.
func TestMoneyKindRegistry_P2(t *testing.T) {
	seen := map[string]bool{}
	for _, k := range AllLedgerKinds {
		if k == "" {
			t.Fatal("empty kind registered")
		}
		if seen[k] {
			t.Fatalf("duplicate kind %q", k)
		}
		seen[k] = true
		if !IsKnownLedgerKind(k) {
			t.Fatalf("IsKnownLedgerKind(%q) = false", k)
		}
	}
	for _, k := range DepositLedgerTypes {
		if !seen[k] {
			t.Fatalf("deposit cap kind %q not in registry", k)
		}
	}
	if IsKnownLedgerKind("swap") {
		t.Fatal("deleted TransactionSwap kind must not be registered")
	}
	if IsKnownLedgerKind("made_up_kind") {
		t.Fatal("unknown kind must not pass")
	}
}
