package topology

import "testing"

func TestResolveTargetGeoEndpoint_CountryCode(t *testing.T) {
	ep, ok := ResolveTargetGeoEndpoint("US", "")
	if !ok {
		t.Fatal("expected US target to resolve")
	}
	if ep.ID == "" || ep.Lat == 0 && ep.Lon == 0 {
		t.Fatalf("unexpected endpoint: %+v", ep)
	}
}

func TestResolveTargetGeoEndpoint_CountryRegion(t *testing.T) {
	ep, ok := ResolveTargetGeoEndpoint("US:virginia", "")
	if !ok {
		t.Fatal("expected US:virginia target to resolve")
	}
	if ep.ID == "" {
		t.Fatalf("empty id for %+v", ep)
	}
}

func TestLabelFromRegionID(t *testing.T) {
	if got := LabelFromRegionID("US:virginia"); got != "Virginia, US" {
		t.Fatalf("label = %q", got)
	}
	if got := LabelFromRegionID("DE"); got != "DE" {
		t.Fatalf("label = %q", got)
	}
}

func TestResolveRegionEndpoint_SameSourceTargetSkippedInAgg(t *testing.T) {
	source, ok := ResolveRegionEndpoint("US", "", "virginia", 0, 0, "a")
	if !ok {
		t.Fatal("source failed")
	}
	target, ok := ResolveTargetGeoEndpoint("US", "")
	if !ok {
		t.Fatal("target failed")
	}
	if source.ID == target.ID {
		t.Fatalf("expected distinct endpoints for aggregation test, got %q", source.ID)
	}
}
