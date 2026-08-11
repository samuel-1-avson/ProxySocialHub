package geoip

import (
	"net"
	"testing"
)

func TestIsLANIP(t *testing.T) {
	cases := []struct {
		ip   string
		want bool
	}{
		{"172.19.0.2", true},
		{"10.0.0.1", true},
		{"192.168.1.1", true},
		{"127.0.0.1", false}, // loopback handled separately
		{"203.0.113.10", false},
	}
	for _, tc := range cases {
		parsed := net.ParseIP(tc.ip)
		if got := IsLANIP(parsed); got != tc.want {
			t.Fatalf("IsLANIP(%s)=%v want %v", tc.ip, got, tc.want)
		}
	}
}

func TestNeedsPublicIPLookup(t *testing.T) {
	if !NeedsPublicIPLookup("") {
		t.Fatal("empty IP should need lookup")
	}
	if !NeedsPublicIPLookup("172.19.0.2") {
		t.Fatal("LAN IP should need lookup")
	}
	if NeedsPublicIPLookup("203.0.113.10") {
		t.Fatal("public IP should not need lookup")
	}
}

func TestNormalizeIPForGeoKeepsPublic(t *testing.T) {
	ip := NormalizeIPForGeo("203.0.113.10")
	if ip != "203.0.113.10" {
		t.Fatalf("got %q", ip)
	}
}

func TestNormalizeIPForGeoDoesNotSubstituteHostWAN(t *testing.T) {
	// Previously replaced LAN peers with DetectPublicIP() (control-api WAN).
	got := NormalizeIPForGeo("172.19.0.2")
	if got != "172.19.0.2" {
		t.Fatalf("LAN IP must stay unchanged, got %q", got)
	}
	if PublicIPForGeo("172.19.0.2") != "" {
		t.Fatal("LAN IP is not usable for GeoIP")
	}
	if PublicIPForGeo("203.0.113.10") != "203.0.113.10" {
		t.Fatal("public IP should pass through PublicIPForGeo")
	}
}

func TestProviderIPForStorageRejectsLAN(t *testing.T) {
	if ProviderIPForStorage("172.19.0.2") != "" {
		t.Fatal("LAN IP must not be stored as provider egress")
	}
	if ProviderIPForStorage("203.0.113.10") != "203.0.113.10" {
		t.Fatal("documentation public IP should be storable")
	}
}

func TestIsUntrustedGatewayGeoCloudISP(t *testing.T) {
	if !IsUntrustedGatewayGeo("203.0.113.10", "Google LLC") {
		t.Fatal("Google LLC ISP must be untrusted for gateway geo")
	}
	if IsUntrustedGatewayGeo("203.0.113.10", "Scancom MTNGhana") {
		t.Fatal("residential ISP must remain trusted without cloud Resolve")
	}
}

func TestControlPlanePublicIPsFromEnv(t *testing.T) {
	rememberControlPlaneIP("35.255.62.196")
	if !IsControlPlanePublicIP("35.255.62.196") {
		t.Fatal("remembered control-plane IP must match")
	}
}

func TestNormalizeCountryCodeUsesISO2(t *testing.T) {
	cases := map[string]string{
		"Ghana":                    "GH",
		"GHA":                      "GH",
		"United States of America": "US",
		"United Kingdom":           "GB",
		"Atlantis":                 "",
	}
	for input, want := range cases {
		if got := normalizeCountryCode(input); got != want {
			t.Fatalf("normalizeCountryCode(%q)=%q want %q", input, got, want)
		}
	}
}
