package solana

import (
	"testing"
)

func TestResolveDepositDestination(t *testing.T) {
	t.Setenv("SOLANA_TREASURY_ADDRESS", "Treasury111111111111111111111111111111111")
	t.Setenv("SOLANA_DEPOSIT_VAULT_ADDRESS", "Vault111111111111111111111111111111111111")
	t.Setenv("PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT", "true")
	t.Setenv("PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED", "false")

	if got := ResolveDepositDestination("Treasury111111111111111111111111111111111"); got != DepositDestTreasury {
		t.Fatalf("expected treasury, got %q", got)
	}
	if got := ResolveDepositDestination("Vault111111111111111111111111111111111111"); got != "" {
		t.Fatalf("vault credit disabled: expected empty, got %q", got)
	}

	t.Setenv("PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED", "true")
	if got := ResolveDepositDestination("Vault111111111111111111111111111111111111"); got != DepositDestVault {
		t.Fatalf("expected vault, got %q", got)
	}

	t.Setenv("PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT", "false")
	if got := ResolveDepositDestination("Treasury111111111111111111111111111111111"); got != "" {
		t.Fatalf("legacy disabled: expected empty, got %q", got)
	}
}

func TestGetDepositDestinationAddressUI(t *testing.T) {
	t.Setenv("SOLANA_TREASURY_ADDRESS", "Treasury111111111111111111111111111111111")
	t.Setenv("SOLANA_DEPOSIT_VAULT_ADDRESS", "Vault111111111111111111111111111111111111")
	t.Setenv("PROXYHUB_DEPOSIT_VAULT_UI", "false")
	if got := GetDepositDestinationAddress(); got != "Treasury111111111111111111111111111111111" {
		t.Fatalf("UI off: expected treasury, got %q", got)
	}
	t.Setenv("PROXYHUB_DEPOSIT_VAULT_UI", "true")
	if got := GetDepositDestinationAddress(); got != "Vault111111111111111111111111111111111111" {
		t.Fatalf("UI on: expected vault, got %q", got)
	}
}
