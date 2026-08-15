package marketplace

import (
	"crypto/ed25519"
	"crypto/rand"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/proofs"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

func capabilitySeed(t *testing.T) string {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	return base58.Encode(priv.Seed())
}

func TestAttachSessionCapability_observeBindsToken(t *testing.T) {
	t.Setenv("PROXYHUB_SESSION_CAPABILITY", "observe")
	secret := capabilitySeed(t)
	t.Setenv("PROXYHUB_SESSION_CAPABILITY_SIGNING_KEY", secret)

	orderID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	sessionID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	buyerID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	listingID := uuid.MustParse("44444444-4444-4444-4444-444444444444")

	order := &models.Order{ID: orderID, BuyerID: buyerID, ListingID: listingID}
	session := &models.Session{
		ID:              sessionID,
		CredentialsUser: "buyer-cred-user",
		CredentialsPass: "buyer-cred-pass",
		BandwidthLimit:  5000,
	}
	listing := &models.ProxyListing{ID: listingID, ListingOfferHash: "aa" + "bb"}
	data := &redisClient.SessionData{
		UserID:    buyerID.String(),
		SessionID: sessionID.String(),
		ListingID: listingID.String(),
		ExpiresAt: time.Unix(1_700_000_000+3600, 0).UTC(),
	}
	if err := AttachSessionCapability(data, order, session, listing); err != nil {
		t.Fatalf("AttachSessionCapability: %v", err)
	}
	if data.CapabilitySignature == "" || data.CapabilityIssuerPubkey == "" {
		t.Fatal("expected capability fields")
	}
	if data.CapabilityOfferHash != "aabb" {
		t.Fatalf("offer hash: %q", data.CapabilityOfferHash)
	}
	p := proofs.SessionCapabilityPayload{
		SessionID:      sessionID.String(),
		OfferHash:      data.CapabilityOfferHash,
		BuyerID:        buyerID.String(),
		ExpiresAt:      data.CapabilityExpiresAt,
		BandwidthLimit: data.CapabilityBandwidthLimit,
		OperatorPubkey: data.CapabilityOperatorPubkey,
		UsernameHash:   data.CapabilityUsernameHash,
		IssuedAt:       data.CapabilityIssuedAt,
	}
	if !proofs.VerifySessionCapabilitySignature(p, data.CapabilitySignature, data.CapabilityIssuerPubkey) {
		t.Fatal("verify failed")
	}
	if data.CapabilityToken == "" || !proofs.LooksLikeSessionCapabilityToken(data.CapabilityToken) {
		t.Fatal("expected compact CONNECT token")
	}
}

func TestAttachSessionCapability_enforceFailsWithoutKey(t *testing.T) {
	t.Setenv("PROXYHUB_SESSION_CAPABILITY", "enforce")
	t.Setenv("PROXYHUB_SESSION_CAPABILITY_SIGNING_KEY", "")
	order := &models.Order{ID: uuid.New(), BuyerID: uuid.New(), ListingID: uuid.New()}
	session := &models.Session{ID: uuid.New(), CredentialsUser: "u", CredentialsPass: "p"}
	data := &redisClient.SessionData{ExpiresAt: time.Now().Add(time.Hour)}
	if err := AttachSessionCapability(data, order, session, nil); err == nil {
		t.Fatal("expected enforce failure without signing key")
	}
}

func TestAttachSessionCapability_offSkips(t *testing.T) {
	t.Setenv("PROXYHUB_SESSION_CAPABILITY", "off")
	t.Setenv("PROXYHUB_SESSION_CAPABILITY_SIGNING_KEY", capabilitySeed(t))
	order := &models.Order{ID: uuid.New(), BuyerID: uuid.New(), ListingID: uuid.New()}
	session := &models.Session{ID: uuid.New(), CredentialsUser: "u", CredentialsPass: "p"}
	data := &redisClient.SessionData{ExpiresAt: time.Now().Add(time.Hour)}
	if err := AttachSessionCapability(data, order, session, nil); err != nil {
		t.Fatalf("off must skip: %v", err)
	}
	if data.CapabilitySignature != "" {
		t.Fatal("off must not attach")
	}
}

func TestIssueSessionCapabilityToken_enforce(t *testing.T) {
	t.Setenv("PROXYHUB_SESSION_CAPABILITY", "enforce")
	t.Setenv("PROXYHUB_SESSION_CAPABILITY_SIGNING_KEY", capabilitySeed(t))
	listingID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	order := &models.Order{ID: uuid.New(), BuyerID: uuid.New(), ListingID: listingID}
	session := &models.Session{
		ID:              uuid.New(),
		CredentialsUser: "w7c-user",
		CredentialsPass: "legacy-pass",
		BandwidthLimit:  4096,
	}
	listing := &models.ProxyListing{ID: listingID, ListingOfferHash: "deadbeef"}
	wire, err := IssueSessionCapabilityToken(order, session, listing)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	tok, err := proofs.DecodeSessionCapabilityToken(wire)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !proofs.VerifySessionCapabilitySignature(tok.Payload(), tok.Signature, tok.IssuerPubkey) {
		t.Fatal("issued token must verify")
	}
}
