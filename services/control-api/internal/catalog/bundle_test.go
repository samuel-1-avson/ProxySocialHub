package catalog

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/models"
)

func testSecret(t *testing.T) string {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return base58.Encode(priv.Seed())
}

func TestSourceDefaultPostgres(t *testing.T) {
	t.Setenv("PROXYHUB_LISTING_BUNDLE_PATH", "")
	t.Setenv("PROXYHUB_LISTING_BUNDLE_URL", "")
	t.Setenv("PROXYHUB_LISTING_BUNDLE_CID", "")
	if Source() != "postgres" || BundleConfigured() {
		t.Fatal("default postgres")
	}
	t.Setenv("PROXYHUB_LISTING_BUNDLE_PATH", "/tmp/listings.json")
	if Source() != "postgres_cache" || !BundleConfigured() {
		t.Fatal("pinned bundle must be postgres_cache")
	}
}

func TestBuildAndVerifyListingBundle(t *testing.T) {
	secret := testSecret(t)
	id := uuid.MustParse("12345678-1234-1234-1234-123456789abc")
	listings := []models.ProxyListing{
		{
			ID:                       id,
			ListingOfferHash:         "abababababababababababababababababababababababababababababababab",
			ListingOfferSigner:       "11111111111111111111111111111111",
			ListingCommitmentPDA:     "PdaDummy111111111111111111111111111111111111",
			ListingCommitmentOnChain: true,
		},
		{ID: uuid.New(), Title: "skip me"},
	}
	b, err := BuildBundle(listings, secret)
	if err != nil {
		t.Fatal(err)
	}
	if b.MessageType != BundleMessageType || len(b.Entries) != 1 {
		t.Fatalf("bundle: %+v", b)
	}
	raw, err := json.Marshal(b)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseBundle(raw)
	if err != nil {
		t.Fatal(err)
	}
	got := VerifyBundleEntries(parsed)
	if len(got) != 1 || !got[0].Verified {
		t.Fatalf("verify: %+v", got)
	}
}

func TestSoakListingSeeds(t *testing.T) {
	l := SoakListing()
	if l.ID.String() != SoakListingID || l.ListingOfferHash != SoakOfferHash || l.ListingOfferSigner != SoakProvider {
		t.Fatalf("soak seeds: %+v", l)
	}
	if l.ListingCommitmentOnChain {
		t.Fatal("soak listing starts off-chain until RPC annotate")
	}
	secret := testSecret(t)
	l.ListingCommitmentPDA = "Ci1FqUWEdMZ8AtYjeoLrn3k9hkyW7rXR4zLb7RHZYC8R"
	l.ListingCommitmentOnChain = true
	b, err := BuildBundle([]models.ProxyListing{l}, secret)
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Entries) != 1 || !b.Entries[0].OnChain || b.Entries[0].PDA == "" {
		t.Fatalf("on_chain bundle: %+v", b.Entries)
	}
	got := VerifyBundleEntries(&b)
	if len(got) != 1 || !got[0].Verified {
		t.Fatalf("verify: %+v", got)
	}
}

func TestParseBundleRejectsWrongType(t *testing.T) {
	if _, err := ParseBundle([]byte(`{"message_type":"NOPE","version":"1","entries":[]}`)); err == nil {
		t.Fatal("wrong type must fail")
	}
}

func TestEmitSampleBundleVerifiesWithoutAPI(t *testing.T) {
	t.Setenv("CONTROL_API_URL", "http://127.0.0.1:1")
	t.Setenv("PROXYHUB_LISTING_BUNDLE_PATH", "")
	b, err := EmitSampleBundle("")
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Entries) != 1 || b.Entries[0].OnChain {
		t.Fatalf("sample must be one off-chain hash: %+v", b)
	}
	got := VerifyBundleEntries(&b)
	if len(got) != 1 || !got[0].Verified {
		t.Fatalf("reconstruct must verify without API: %+v", got)
	}
}
