package decentralization

import (
	"testing"
	"time"
)

func TestZKOnchainGroth16DefaultsFalse(t *testing.T) {
	t.Setenv("PROXYHUB_ZK_ONCHAIN_GROTH16", "")
	t.Setenv("PROXYHUB_ZK_ONCHAIN_GROTH16_READY", "")
	if ZKOnchainGroth16Enabled() {
		t.Fatal("default must be false until Sprint B")
	}
	if ZKOnchainGroth16Ready() {
		t.Fatal("ready must default false until operator enables after deploy")
	}
	if err := GateOnchainGroth16Settlement(); err != nil {
		t.Fatalf("gate should pass when flag off: %v", err)
	}
	t.Setenv("PROXYHUB_ZK_ONCHAIN_GROTH16", "true")
	if !ZKOnchainGroth16Enabled() {
		t.Fatal("explicit true must enable flag")
	}
	if err := GateOnchainGroth16Settlement(); err == nil {
		t.Fatal("gate must fail-closed when flag on and ready=false")
	}
	t.Setenv("PROXYHUB_ZK_ONCHAIN_GROTH16_READY", "true")
	if !ZKOnchainGroth16Ready() {
		t.Fatal("ready env must flip ready")
	}
	if err := GateOnchainGroth16Settlement(); err != nil {
		t.Fatalf("gate should pass when flag+ready: %v", err)
	}
}

func TestGovernanceAutonomyDefaults(t *testing.T) {
	t.Setenv("PROXYHUB_OPS_ONCHAIN_PAUSE", "")
	t.Setenv("PROXYHUB_GOV_TREASURY_AUTO_SPEND", "")
	t.Setenv("PROXYHUB_GOV_TREASURY_EXECUTE_CONFIRM", "")
	if OpsOnchainPauseEnabled() {
		t.Fatal("ops onchain pause must default false")
	}
	if GovTreasuryAutoSpendEnabled() || GovTreasuryExecuteConfirm() || GovTreasuryHotWalletExecuteArmed() {
		t.Fatal("treasury auto-spend must default false / unarmed")
	}
	m := GovernanceAutonomyMeta()
	if m["treasury_execution"] != "pending_custody" {
		t.Fatalf("unexpected meta: %v", m)
	}
}

func TestGovTreasuryHotWalletExecuteArmed(t *testing.T) {
	t.Setenv("PROXYHUB_GOV_TREASURY_AUTO_SPEND", "true")
	t.Setenv("PROXYHUB_GOV_TREASURY_EXECUTE_CONFIRM", "")
	if GovTreasuryHotWalletExecuteArmed() {
		t.Fatal("auto-spend alone must not arm")
	}
	t.Setenv("PROXYHUB_GOV_TREASURY_EXECUTE_CONFIRM", "1")
	if !GovTreasuryHotWalletExecuteArmed() {
		t.Fatal("dual gate must arm")
	}
	m := GovernanceAutonomyMeta()
	if m["treasury_execution"] != "hot_wallet_dual_gated" {
		t.Fatalf("expected hot_wallet_dual_gated, got %v", m["treasury_execution"])
	}
}

func TestProviderRegistryGateMode(t *testing.T) {
	t.Setenv("PROXYHUB_PROVIDER_REGISTRY_GATE", "")
	if ProviderRegistryGateMode() != "off" {
		t.Fatal("default must be off")
	}
	t.Setenv("PROXYHUB_PROVIDER_REGISTRY_GATE", "observe")
	if !ProviderRegistryGateEnabled() || ProviderRegistryGateEnforce() {
		t.Fatal("observe: enabled but not enforce")
	}
	t.Setenv("PROXYHUB_PROVIDER_REGISTRY_GATE", "enforce")
	if !ProviderRegistryGateEnforce() {
		t.Fatal("enforce expected")
	}
	t.Setenv("PROXYHUB_PROVIDER_REGISTRY_GATE", "true")
	if ProviderRegistryGateMode() != "enforce" {
		t.Fatal("true aliases enforce")
	}
}

func TestBrowseRegistryFilterMode(t *testing.T) {
	t.Setenv("PROXYHUB_BROWSE_REGISTRY_FILTER", "")
	if BrowseRegistryFilterMode() != "off" {
		t.Fatal("default must be off")
	}
	t.Setenv("PROXYHUB_BROWSE_REGISTRY_FILTER", "observe")
	if BrowseRegistryFilterEnforce() {
		t.Fatal("observe must not enforce")
	}
	t.Setenv("PROXYHUB_BROWSE_REGISTRY_FILTER", "enforce")
	if !BrowseRegistryFilterEnforce() {
		t.Fatal("enforce expected")
	}
}

func TestListingCommitmentMode(t *testing.T) {
	t.Setenv("PROXYHUB_LISTING_COMMITMENT", "")
	if ListingCommitmentMode() != "off" || ListingCommitmentEnabled() {
		t.Fatal("default off")
	}
	t.Setenv("PROXYHUB_LISTING_COMMITMENT", "observe")
	if !ListingCommitmentEnabled() || ListingCommitmentEnforce() {
		t.Fatal("observe: enabled not enforce")
	}
	t.Setenv("PROXYHUB_LISTING_COMMITMENT", "enforce")
	if !ListingCommitmentEnforce() {
		t.Fatal("enforce expected")
	}
}

