package proofs

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/mr-tron/base58"
)

func testCapabilitySeed(t *testing.T) string {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	return base58.Encode(priv.Seed())
}

func TestSessionCapabilityGoldenCanonical(t *testing.T) {
	p := SessionCapabilityPayload{
		SessionID:      "22222222-2222-2222-2222-222222222222",
		OfferHash:      "aabb",
		BuyerID:        "33333333-3333-3333-3333-333333333333",
		ExpiresAt:      1700086400,
		BandwidthLimit: 1024,
		OperatorPubkey: "opk",
		UsernameHash:   "uh",
		IssuedAt:       1700000000,
	}
	got := string(CanonicalSessionCapabilityBytes(p))
	want := "PROXYHUB_SESSION_CAPABILITY:v1:22222222-2222-2222-2222-222222222222|aabb|33333333-3333-3333-3333-333333333333|1700086400|1024|opk|uh|1700000000"
	if got != want {
		t.Fatalf("canonical\n got %q\nwant %q", got, want)
	}
}

func TestCanonicalSessionCapabilityStable(t *testing.T) {
	p := SessionCapabilityPayload{
		SessionID:      "22222222-2222-2222-2222-222222222222",
		OfferHash:      "abcd",
		BuyerID:        "33333333-3333-3333-3333-333333333333",
		ExpiresAt:      1700086400,
		BandwidthLimit: 1024,
		OperatorPubkey: "opk",
		UsernameHash:   HashCredentialsUsername("buyer-cred-user"),
		IssuedAt:       1700000000,
	}
	a := string(CanonicalSessionCapabilityBytes(p))
	b := string(CanonicalSessionCapabilityBytes(p))
	if a != b {
		t.Fatal("unstable canonical bytes")
	}
	wantPrefix := SessionCapabilityPrefix
	if a[:len(wantPrefix)] != wantPrefix {
		t.Fatalf("prefix: %q", a)
	}
	p.BandwidthLimit = 2048
	if string(CanonicalSessionCapabilityBytes(p)) == a {
		t.Fatal("expected canonical change")
	}
}

func TestSignAndVerifySessionCapability(t *testing.T) {
	secret := testCapabilitySeed(t)
	p := SessionCapabilityPayload{
		SessionID:      uuid.MustParse("22222222-2222-2222-2222-222222222222").String(),
		OfferHash:      "listing-or-hash",
		BuyerID:        uuid.MustParse("33333333-3333-3333-3333-333333333333").String(),
		ExpiresAt:      time.Now().UTC().Unix() + 3600,
		BandwidthLimit: 1_000_000,
		UsernameHash:   HashCredentialsUsername("buyer-cred-user"),
		IssuedAt:       time.Now().UTC().Unix(),
	}
	sig, issuer, err := SignSessionCapability(p, secret)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if issuer == "" || sig == "" {
		t.Fatal("empty sig/issuer")
	}
	p.OperatorPubkey = issuer
	if !VerifySessionCapabilitySignature(p, sig, issuer) {
		t.Fatal("verify failed")
	}
	p.BuyerID = uuid.New().String()
	if VerifySessionCapabilitySignature(p, sig, issuer) {
		t.Fatal("tamper must fail")
	}
}

func TestSessionCapabilityExpired(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	if !SessionCapabilityExpired(0, now) {
		t.Fatal("zero expiry is expired")
	}
	if SessionCapabilityExpired(now.Unix()+60, now) {
		t.Fatal("future must not be expired")
	}
	if !SessionCapabilityExpired(now.Unix()-1, now) {
		t.Fatal("past must be expired")
	}
}

func TestVerifyDoesNotNeedIssuerOnline(t *testing.T) {
	// W7.A unit claim: verify is local Ed25519 — no control-api / network.
	secret := testCapabilitySeed(t)
	p := SessionCapabilityPayload{
		SessionID:      uuid.New().String(),
		OfferHash:      uuid.New().String(),
		BuyerID:        uuid.New().String(),
		ExpiresAt:      time.Now().UTC().Unix() + 120,
		BandwidthLimit: 4096,
		UsernameHash:   HashCredentialsUsername("w7a-user"),
		IssuedAt:       time.Now().UTC().Unix(),
	}
	sig, issuer, err := SignSessionCapability(p, secret)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	p.OperatorPubkey = issuer
	if !VerifySessionCapabilitySignature(p, sig, issuer) {
		t.Fatal("local verify must succeed without an issuer process")
	}
}

func TestEncodeDecodeSessionCapabilityToken(t *testing.T) {
	secret := testCapabilitySeed(t)
	p := SessionCapabilityPayload{
		SessionID:      "22222222-2222-2222-2222-222222222222",
		OfferHash:      "aabb",
		BuyerID:        "33333333-3333-3333-3333-333333333333",
		ExpiresAt:      1700086400,
		BandwidthLimit: 1024,
		UsernameHash:   HashCredentialsUsername("buyer-cred-user"),
		IssuedAt:       1700000000,
	}
	sig, issuer, err := SignSessionCapability(p, secret)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	p.OperatorPubkey = issuer
	wire, err := EncodeSessionCapabilityToken(p, sig, issuer)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if !LooksLikeSessionCapabilityToken(wire) {
		t.Fatalf("prefix: %s", wire)
	}
	tok, err := DecodeSessionCapabilityToken(wire)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	got := tok.Payload()
	if !VerifySessionCapabilitySignature(got, tok.Signature, tok.IssuerPubkey) {
		t.Fatal("roundtrip verify failed")
	}
	if got.SessionID != p.SessionID || got.BandwidthLimit != p.BandwidthLimit {
		t.Fatalf("payload: %+v", got)
	}
}

func TestDecodeSessionCapabilityToken_badInputs(t *testing.T) {
	if _, err := DecodeSessionCapabilityToken("legacy-pass"); err == nil {
		t.Fatal("expected prefix error")
	}
	if _, err := DecodeSessionCapabilityToken("phubb1."); err == nil {
		t.Fatal("expected decode error")
	}
	raw := []byte(`{"v":"2","session_id":"s","offer_hash":"o","buyer_id":"b","expires_at":1,"bandwidth_limit":1,"operator_pubkey":"p","username_hash":"h","issued_at":1,"signature":"s","issuer_pubkey":"p"}`)
	wire := SessionCapabilityTokenPrefix + base64.RawURLEncoding.EncodeToString(raw)
	if _, err := DecodeSessionCapabilityToken(wire); err == nil {
		t.Fatal("expected version error")
	}
}
