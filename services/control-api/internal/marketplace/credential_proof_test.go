package marketplace

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/proofs"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

func TestAttachCredentialProof_enforceBindsHMAC(t *testing.T) {
	t.Setenv("PROXYHUB_CREDENTIAL_PROOF", "enforce")
	t.Setenv("SESSION_SECRET", "test-session-secret")
	t.Setenv("GATEWAY_SHARED_SECRET", "")

	orderID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	sessionID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	buyerID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	listingID := uuid.MustParse("44444444-4444-4444-4444-444444444444")

	order := &models.Order{ID: orderID, BuyerID: buyerID, ListingID: listingID}
	session := &models.Session{
		ID:              sessionID,
		CredentialsUser: "buyer-cred-user",
		CredentialsPass: "buyer-cred-pass",
	}
	data := &redisClient.SessionData{
		UserID:    buyerID.String(),
		SessionID: sessionID.String(),
		ListingID: listingID.String(),
		ExpiresAt: time.Unix(1_700_000_000+3600, 0).UTC(),
		CreatedAt: time.Unix(1_700_000_000, 0).UTC(),
	}
	// Force issued/expires via ExpiresAt; IssuedAt comes from now — just check bind + verify.
	if err := AttachCredentialProof(data, order, session); err != nil {
		t.Fatalf("AttachCredentialProof: %v", err)
	}
	if data.CredentialProofSignature == "" || data.CredentialProofPayloadHash == "" {
		t.Fatal("expected proof fields")
	}
	if data.CredentialProofUsernameHash != proofs.HashCredentialsUsername("buyer-cred-user") {
		t.Fatal("username hash mismatch")
	}
	art := &proofs.OrderCredentialArtifact{
		PayloadHash: data.CredentialProofPayloadHash,
		Signature:   data.CredentialProofSignature,
	}
	if !proofs.VerifyOrderCredentialHMAC(art, "test-session-secret") {
		t.Fatal("HMAC verify failed")
	}
}

func TestAttachCredentialProof_enforceFailsWithoutSecret(t *testing.T) {
	t.Setenv("PROXYHUB_CREDENTIAL_PROOF", "enforce")
	t.Setenv("SESSION_SECRET", "")
	t.Setenv("GATEWAY_SHARED_SECRET", "")
	order := &models.Order{ID: uuid.New(), BuyerID: uuid.New(), ListingID: uuid.New()}
	session := &models.Session{ID: uuid.New(), CredentialsUser: "u", CredentialsPass: "p"}
	data := &redisClient.SessionData{ExpiresAt: time.Now().Add(time.Hour)}
	if err := AttachCredentialProof(data, order, session); err == nil {
		t.Fatal("expected enforce failure without secret")
	}
}
