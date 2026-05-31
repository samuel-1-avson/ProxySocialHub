package geo

import "testing"

func TestCountryCentroid(t *testing.T) {
	lat, lon, ok := CountryCentroid("US", 0)
	if !ok || lat == 0 || lon == 0 {
		t.Fatalf("expected US centroid, got %v %v %v", lat, lon, ok)
	}
}

func TestApplyListingCoordsPrefersGPS(t *testing.T) {
	lat, lon, ok := ApplyListingCoords(40.7, -74.0, "", 0)
	if !ok || lat != 40.7 || lon != -74.0 {
		t.Fatalf("expected GPS coords, got %v %v %v", lat, lon, ok)
	}
}
