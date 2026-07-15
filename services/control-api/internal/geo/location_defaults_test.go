package geo

import "testing"

func TestNormalizeProviderLocationGhanaEmptyCity(t *testing.T) {
	country, city := NormalizeProviderLocation("GH", "")
	if country != "GH" || city != "" {
		t.Fatalf("got country=%q city=%q, want GH and empty city for IP snap", country, city)
	}
}

func TestNormalizeProviderLocationUnknownCity(t *testing.T) {
	country, city := NormalizeProviderLocation("Ghana", "Unknown")
	if country != "GH" {
		t.Fatalf("got country=%q, want GH for full country name", country)
	}
	if city != "" {
		t.Fatalf("got city=%q, want empty for IP snap", city)
	}
}

func TestNormalizeProviderLocationDropsUnknownCountryName(t *testing.T) {
	country, _ := NormalizeProviderLocation("Atlantis", "Unknown")
	if country != "" {
		t.Fatalf("got country=%q, want empty for unknown full country name", country)
	}
}

func TestNormalizeCountryCodeISO3(t *testing.T) {
	if got := NormalizeCountryCode("GHA"); got != "GH" {
		t.Fatalf("got %q, want GH", got)
	}
}

func TestNormalizeProviderLocationPreservesExplicitCity(t *testing.T) {
	_, city := NormalizeProviderLocation("GH", "Kumasi")
	if city != "Kumasi" {
		t.Fatalf("got city=%q, want Kumasi", city)
	}
}
