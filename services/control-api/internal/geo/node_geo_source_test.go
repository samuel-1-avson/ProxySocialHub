package geo

import "testing"

func TestResolveNodeMapGeoSource_ExplorerGPS(t *testing.T) {
	got := ResolveNodeMapGeoSource("XX", "", "", 40.7, -74.0, "unknown")
	if got != "explorer" {
		t.Fatalf("expected explorer, got %q", got)
	}
}

func TestResolveNodeMapGeoSource_RegionalHubCity(t *testing.T) {
	got := ResolveNodeMapGeoSource("US", "New York", "us-east", 0, 0, "region_hub")
	if got != "region_hub" {
		t.Fatalf("expected region_hub, got %q", got)
	}
}
