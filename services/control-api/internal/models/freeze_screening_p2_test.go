package models

import (
	"testing"
)

// W-34: tier deposit caps never exceed global caps; KYC lifts new users.
func TestDepositCapsForTier_P2(t *testing.T) {
	t.Setenv("MAX_SINGLE_DEPOSIT_SOL", "")
	t.Setenv("MAX_DAILY_DEPOSIT_SOL", "")

	if s, d := DepositCapsForTier(TrustTierNew, KYCStatusNone); s != 25 || d != 50 {
		t.Fatalf("new: got %v/%v want 25/50", s, d)
	}
	if s, d := DepositCapsForTier(TrustTierNew, KYCStatusApproved); s != 250 || d != 500 {
		t.Fatalf("new+kyc: got %v/%v want 250/500", s, d)
	}
	if s, d := DepositCapsForTier(TrustTierVerified, KYCStatusNone); s != 250 || d != 500 {
		t.Fatalf("verified: got %v/%v want 250/500", s, d)
	}
	if s, d := DepositCapsForTier(TrustTierPremium, KYCStatusNone); s != DefaultMaxSingleDepositSOL || d != DefaultMaxDailyDepositSOL {
		t.Fatalf("premium: got %v/%v want global", s, d)
	}
	// Global env ceiling always wins.
	t.Setenv("MAX_SINGLE_DEPOSIT_SOL", "5")
	if s, _ := DepositCapsForTier(TrustTierVerified, KYCStatusApproved); s != 5 {
		t.Fatalf("global ceiling must win, got %v", s)
	}
}

// W-34: deny-list screening is config-driven and exact-match.
func TestAddressBlocked_P2(t *testing.T) {
	t.Setenv("BLOCKED_SOLANA_ADDRESSES", "AddrA111, AddrB222 ,AddrC333")
	if !AddressBlocked("AddrB222") {
		t.Fatal("listed address must be blocked")
	}
	if AddressBlocked("AddrB22") || AddressBlocked("") || AddressBlocked("Other") {
		t.Fatal("non-listed addresses must pass")
	}
	t.Setenv("BLOCKED_SOLANA_ADDRESSES", "")
	if AddressBlocked("AddrB222") {
		t.Fatal("empty list blocks nothing")
	}
}
