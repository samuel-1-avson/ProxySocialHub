package billing

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"testing"
)

func TestVerifySignatureRejectsEmptyOutsideDevAllow(t *testing.T) {
	t.Setenv("ALLOW_UNSIGNED_USAGE", "")
	t.Setenv("APP_ENV", "production")
	t.Setenv("GATEWAY_USAGE_PUBLIC_KEY", "")

	a := NewAggregator()
	err := a.VerifySignature("sess-user", 1, 2, 3, "")
	if err == nil {
		t.Fatal("expected empty signature to be rejected in production")
	}
}

func TestVerifySignatureAllowsUnsignedInDevWhenFlagged(t *testing.T) {
	t.Setenv("ALLOW_UNSIGNED_USAGE", "true")
	t.Setenv("APP_ENV", "development")
	t.Setenv("GATEWAY_USAGE_PUBLIC_KEY", "")

	a := NewAggregator()
	if err := a.VerifySignature("sess-user", 1, 2, 3, ""); err != nil {
		t.Fatalf("expected allow in development: %v", err)
	}
}

func TestVerifySignatureRejectsUnsignedFlagInProduction(t *testing.T) {
	t.Setenv("ALLOW_UNSIGNED_USAGE", "true")
	t.Setenv("APP_ENV", "production")
	t.Setenv("GATEWAY_USAGE_PUBLIC_KEY", "")

	a := NewAggregator()
	if err := a.VerifySignature("sess-user", 1, 2, 3, ""); err == nil {
		t.Fatal("ALLOW_UNSIGNED_USAGE must not apply in production")
	}
}

// Fail-closed regression tests: an opaque (unverifiable) non-empty signature must
// never be accepted when no verification key can be resolved. This guards billing
// against forged usage reports under the gateway-auth-only path.

func TestVerifySignatureRejectsOpaqueSignatureWithoutKeyMaterial(t *testing.T) {
	t.Setenv("ALLOW_UNSIGNED_USAGE", "")
	t.Setenv("APP_ENV", "production")
	t.Setenv("GATEWAY_USAGE_PUBLIC_KEY", "")

	a := NewAggregator()
	// 64 bytes of garbage — structurally a valid Ed25519 signature size, but
	// unverifiable and previously soft-accepted under gateway auth.
	opaqueSig := hex.EncodeToString(make([]byte, ed25519.SignatureSize))
	if err := a.VerifySignature("sess-user", 1, 2, 3, opaqueSig); err == nil {
		t.Fatal("opaque signature must be rejected when no verification key is available")
	}
}

func TestVerifySignatureRejectsInvalidSignatureWithGatewayKey(t *testing.T) {
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	t.Setenv("ALLOW_UNSIGNED_USAGE", "")
	t.Setenv("APP_ENV", "production")
	t.Setenv("GATEWAY_USAGE_PUBLIC_KEY", hex.EncodeToString(pub))

	a := NewAggregator()
	opaqueSig := hex.EncodeToString(make([]byte, ed25519.SignatureSize))
	if err := a.VerifySignature("sess-user", 1, 2, 3, opaqueSig); err == nil {
		t.Fatal("forged signature must be rejected when gateway key is configured")
	}
}

func TestVerifySignatureAcceptsValidSignatureWithGatewayKey(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	t.Setenv("ALLOW_UNSIGNED_USAGE", "")
	t.Setenv("APP_ENV", "production")
	t.Setenv("GATEWAY_USAGE_PUBLIC_KEY", hex.EncodeToString(pub))

	var up, down int64 = 123, 456
	var nonce uint64 = 789
	msg := fmt.Sprintf("%s:%d:%d:%d", "sess-user", up, down, nonce)
	sig := ed25519.Sign(priv, []byte(msg))

	a := NewAggregator()
	if err := a.VerifySignature("sess-user", up, down, nonce, hex.EncodeToString(sig)); err != nil {
		t.Fatalf("valid signature must be accepted: %v", err)
	}
}

func TestVerifySignatureRejectsTamperedByteCounts(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	t.Setenv("ALLOW_UNSIGNED_USAGE", "")
	t.Setenv("APP_ENV", "production")
	t.Setenv("GATEWAY_USAGE_PUBLIC_KEY", hex.EncodeToString(pub))

	var up, down int64 = 123, 456
	var nonce uint64 = 789
	msg := fmt.Sprintf("%s:%d:%d:%d", "sess-user", up, down, nonce)
	sig := ed25519.Sign(priv, []byte(msg))

	a := NewAggregator()
	// Signature was made over 123/456 — a tampered report of 124/456 must fail.
	if err := a.VerifySignature("sess-user", up+1, down, nonce, hex.EncodeToString(sig)); err == nil {
		t.Fatal("signature over tampered byte counts must be rejected")
	}
}
