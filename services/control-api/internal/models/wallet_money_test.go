package models

import "testing"

func TestWalletLamportsRoundTrip(t *testing.T) {
	w := &Wallet{BalanceSOL: LamportsToSOL(1_000_000_000)}
	w.CreditSOL(LamportsToSOL(1))
	if got := SOLToLamports(w.BalanceSOL); got != 1_000_000_001 {
		t.Fatalf("unexpected balance lamports after 1-lamport credit: %d", got)
	}
}

func TestWalletDebitInsufficient(t *testing.T) {
	w := &Wallet{BalanceSOL: 0.5}
	if w.DebitSOL(0.500000001) {
		t.Fatal("expected debit of more than balance to fail")
	}
	if w.BalanceSOL != 0.5 {
		t.Fatalf("balance mutated on failed debit: %v", w.BalanceSOL)
	}
}

func TestWalletDebitExact(t *testing.T) {
	w := &Wallet{BalanceSOL: 1.0}
	if !w.DebitSOL(1.0) {
		t.Fatal("exact debit should succeed")
	}
	if SOLToLamports(w.BalanceSOL) != 0 {
		t.Fatalf("expected zero balance, got %v", w.BalanceSOL)
	}
}

func TestWalletCreditDebitKeepsLamportsInSync(t *testing.T) {
	w := &Wallet{BalanceSOL: 1.25}
	w.BalanceLamports = int64(SOLToLamports(w.BalanceSOL))
	w.CreditSOL(0.75)
	if w.BalanceLamports != int64(SOLToLamports(2.0)) {
		t.Fatalf("balance_lamports out of sync after credit: %d vs %d", w.BalanceLamports, SOLToLamports(2.0))
	}
	if !w.DebitSOL(0.5) {
		t.Fatal("debit should succeed")
	}
	if w.BalanceLamports != int64(SOLToLamports(1.5)) {
		t.Fatalf("balance_lamports out of sync after debit: %d", w.BalanceLamports)
	}
}

func TestWalletCreditDebitLamportsExact(t *testing.T) {
	w := &Wallet{BalanceSOL: 1.0, BalanceLamports: 1_000_000_000}
	w.CreditLamports(1)
	if w.BalanceLamports != 1_000_000_001 {
		t.Fatalf("expected 1000000001 lamports, got %d", w.BalanceLamports)
	}
	if SOLToLamports(w.BalanceSOL) != 1_000_000_001 {
		t.Fatalf("BalanceSOL out of sync: %v", w.BalanceSOL)
	}
	if !w.DebitLamports(1_000_000_001) {
		t.Fatal("exact debit should succeed")
	}
	if w.BalanceLamports != 0 || SOLToLamports(w.BalanceSOL) != 0 {
		t.Fatalf("expected zero, got lamports=%d sol=%v", w.BalanceLamports, w.BalanceSOL)
	}
}

func TestWalletDebitLamportsInsufficient(t *testing.T) {
	w := &Wallet{BalanceSOL: 0.5, BalanceLamports: 500_000_000}
	if w.DebitLamports(500_000_001) {
		t.Fatal("expected debit to fail")
	}
	if w.BalanceLamports != 500_000_000 {
		t.Fatalf("balance mutated on failed debit: %d", w.BalanceLamports)
	}
}

func TestEffectiveBalanceLamportsPrefersStored(t *testing.T) {
	w := &Wallet{BalanceSOL: 1.0, BalanceLamports: 1_000_000_000}
	if w.EffectiveBalanceLamports() != 1_000_000_000 {
		t.Fatalf("expected synced lamports")
	}
	legacy := &Wallet{BalanceSOL: 2.0, BalanceLamports: 0}
	if legacy.EffectiveBalanceLamports() != int64(SOLToLamports(2.0)) {
		t.Fatalf("legacy row should derive from BalanceSOL")
	}
}


