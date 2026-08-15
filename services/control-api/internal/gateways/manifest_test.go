package gateways

import (
	"crypto/ed25519"
	"crypto/rand"
	"testing"
	"time"

	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/models"
)

func TestBondEnforceMode(t *testing.T) {
	t.Setenv("PROXYHUB_GATEWAY_OPERATOR_BOND_ENFORCE", "")
	if BondEnforceMode() != BondModeOff || BondEnforceEnabled() {
		t.Fatal("default off")
	}
	t.Setenv("PROXYHUB_GATEWAY_OPERATOR_BOND_ENFORCE", "observe")
	if BondEnforceMode() != BondModeObserve || BondEnforceEnabled() {
		t.Fatal("observe must not omit unbonded")
	}
	t.Setenv("PROXYHUB_GATEWAY_OPERATOR_BOND_ENFORCE", "enforce")
	if !BondEnforceEnabled() {
		t.Fatal("enforce expected")
	}
	t.Setenv("PROXYHUB_GATEWAY_OPERATOR_BOND_ENFORCE", "true")
	if BondEnforceMode() != BondModeEnforce {
		t.Fatal("true aliases enforce")
	}
}

func TestHostDiversity_sameHostLoopback(t *testing.T) {
	ops := []models.GatewayOperator{
		{Slug: "edge-a", HostID: "primary-loopback", TunnelAddrs: []string{"127.0.0.1:3128"}},
		{Slug: "edge-b", HostID: "primary-loopback", TunnelAddrs: []string{"127.0.0.1:3129"}},
	}
	if got := HostDiversity(ops); got != "same_host" {
		t.Fatalf("got %s", got)
	}
}

func TestHostDiversity_twoHosts(t *testing.T) {
	ops := []models.GatewayOperator{
		{Slug: "edge-a", HostID: "gce-proxyhubb-testnet", TunnelAddrs: []string{"10.0.0.1:3128"}},
		{Slug: "edge-b", HostID: "gce-w6-operator-b", TunnelAddrs: []string{"10.0.0.2:3128"}},
	}
	if got := HostDiversity(ops); got != "two_hosts" {
		t.Fatalf("got %s", got)
	}
}

func TestHostDiversity_unknownEmpty(t *testing.T) {
	if got := HostDiversity(nil); got != "unknown" {
		t.Fatalf("got %s", got)
	}
}

func TestCanonicalManifestGolden(t *testing.T) {
	exp := time.Unix(1700000000, 0).UTC()
	op := &models.GatewayOperator{
		Slug:              "edge-b",
		Pubkey:            "opk",
		HostID:            "gce-w6-b",
		BuyerBaseURL:      "http://203.0.113.10:8090",
		TunnelAddrs:       []string{"203.0.113.10:3128"},
		PeerURLs:          []string{"edge-a@http://10.0.0.1:8090"},
		Bonded:            true,
		ManifestExpiresAt: &exp,
	}
	got := string(CanonicalManifestBytes(op))
	want := "PROXYHUB_OPERATOR_MANIFEST:v1:edge-b|opk|gce-w6-b|http://203.0.113.10:8090|203.0.113.10:3128|edge-a@http://10.0.0.1:8090||0|1|1700000000"
	if got != want {
		t.Fatalf("canonical\n got %q\nwant %q", got, want)
	}
}

func TestSignAndVerifyManifest(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	secret := base58.Encode(priv.Seed())
	exp := time.Now().UTC().Add(time.Hour)
	op := &models.GatewayOperator{
		Slug:              "edge-b",
		HostID:            "gce-w6-b",
		BuyerBaseURL:      "http://203.0.113.10:8090",
		TunnelAddrs:       []string{"203.0.113.10:3128"},
		PeerURLs:          []string{"edge-a@http://10.0.0.1:8090"},
		Bonded:            true,
		MinStakeLamports:  0,
		ManifestExpiresAt: &exp,
	}
	sig, err := SignManifest(op, secret)
	if err != nil {
		t.Fatal(err)
	}
	op.ManifestSignature = sig
	ok, reason := VerifyManifest(op)
	if !ok {
		t.Fatalf("expected verified, got %s", reason)
	}
	op.ManifestSignature = base58.Encode(make([]byte, ed25519.SignatureSize))
	ok, reason = VerifyManifest(op)
	if ok {
		t.Fatal("tampered sig must fail")
	}
	if reason == "" {
		t.Fatal("reason expected")
	}
}

