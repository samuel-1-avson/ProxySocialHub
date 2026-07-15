package geo

import "testing"

func TestBuildMapGeoMeta_RegionHubEstimated(t *testing.T) {
	meta := BuildMapGeoMeta("region_hub")
	if !meta.Estimated || meta.Source != "region_hub" {
		t.Fatalf("unexpected meta: %#v", meta)
	}
	if meta.DisplayLabel == "" {
		t.Fatal("expected display label")
	}
}

func TestBuildMapGeoMeta_ExplorerNotEstimated(t *testing.T) {
	meta := BuildMapGeoMeta("explorer")
	if meta.Estimated {
		t.Fatalf("explorer coords should not be estimated: %#v", meta)
	}
}
