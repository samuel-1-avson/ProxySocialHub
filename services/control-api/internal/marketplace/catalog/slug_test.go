package catalog_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/marketplace/catalog"
)

func TestSlugify(t *testing.T) {
	id := uuid.MustParse("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
	s := catalog.Slugify("US Residential Proxies!", id)
	if s == "" {
		t.Fatal("empty slug")
	}
	if len(s) < 10 {
		t.Fatalf("slug too short: %q", s)
	}
}

func TestNormalizeSlug(t *testing.T) {
	got := catalog.NormalizeSlug("  Hello World  ")
	if got != "hello-world" {
		t.Fatalf("got %q", got)
	}
}
