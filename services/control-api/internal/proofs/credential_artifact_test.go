package proofs

import (
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestHashOrderCredentialStable(t *testing.T) {
	p := OrderCredentialPayload{
		OrderID:      uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		SessionID:    uuid.MustParse("22222222-2222-2222-2222-222222222222"),
		BuyerID:      uuid.MustParse("33333333-3333-3333-3333-333333333333"),
		ListingID:    uuid.MustParse("44444444-4444-4444-4444-444444444444"),
		UsernameHash: HashCredentialsUsername("abc12345"),
		IssuedAt:     1700000000,
		ExpiresAt:    1700086400,
	}
	a := HashOrderCredentialPayload(p)
	b := HashOrderCredentialPayload(p)
	if a != b || len(a) != 64 {
		t.Fatalf("unstable hash: %q", a)
	}
	p.UsernameHash = HashCredentialsUsername("other")
	if HashOrderCredentialPayload(p) == a {
		t.Fatal("expected hash change")
	}
}

func TestBuildAndVerifyOrderCredential(t *testing.T) {
	t.Setenv("SESSION_SECRET", "test-session-secret-32-bytes-min!!")
	p := OrderCredentialPayload{
		OrderID:      uuid.New(),
		SessionID:    uuid.New(),
		BuyerID:      uuid.New(),
		ListingID:    uuid.New(),
		UsernameHash: HashCredentialsUsername("user1"),
		IssuedAt:     time.Now().UTC().Unix(),
		ExpiresAt:    time.Now().UTC().Unix() + 3600,
	}
	art := BuildOrderCredentialArtifact(p, "observe")
	if art == nil || art.Signature == "" || art.SignerKind != "hmac_session_secret" {
		t.Fatalf("artifact: %+v", art)
	}
	if !VerifyOrderCredentialHMAC(art, os.Getenv("SESSION_SECRET")) {
		t.Fatal("verify failed")
	}
	art.Signature = "deadbeef"
	if VerifyOrderCredentialHMAC(art, os.Getenv("SESSION_SECRET")) {
		t.Fatal("expected verify fail")
	}
}
