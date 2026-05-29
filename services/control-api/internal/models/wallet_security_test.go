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

func TestWithdrawalDestination_WhitelistEnforced(t *testing.T) {
	primary := "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuGui4Q5G"
	other := "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9wYt5WGy"
	linked := primary
	w := Wallet{
		PrimaryWithdrawalAddress: &primary,
		WithdrawalWhitelist:      []string{other},
	}
	_, err := w.WithdrawalDestination(&linked)
	if err == nil {
		t.Fatal("expected whitelist rejection")
	}
}
