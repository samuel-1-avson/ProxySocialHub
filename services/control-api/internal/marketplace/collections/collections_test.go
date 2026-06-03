package collections

import "testing"

func TestResolveMetaKnownSlugs(t *testing.T) {
	for _, slug := range []string{"featured", "verified", "editors-pick"} {
		if _, ok := ResolveMeta(slug); !ok {
			t.Fatalf("expected slug %q to resolve", slug)
		}
	}
	if _, ok := ResolveMeta("missing"); ok {
		t.Fatal("expected unknown slug to fail")
	}
}
