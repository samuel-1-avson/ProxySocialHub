package solana

import (
	"crypto/ed25519"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	sol "github.com/gagliardetto/solana-go"
)

func writeSolanaKeypair(t *testing.T, path string, seed []byte) {
	t.Helper()
	if len(seed) != 32 {
		t.Fatalf("seed must be 32 bytes, got %d", len(seed))
	}
	priv := ed25519.NewKeyFromSeed(seed) // 64 bytes: seed || pubkey
	raw, err := json.Marshal([]byte(priv))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestValidateCustodySeparationRequiresSplitInProd(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("ORACLE_KEYPAIR_ENCRYPTION_KEY", "")

	dir := t.TempDir()
	oraclePath := filepath.Join(dir, "oracle.json")
	treasuryPath := filepath.Join(dir, "treasury.json")

	seed := make([]byte, 32)
	for i := range seed {
		seed[i] = 1
	}
	writeSolanaKeypair(t, oraclePath, seed)
	writeSolanaKeypair(t, treasuryPath, seed) // identical → must fail in prod

	_, err := NewOracleClient(Config{
		RPCEndpoints:           []string{"https://api.devnet.solana.com"},
		OracleKeypairPath:      oraclePath,
		TreasuryHotKeypairPath: treasuryPath,
		Network:                "devnet",
	})
	if err == nil {
		t.Fatal("expected BC-08 error when oracle == treasury hot in production")
	}
}

func TestValidateCustodySeparationRequiresTreasuryInStaging(t *testing.T) {
	t.Setenv("APP_ENV", "staging")
	t.Setenv("ORACLE_KEYPAIR_ENCRYPTION_KEY", "")

	dir := t.TempDir()
	oraclePath := filepath.Join(dir, "oracle.json")
	seed := make([]byte, 32)
	for i := range seed {
		seed[i] = 9
	}
	writeSolanaKeypair(t, oraclePath, seed)

	_, err := NewOracleClient(Config{
		RPCEndpoints:      []string{"https://api.devnet.solana.com"},
		OracleKeypairPath: oraclePath,
		Network:           "devnet",
	})
	if err == nil {
		t.Fatal("expected BC-08 error when treasury hot keypair missing in staging")
	}
}


func TestGetPayoutPublicKeyUsesTreasuryHot(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv("ORACLE_KEYPAIR_ENCRYPTION_KEY", "")

	dir := t.TempDir()
	oraclePath := filepath.Join(dir, "oracle.json")
	treasuryPath := filepath.Join(dir, "treasury.json")
	oracleSeed := make([]byte, 32)
	treasurySeed := make([]byte, 32)
	for i := range oracleSeed {
		oracleSeed[i] = 3
		treasurySeed[i] = 4
	}
	writeSolanaKeypair(t, oraclePath, oracleSeed)
	writeSolanaKeypair(t, treasuryPath, treasurySeed)

	client, err := NewOracleClient(Config{
		RPCEndpoints:           []string{"https://api.devnet.solana.com"},
		OracleKeypairPath:      oraclePath,
		TreasuryHotKeypairPath: treasuryPath,
		Network:                "devnet",
	})
	if err != nil {
		t.Fatalf("NewOracleClient: %v", err)
	}
	if !client.HasSeparateTreasuryHot() {
		t.Fatal("expected HasSeparateTreasuryHot")
	}
	if client.GetPayoutPublicKey().Equals(client.GetOraclePublicKey()) {
		t.Fatal("payout pubkey must differ from oracle")
	}
}

func TestGetPayoutPublicKeyPrefersHotHSM(t *testing.T) {
	oracleSeed := make([]byte, 32)
	hotSeed := make([]byte, 32)
	for i := range oracleSeed {
		oracleSeed[i] = 5
		hotSeed[i] = 6
	}
	oraclePriv := ed25519.NewKeyFromSeed(oracleSeed)
	hotPriv := ed25519.NewKeyFromSeed(hotSeed)
	oraclePK := solPrivateFromEd25519(oraclePriv)
	hotPK := solPrivateFromEd25519(hotPriv)

	client := &OracleClient{
		hsm:            NewMockHSMSigner(oraclePK),
		hotHsm:         NewMockHSMSigner(hotPK),
		treasuryHotKey: nil, // KMS-only hot
	}
	if !client.HasSeparateTreasuryHot() {
		t.Fatal("expected HasSeparateTreasuryHot with hotHsm")
	}
	if !client.GetPayoutPublicKey().Equals(hotPK.PublicKey()) {
		t.Fatalf("payout=%s want hot=%s", client.GetPayoutPublicKey(), hotPK.PublicKey())
	}
	if err := client.validateCustodySeparation(); err != nil {
		t.Fatalf("validateCustodySeparation: %v", err)
	}
}

func solPrivateFromEd25519(priv ed25519.PrivateKey) sol.PrivateKey {
	out := make(sol.PrivateKey, len(priv))
	copy(out, priv)
	return out
}
