package decentralization

import (
	"strings"
	"testing"
)

// W-28: production signing posture fails closed.

func TestPostureSigning_P2_ProdRequiresMultisig(t *testing.T) {
	setValidProdEnv(t)
	t.Setenv("PROXYHUB_MULTISIG_SETTLE_ENABLED", "false")
	err := ValidateSecurityPosture()
	if err == nil || !strings.Contains(err.Error(), "MULTISIG_SETTLE") {
		t.Fatalf("want multisig error, got %v", err)
	}
}

func TestPostureSigning_P2_ProdRequiresKMS(t *testing.T) {
	setValidProdEnv(t)
	t.Setenv("USE_GCP_KMS", "false")
	err := ValidateSecurityPosture()
	if err == nil || !strings.Contains(err.Error(), "KMS/HSM signer") {
		t.Fatalf("want KMS error, got %v", err)
	}
	// Partial KMS config (flag on, key missing) also fails.
	t.Setenv("USE_GCP_KMS", "true")
	t.Setenv("GCP_KMS_KEY_NAME", "")
	if err := ValidateSecurityPosture(); err == nil {
		t.Fatal("partial KMS config must fail")
	}
}

func TestPostureSigning_P2_ProdForbidsRawEnvKeyAndPlaintextFiles(t *testing.T) {
	setValidProdEnv(t)
	t.Setenv("ORACLE_PRIVATE_KEY", "deadbeef")
	err := ValidateSecurityPosture()
	if err == nil || !strings.Contains(err.Error(), "ORACLE_PRIVATE_KEY") {
		t.Fatalf("want raw-key error, got %v", err)
	}
	t.Setenv("ORACLE_PRIVATE_KEY", "")
	t.Setenv("SOLANA_TREASURY_HOT_KEYPAIR", "/keys/hot.json")
	err = ValidateSecurityPosture()
	if err == nil || !strings.Contains(err.Error(), "plaintext key files are refused") {
		t.Fatalf("want plaintext-file error, got %v", err)
	}
	// Encrypted-at-rest keypair file is allowed.
	t.Setenv("ORACLE_KEYPAIR_ENCRYPTION_KEY", strings.Repeat("a", 64))
	if err := ValidateSecurityPosture(); err != nil {
		t.Fatalf("encrypted keypair file should pass: %v", err)
	}
}

func TestPostureSigning_P2_KMSFlagTypoRejectedEverywhere(t *testing.T) {
	clearPostureEnv(t)
	t.Setenv("APP_ENV", "development")
	t.Setenv("USE_GCP_KMS", "ture")
	if err := ValidateSecurityPosture(); err == nil || !strings.Contains(err.Error(), "USE_GCP_KMS") {
		t.Fatalf("want typo rejection, got %v", err)
	}
}
