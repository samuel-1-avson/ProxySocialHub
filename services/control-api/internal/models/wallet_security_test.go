package models

import (
	"testing"
)

func TestWithdrawalDestination_PrimaryAndLinked(t *testing.T) {
	primary := "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuGui4Q5G"
	linked := primary
	w := Wallet{
		PrimaryWithdrawalAddress: &primary,
		WithdrawalWhitelist:      []string{},
	}
	dest, err := w.WithdrawalDestination(&linked)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dest != primary {
		t.Fatalf("expected primary %s, got %s", primary, dest)
	}
}

func TestWithdrawalDestination_LinkedMustMatchPrimary(t *testing.T) {
	primary := "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuGui4Q5G"
	linked := "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9wYt5WGy"
	w := Wallet{
		PrimaryWithdrawalAddress: &primary,
		WithdrawalWhitelist:      []string{},
	}
	_, err := w.WithdrawalDestination(&linked)
	if err == nil {
		t.Fatal("expected linked wallet mismatch error")
	}
}

// W-34: whitelist removed; the stored column is ignored and the
// destination is pinned to the linked primary.
func TestWithdrawalDestination_WhitelistIgnored_P2(t *testing.T) {
	primary := "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuGui4Q5G"
	other := "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9wYt5WGy"
	linked := primary
	w := Wallet{
		PrimaryWithdrawalAddress: &primary,
		WithdrawalWhitelist:      []string{other},
	}
	dest, err := w.WithdrawalDestination(&linked)
	if err != nil {
		t.Fatalf("whitelist must be ignored after W-34: %v", err)
	}
	if dest != primary {
		t.Fatalf("dest must be linked primary, got %s", dest)
	}
	_ = other
}
