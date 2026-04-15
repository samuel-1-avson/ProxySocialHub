package sessionintent

import (
	"os"
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

func TestResolveSigningSecretPrefersGatewaySecret(t *testing.T) {
	t.Setenv("JWT_SECRET", "jwt-secret")
	t.Setenv("GATEWAY_SHARED_SECRET", "gateway-secret")

	secret, err := ResolveSigningSecret()
	if err != nil {
		t.Fatalf("ResolveSigningSecret returned error: %v", err)
	}
	if secret != "gateway-secret" {
		t.Fatalf("expected gateway secret, got %s", secret)
	}
}

func TestResolveSigningSecretErrorsWhenMissing(t *testing.T) {
	os.Unsetenv("JWT_SECRET")
	os.Unsetenv("GATEWAY_SHARED_SECRET")

	if _, err := ResolveSigningSecret(); err == nil {
		t.Fatal("expected error when no signing secret is configured")
	}
}
