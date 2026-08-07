package solana

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"testing"
)

func TestSolanaPubkeyFromPEM_Ed25519(t *testing.T) {
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})
	pk, err := solanaPubkeyFromPEM(string(pemBytes))
	if err != nil {
		t.Fatal(err)
	}
	if pk.String() == "" {
		t.Fatal("empty pubkey")
	}
	for i := 0; i < 32; i++ {
		if pk[i] != pub[i] {
			t.Fatalf("byte mismatch at %d", i)
		}
	}
}

func TestNewGCPKMSSigner_RequiresKeyName(t *testing.T) {
	_, err := NewGCPKMSSigner(t.Context(), "", "")
	if err == nil {
		t.Fatal("expected error for empty key name")
	}
	_, err = NewGCPKMSSigner(t.Context(), "projects/p/locations/l/keyRings/r/cryptoKeys/k", "")
	if err == nil || err.Error() == "" {
		// Missing version path should fail before ADC in most cases
		t.Log(err)
	}
	if err == nil {
		t.Fatal("expected error when cryptoKeyVersions missing")
	}
}

func TestGCPKMSStrictEnv(t *testing.T) {
	t.Setenv("APP_ENV", "staging")
	t.Setenv("PROXYHUB_REQUIRE_GCP_KMS", "")
	if !gcpKMSStrictEnv() {
		t.Fatal("staging should be strict")
	}
	t.Setenv("APP_ENV", "development")
	t.Setenv("PROXYHUB_REQUIRE_GCP_KMS", "true")
	if !gcpKMSStrictEnv() {
		t.Fatal("REQUIRE flag should be strict")
	}
	t.Setenv("APP_ENV", "development")
	t.Setenv("PROXYHUB_REQUIRE_GCP_KMS", "false")
	if gcpKMSStrictEnv() {
		t.Fatal("dev without require should not be strict")
	}
}
