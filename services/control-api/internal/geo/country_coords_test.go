package geo

import "testing"

func TestCountryCentroid(t *testing.T) {
	lat, lon, ok := CountryCentroid("US", "node:abc")
	if !ok || lat == 0 || lon == 0 {
		t.Fatalf("expected US centroid, got %v %v %v", lat, lon, ok)
	}
}

func TestCountryCentroidStablePerAnchor(t *testing.T) {
	lat1, lon1, ok1 := CountryCentroid("GH", "node:shared")
	lat2, lon2, ok2 := CountryCentroid("GH", "node:shared")
	if !ok1 || !ok2 || lat1 != lat2 || lon1 != lon2 {
		t.Fatalf("same anchor should share coords, got (%v,%v) vs (%v,%v)", lat1, lon1, lat2, lon2)
	}
	lat3, lon3, ok3 := CountryCentroid("GH", "node:other")
	if !ok3 || (lat3 == lat1 && lon3 == lon1) {
		t.Fatalf("different anchors should not always collide")
	}
}

func TestCityCentroidAccra(t *testing.T) {
	lat, lon, ok := CityCentroid("Accra", "GH")
	if !ok || lat < 5 || lon > 0 {
		t.Fatalf("expected Accra coords, got %v %v %v", lat, lon, ok)
	}
}

func TestApplyListingCoordsSnapsToRegionalHub(t *testing.T) {
	lat, lon, ok := ApplyListingCoords(6.72, -1.61, "GH", "", "node:x")
	if !ok || lat != 6.6885 {
		t.Fatalf("expected Kumasi regional hub, got %v %v %v", lat, lon, ok)
	}
}

func TestApplyListingCoordsSameNodeSharesCoords(t *testing.T) {
	anchor := "node:41982abb"
	lat1, lon1, ok1 := ApplyListingCoords(0, 0, "GH", "", anchor)
	lat2, lon2, ok2 := ApplyListingCoords(0, 0, "GH", "", anchor)
	if !ok1 || !ok2 || lat1 != lat2 || lon1 != lon2 {
		t.Fatalf("listings on same node should share fallback coords")
	}
}
