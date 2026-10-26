package decentralization

import (
	"strings"
	"testing"
)

func clearPostureEnv(t *testing.T) {
	t.Helper()
	keys := append(append([]string{}, boolPostureFlags...), enumPostureFlags...)
	keys = append(keys, "FULL_DECENTRALIZATION", "APP_ENV", "EMERGENCY_SOL_PRICE_USD", "REQUIRE_PROVIDER_LEASE")
	keys = append(keys, kmsBoolFlags...)
	keys = append(keys, keypairFileEnvVars...)
	keys = append(keys, "GCP_KMS_KEY_NAME", "GCP_KMS_PUBLIC_KEY", "AWS_KMS_KEY_ID", "AWS_KMS_PUBLIC_KEY",
		"GCP_KMS_HOT_KEY_NAME", "GCP_KMS_HOT_PUBLIC_KEY", "ORACLE_PRIVATE_KEY", "ORACLE_KEYPAIR_ENCRYPTION_KEY")
	for _, k := range keys {
		t.Setenv(k, "")
	}
}

func setValidProdEnv(t *testing.T) {
	t.Helper()
	clearPostureEnv(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("PROXYHUB_DEPOSIT_REQUIRE_FINALIZED", "true")
	t.Setenv("PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT", "true")
	t.Setenv("EMERGENCY_SOL_PRICE_USD", "200")
	t.Setenv("REQUIRE_PROVIDER_LEASE", "true")
	// W-28: production signing posture.
	t.Setenv("PROXYHUB_MULTISIG_SETTLE_ENABLED", "true")
	t.Setenv("USE_GCP_KMS", "true")
	t.Setenv("GCP_KMS_KEY_NAME", "projects/p/locations/l/keyRings/r/cryptoKeys/k")
	t.Setenv("GCP_KMS_PUBLIC_KEY", "11111111111111111111111111111111")
}

// P0-8: a typo'd posture flag must fail boot — envTruthy used to silently
// fall back to its default, so "ture" quietly chose a posture.
func TestValidateSecurityPosture_P0_TypoRejected(t *testing.T) {
	clearPostureEnv(t)
	t.Setenv("PROXYHUB_DEPOSIT_REQUIRE_FINALIZED", "ture")
	err := ValidateSecurityPosture()
	if err == nil || !strings.Contains(err.Error(), "PROXYHUB_DEPOSIT_REQUIRE_FINALIZED") {
		t.Fatalf("want typo rejection, got %v", err)
	}
}

func TestValidateSecurityPosture_P0_EnumTypoRejected(t *testing.T) {
	clearPostureEnv(t)
	t.Setenv("PROXYHUB_PROVIDER_REGISTRY_GATE", "enforced")
	if err := ValidateSecurityPosture(); err == nil {
		t.Fatal("want enum typo rejection")
	}
}

// P0-8: dev with clean flags boots (defaults remain available locally).
func TestValidateSecurityPosture_P0_DevCleanPasses(t *testing.T) {
	clearPostureEnv(t)
	t.Setenv("APP_ENV", "development")
	if err := ValidateSecurityPosture(); err != nil {
		t.Fatalf("dev clean env should pass: %v", err)
	}
}

// P0-8: production must assert the secure posture explicitly.
func TestValidateSecurityPosture_P0_ProdRequiresExplicitFinalized(t *testing.T) {
	setValidProdEnv(t)
	t.Setenv("PROXYHUB_DEPOSIT_REQUIRE_FINALIZED", "")
	err := ValidateSecurityPosture()
	if err == nil || !strings.Contains(err.Error(), "explicitly") {
		t.Fatalf("want explicit-finalized error, got %v", err)
	}
}

func TestValidateSecurityPosture_P0_ProdForbidsUnfinalized(t *testing.T) {
	setValidProdEnv(t)
	t.Setenv("PROXYHUB_DEPOSIT_REQUIRE_FINALIZED", "false")
	if err := ValidateSecurityPosture(); err == nil {
		t.Fatal("prod must forbid unfinalized deposits")
	}
}

func TestValidateSecurityPosture_P0_ProdRequiresDepositPathAndEmergencyPrice(t *testing.T) {
	setValidProdEnv(t)
	t.Setenv("PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT", "false")
	t.Setenv("EMERGENCY_SOL_PRICE_USD", "")
	err := ValidateSecurityPosture()
	if err == nil ||
		!strings.Contains(err.Error(), "deposit credit path") ||
		!strings.Contains(err.Error(), "EMERGENCY_SOL_PRICE_USD") {
		t.Fatalf("want both prod problems reported, got %v", err)
	}
}

func TestValidateSecurityPosture_P0_ProdValidPasses(t *testing.T) {
	setValidProdEnv(t)
	if err := ValidateSecurityPosture(); err != nil {
		t.Fatalf("valid prod posture should pass: %v", err)
	}
	posture := EffectivePosture()
	if posture["deposit_require_finalized"] != true {
		t.Fatalf("effective posture should report finalized=true, got %v", posture)
	}
}

func TestStrictEnvBool_P0(t *testing.T) {
	t.Setenv("P0_TEST_BOOL", "yes")
	if v, set, err := StrictEnvBool("P0_TEST_BOOL"); !v || !set || err != nil {
		t.Fatalf("yes: got %v %v %v", v, set, err)
	}
	t.Setenv("P0_TEST_BOOL", "")
	if v, set, err := StrictEnvBool("P0_TEST_BOOL"); v || set || err != nil {
		t.Fatalf("unset: got %v %v %v", v, set, err)
	}
}
