package gateways

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/models"
)

func signedOperator(t *testing.T, slug, host string) *models.GatewayOperator {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	secret := base58.Encode(priv.Seed())
	exp := time.Now().UTC().Add(time.Hour)
	op := &models.GatewayOperator{
		Slug:              slug,
		DisplayName:       slug,
		HostID:            host,
		BuyerBaseURL:      "http://203.0.113.10:8090",
		TunnelAddrs:       []string{"203.0.113.10:3128"},
		PeerURLs:          []string{"edge-a@http://10.0.0.1:8090"},
		Bonded:            true,
		Status:            StatusActive,
		ManifestExpiresAt: &exp,
	}
	sig, err := SignManifest(op, secret)
	if err != nil {
		t.Fatal(err)
	}
	op.ManifestSignature = sig
	op.ManifestPayload = string(CanonicalManifestBytes(op))
	return op
}

func TestBuildAndVerifyBundle_noPostgres(t *testing.T) {
	a := signedOperator(t, "edge-a", "gce-host-a")
	b := signedOperator(t, "edge-b", "gce-host-b")
	bundle := BuildBundle([]models.GatewayOperator{*a, *b})
	if bundle.MessageType != BundleMessageType || len(bundle.Operators) != 2 {
		t.Fatalf("bundle: %+v", bundle)
	}
	raw, err := json.Marshal(bundle)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseBundle(raw)
	if err != nil {
		t.Fatal(err)
	}
	entries := VerifyBundleEntries(parsed, true)
	if len(entries) != 2 {
		t.Fatalf("verified count %d", len(entries))
	}
	for _, e := range entries {
		if !e.Verified {
			t.Fatalf("expected verified: %s", e.Reason)
		}
	}
}

func TestVerifyBundle_tamperDropped(t *testing.T) {
	op := signedOperator(t, "edge-a", "gce-host-a")
	bundle := BuildBundle([]models.GatewayOperator{*op})
	bundle.Operators[0].BuyerBaseURL = "http://evil.example:8090"
	entries := VerifyBundleEntries(&bundle, true)
	if len(entries) != 0 {
		t.Fatal("tampered entry must be dropped when dropUnverified")
	}
	kept := VerifyBundleEntries(&bundle, false)
	if len(kept) != 1 || kept[0].Verified {
		t.Fatal("tamper must be unverified when kept")
	}
}

func TestLoadBundleFile_roundTrip(t *testing.T) {
	op := signedOperator(t, "edge-b", "gce-w6-b")
	bundle := BuildBundle([]models.GatewayOperator{*op})
	dir := t.TempDir()
	path := filepath.Join(dir, "operators.json")
	raw, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadBundleFile(path)
	if err != nil {
		t.Fatal(err)
	}
	entries := VerifyBundleEntries(loaded, true)
	if len(entries) != 1 || entries[0].Operator.Slug != "edge-b" {
		t.Fatalf("load: %+v", entries)
	}
}

func TestDiscoverySoT(t *testing.T) {
	t.Setenv("PROXYHUB_OPERATOR_BUNDLE_PATH", "")
	t.Setenv("PROXYHUB_OPERATOR_BUNDLE_URL", "")
	t.Setenv("PROXYHUB_OPERATOR_BUNDLE_CID", "")
	if DiscoverySoT() != "postgres" || BundleConfigured() {
		t.Fatal("default postgres")
	}
	t.Setenv("PROXYHUB_OPERATOR_BUNDLE_CID", "bafytestcid")
	if DiscoverySoT() != "postgres_cache" || !BundleConfigured() {
		t.Fatal("cid pin must be postgres_cache")
	}
}

func TestParseBundle_rejectsWrongType(t *testing.T) {
	if _, err := ParseBundle([]byte(`{"message_type":"NOPE","version":"1","operators":[]}`)); err == nil {
		t.Fatal("expected type error")
	}
}
