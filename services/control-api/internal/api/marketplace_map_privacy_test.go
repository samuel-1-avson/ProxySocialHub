package api

import "testing"

func TestMapOpaqueIDStable(t *testing.T) {
	a := mapOpaqueID("node", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	b := mapOpaqueID("node", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	c := mapOpaqueID("node", "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee")
	if a == "" || a != b {
		t.Fatalf("expected stable opaque id, got %q vs %q", a, b)
	}
	if a == c {
		t.Fatal("expected different ids for different inputs")
	}
	if len(a) != 16 {
		t.Fatalf("expected 16 hex chars, got %d (%q)", len(a), a)
	}
}

func TestCoarseNetworkClass(t *testing.T) {
	cases := map[string]string{
		coarseNetworkClass("residential", ""): "residential",
		coarseNetworkClass("", "mobile"):      "mobile",
		coarseNetworkClass("datacenter", ""):  "datacenter",
		coarseNetworkClass("", "fiber"):       "fiber",
		coarseNetworkClass("", ""):            "unknown",
	}
	for got, want := range cases {
		if got != want {
			t.Fatalf("got %q want %q", got, want)
		}
	}
}

func TestMapTrustBadge(t *testing.T) {
	if mapTrustBadge(99.5, 50, 90, false) != "high_uptime" {
		t.Fatal("expected high_uptime")
	}
	if mapTrustBadge(90, 95, 90, false) != "high_quality" {
		t.Fatal("expected high_quality")
	}
	if mapTrustBadge(90, 80, 97, false) != "reliable" {
		t.Fatal("expected reliable")
	}
	if mapTrustLabel("high_quality") != "High quality" {
		t.Fatal("label mismatch")
	}
}