func TestSessionCapabilityMode(t *testing.T) {
	t.Setenv("PROXYHUB_SESSION_CAPABILITY", "")
	t.Setenv("PROXYHUB_CREDENTIAL_PROOF", "")
	t.Setenv("PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT", "")
	t.Setenv("PROXYHUB_OPERATOR_BUNDLE_PATH", "")
	t.Setenv("PROXYHUB_OPERATOR_BUNDLE_URL", "")
	t.Setenv("PROXYHUB_OPERATOR_BUNDLE_CID", "")
	if SessionCapabilityMode() != "off" || SessionCapabilityEnabled() {
		t.Fatal("default off")
	}
	if SessionMintHonesty() != "none" {
		t.Fatalf("mint: %s", SessionMintHonesty())
	}
	t.Setenv("PROXYHUB_CREDENTIAL_PROOF", "enforce")
	if SessionMintHonesty() != "control_api_hmac" {
		t.Fatalf("hmac mint: %s", SessionMintHonesty())
	}
	t.Setenv("PROXYHUB_SESSION_CAPABILITY", "observe")
	if !SessionCapabilityEnabled() || SessionCapabilityEnforce() {
		t.Fatal("observe: enabled not enforce")
	}
	if SessionMintHonesty() != "control_api_hmac" {
		t.Fatalf("observe still hmac admission: %s", SessionMintHonesty())
	}
	t.Setenv("PROXYHUB_SESSION_CAPABILITY", "enforce")
	if !SessionCapabilityEnforce() {
		t.Fatal("enforce expected")
	}
	if SessionMintHonesty() != "capability_token" {
		t.Fatalf("enforce mint: %s", SessionMintHonesty())
	}
	m := SessionCapabilityMeta()
	if m["session_mint"] != "capability_token" || m["session_capability_issuer"] != "control_api" {
		t.Fatalf("meta: %v", m)
	}
	if m["session_capability_operator_mint"] != false {
		t.Fatalf("operator mint default: %v", m)
	}
	if m["redis_optional_connect"] != true || m["remaining_spof"] != "token_issuer" {
		t.Fatalf("w7c honesty: %v", m)
	}
	t.Setenv("PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT", "observe")
	if SessionMintHonesty() != "operator_capability" {
		t.Fatalf("operator mint soak: %s", SessionMintHonesty())
	}
	t.Setenv("PROXYHUB_SESSION_CAPABILITY", "observe")
	if SessionMintHonesty() != "control_api_hmac" {
		t.Fatalf("observe must not claim operator_capability: %s", SessionMintHonesty())
	}
	t.Setenv("PROXYHUB_OPERATOR_BUNDLE_PATH", "/tmp/operators.json")
	t.Setenv("PROXYHUB_SESSION_CAPABILITY", "enforce")
	m2 := SessionCapabilityMeta()
	if m2["session_capability_issuer"] != "operators_and_control_api" {
		t.Fatalf("bundle pin issuer honesty: %v", m2)
	}
	if m2["session_mint"] != "operator_capability" {
		t.Fatalf("enforce+operator mint: %v", m2)
	}
	if m2["session_capability_operator_mint"] != true {
		t.Fatalf("operator mint flag: %v", m2)
	}
}

func TestProviderRegistryHeartbeatMaxAge(t *testing.T) {
	t.Setenv("PROXYHUB_PROVIDER_REGISTRY_HEARTBEAT_MAX_AGE", "")
	if ProviderRegistryHeartbeatMaxAge() != 30*time.Minute {
		t.Fatalf("default 30m, got %v", ProviderRegistryHeartbeatMaxAge())
	}
	t.Setenv("PROXYHUB_PROVIDER_REGISTRY_HEARTBEAT_MAX_AGE", "15m")
	if ProviderRegistryHeartbeatMaxAge() != 15*time.Minute {
		t.Fatal("15m expected")
	}
}

func TestCredentialProofMode(t *testing.T) {
	t.Setenv("PROXYHUB_CREDENTIAL_PROOF", "")
	if CredentialProofMode() != "off" || CredentialProofEnabled() || CredentialProofEnforce() {
		t.Fatal("default off")
	}
	t.Setenv("PROXYHUB_CREDENTIAL_PROOF", "observe")
	if !CredentialProofEnabled() || CredentialProofMode() != "observe" || CredentialProofEnforce() {
		t.Fatal("observe expected")
	}
	t.Setenv("PROXYHUB_CREDENTIAL_PROOF", "enforce")
	if !CredentialProofEnforce() || CredentialProofMode() != "enforce" {
		t.Fatal("enforce expected")
	}
}

func TestListingAppealDays(t *testing.T) {
	t.Setenv("PROXYHUB_LISTING_APPEAL_DAYS", "")
	if ListingAppealDays() != 7 {
		t.Fatal("default 7")
	}
	t.Setenv("PROXYHUB_LISTING_APPEAL_DAYS", "14")
	if ListingAppealDays() != 14 {
		t.Fatal("14 expected")
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

	t.Setenv("APP_ENV", "testnet")
	if !DepositRequireFinalized() {
		t.Fatal("testnet default should be true when unset (BC-07)")
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