func TestVerifyManifest_expired(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	secret := base58.Encode(priv.Seed())
	exp := time.Now().UTC().Add(-time.Hour)
	op := &models.GatewayOperator{
		Slug:              "edge-a",
		HostID:            "host-a",
		BuyerBaseURL:      "http://10.0.0.1:8090",
		ManifestExpiresAt: &exp,
	}
	sig, err := SignManifest(op, secret)
	if err != nil {
		t.Fatal(err)
	}
	op.ManifestSignature = sig
	ok, reason := VerifyManifest(op)
	if ok || reason != "expired" {
		t.Fatalf("ok=%v reason=%s", ok, reason)
	}
}

func TestManifestPassesEnforce(t *testing.T) {
	t.Setenv("PROXYHUB_OPERATOR_MANIFEST", "off")
	op := &models.GatewayOperator{Slug: "x"}
	if !ManifestPassesEnforce(op) {
		t.Fatal("off must pass")
	}
	t.Setenv("PROXYHUB_OPERATOR_MANIFEST", "observe")
	if !ManifestPassesEnforce(op) {
		t.Fatal("observe must not drop unsigned")
	}
	t.Setenv("PROXYHUB_OPERATOR_MANIFEST", "enforce")
	if ManifestPassesEnforce(op) {
		t.Fatal("enforce must drop unsigned")
	}
}

func TestHonestyMetaTwoHosts(t *testing.T) {
	t.Setenv("PROXYHUB_GATEWAY_OPERATOR_BOND_ENFORCE", "observe")
	t.Setenv("PROXYHUB_OPERATOR_MANIFEST", "observe")
	t.Setenv("PROXYHUB_OPERATOR_BUNDLE_PATH", "")
	t.Setenv("PROXYHUB_OPERATOR_BUNDLE_URL", "")
	t.Setenv("PROXYHUB_OPERATOR_BUNDLE_CID", "")
	t.Setenv("PROXYHUB_GATEWAY_SLASH_AUTO", "")
	t.Setenv("PROXYHUB_GATEWAY_SLASH_CONFIRM", "")
	t.Setenv("PROXYHUB_GATEWAY_BOND_PROGRAM_ID", "")
	ops := []models.GatewayOperator{
		{HostID: "host-a"},
		{HostID: "host-b"},
	}
	m := HonestyMeta(ops)
	if m["operator_host_diversity"] != "two_hosts" {
		t.Fatalf("%v", m)
	}
	if m["operator_org_diversity"] != OrgDiversitySame {
		t.Fatalf("two hosts still same_org until W7.D foreign org: %v", m)
	}
	if m["control_plane"] != "shared" {
		t.Fatal("control plane must stay shared")
	}
	if m["live_economic_slash"] != false {
		t.Fatal("must not claim live slash")
	}
	if m["programs_session"] != "unsafe_do_not_deploy" {
		t.Fatal("session program must stay undeployed")
	}
	if m["bonded_gateway_program"] != BondedGatewayProgramHonesty() {
		t.Fatalf("bonded program honesty: %v", m["bonded_gateway_program"])
	}
	if m["gateway_slash_execute"] != "off" {
		t.Fatalf("slash execute default: %v", m["gateway_slash_execute"])
	}
	if m["discovery_sot"] != "postgres" {
		t.Fatalf("default sot: %v", m["discovery_sot"])
	}
	t.Setenv("PROXYHUB_OPERATOR_BUNDLE_PATH", "/tmp/operators.json")
	m = HonestyMeta(ops)
	if m["discovery_sot"] != "postgres_cache" {
		t.Fatalf("pinned bundle must be postgres_cache, got %v", m["discovery_sot"])
	}
}
