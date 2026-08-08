package decentralization

import "testing"

func TestZKOnchainGroth16DefaultsFalse(t *testing.T) {
	t.Setenv("PROXYHUB_ZK_ONCHAIN_GROTH16", "")
	if ZKOnchainGroth16Enabled() {
		t.Fatal("default must be false until Sprint B")
	}
	t.Setenv("PROXYHUB_ZK_ONCHAIN_GROTH16", "true")
	if !ZKOnchainGroth16Enabled() {
		t.Fatal("explicit true must enable flag")
	}
}

func TestDepositRequireFinalizedDefaults(t *testing.T) {
	t.Setenv("PROXYHUB_DEPOSIT_REQUIRE_FINALIZED", "")

	t.Setenv("APP_ENV", "development")
	if DepositRequireFinalized() {
		t.Fatal("dev default should be false when unset")
	}

	t.Setenv("APP_ENV", "staging")
	if !DepositRequireFinalized() {
		t.Fatal("staging default should be true when unset (BC-07)")
	}

	t.Setenv("APP_ENV", "production")
	if !DepositRequireFinalized() {
		t.Fatal("production default should be true when unset (BC-07)")
	}

	t.Setenv("APP_ENV", "production")
	t.Setenv("PROXYHUB_DEPOSIT_REQUIRE_FINALIZED", "false")
	if DepositRequireFinalized() {
		t.Fatal("explicit false must win")
	}

	t.Setenv("APP_ENV", "development")
	t.Setenv("PROXYHUB_DEPOSIT_REQUIRE_FINALIZED", "true")
	if !DepositRequireFinalized() {
		t.Fatal("explicit true must win in development")
	}
}
