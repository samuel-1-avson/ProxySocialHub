package providerlease

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestIssueAndValidateProviderLease(t *testing.T) {
	t.Setenv("PROVIDER_LEASE_TTL_SECONDS", "120")
	secret := "provider-lease-secret"

	token, claims, err := Issue(secret, Params{
		UserID:            uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		ConnectionType:    "residential",
		AvailablePorts:    []uint16{80, 443},
		MaxConnections:    250,
		MaxBandwidthMbps:  500,
		UplinkSpeedKbps:   250000,
		DownlinkSpeedKbps: 500000,
		CPUCores:          8,
		MemoryMB:          16384,
		OS:                "linux",
		ClientVersion:     "1.2.3",
		Features:          []string{"ipv4", "tls_tunnel"},
	})
	if err != nil {
		t.Fatalf("Issue returned error: %v", err)
	}

	parsed, err := ParseAndValidate(token, secret)
	if err != nil {
		t.Fatalf("ParseAndValidate returned error: %v", err)
	}
	if parsed.UserID != claims.UserID {
		t.Fatalf("expected user id %s, got %s", claims.UserID, parsed.UserID)
	}
	if parsed.ConnectionType != "residential" {
		t.Fatalf("expected connection type to round-trip")
	}
	if parsed.ExpiresAt == nil || time.Until(parsed.ExpiresAt.Time) <= 0 {
		t.Fatal("expected future expiry")
	}
}
