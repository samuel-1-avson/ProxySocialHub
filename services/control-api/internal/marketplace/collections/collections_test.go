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

func TestApplyListingCollectionFilterUnknown(t *testing.T) {
	_, err := ApplyListingCollectionFilter(nil, "not-a-collection")
	if err == nil {
		t.Fatal("expected error for unknown collection")
	}
}

func TestApplyListingCollectionFilterEmpty(t *testing.T) {
	// nil query is fine for empty slug — returns input unchanged.
	q, err := ApplyListingCollectionFilter(nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if q != nil {
		t.Fatal("expected nil query passthrough")
	}
}
