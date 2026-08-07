package sessionintent

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestIssueAndValidateSessionIntent(t *testing.T) {
	t.Setenv("SESSION_INTENT_TTL_SECONDS", "120")
	secret := "test-shared-secret"

	token, claims, err := Issue(secret, Params{
		UserID:                  uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		ListingID:               "listing-123",
		SessionType:             "sticky",
		TrustTier:               "premium",
		BandwidthLimit:          1024,
		TargetGeo:               "US",
		TargetISP:               "FiberCo",
		AllowedDomains:          []string{"example.com"},
		BlockedDomains:          []string{"blocked.example"},
		RotationType:            "time-based",
		RotationIntervalSeconds: 60,
		TimeLimitMinutes:        15,
		PreferredTier:           "Gold",
		RequestsPerMinute:       1000,
		MaxConcurrency:          100,
		MaxPricePerGB:           0.25,
	})
	if err != nil {
		t.Fatalf("Issue returned error: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}

	parsed, err := ParseAndValidate(token, secret)
	if err != nil {
		t.Fatalf("ParseAndValidate returned error: %v", err)
	}
	if parsed.UserID != claims.UserID {
		t.Fatalf("expected user id %s, got %s", claims.UserID, parsed.UserID)
	}
	if parsed.ListingID != "listing-123" {
		t.Fatalf("expected listing id to round-trip")
	}
	if parsed.RequestsPerMinute != 1000 {
		t.Fatalf("expected rpm to round-trip")
	}
	if parsed.ExpiresAt == nil || time.Until(parsed.ExpiresAt.Time) <= 0 {
		t.Fatal("expected future expiry")
	}
}

func TestResolveSigningSecretUsesSessionSecret(t *testing.T) {
	t.Setenv("JWT_SECRET", "jwt-secret")
	t.Setenv("GATEWAY_SHARED_SECRET", "gateway-secret")
	t.Setenv("SESSION_SECRET", "session-secret")

	secret, err := ResolveSigningSecret()
	if err != nil {
		t.Fatalf("ResolveSigningSecret returned error: %v", err)
	}
	if secret != "session-secret" {
		t.Fatalf("expected session secret, got %s", secret)
	}
}

func TestResolveTTLDefaultIsThirtyMinutes(t *testing.T) {
	t.Setenv("SESSION_INTENT_TTL_SECONDS", "")
	ttl := ResolveTTL()
	if ttl != 30*time.Minute {
		t.Fatalf("expected 30m default TTL, got %s", ttl)
	}
}

func TestIssueWithIDPreservesIntentID(t *testing.T) {
	t.Setenv("SESSION_INTENT_TTL_SECONDS", "1800")
	secret := "test-shared-secret"
	intentID := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	token, claims, err := IssueWithID(secret, Params{
		UserID:         uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		SessionType:    "rotating",
		TrustTier:      "standard",
		BandwidthLimit: 1024,
	}, intentID)
	if err != nil {
		t.Fatalf("IssueWithID: %v", err)
	}
	if claims.ID != intentID.String() {
		t.Fatalf("expected jti %s, got %s", intentID, claims.ID)
	}
	parsed, err := ParseAndValidate(token, secret)
	if err != nil {
		t.Fatalf("ParseAndValidate: %v", err)
	}
	if parsed.ID != intentID.String() {
		t.Fatalf("parsed jti mismatch")
	}
}

