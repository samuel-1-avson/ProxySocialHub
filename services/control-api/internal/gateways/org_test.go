package gateways

import (
	"testing"
	"time"

	"github.com/proxyhubb/control-api/internal/models"
)

func TestOrgDiversity_sameOrgDefaultAndTwoHosts(t *testing.T) {
	t.Setenv("PROXYHUB_PLATFORM_ORG_ID", "")
	ops := []models.GatewayOperator{
		{Slug: "edge-a", HostID: "gce-proxyhubb-testnet", OrgID: DefaultPlatformOrgID},
		{Slug: "edge-b", HostID: "gce-w6-operator-b", OrgID: ""},
	}
	if got := OrgDiversity(ops); got != OrgDiversitySame {
		t.Fatalf("two hosts in the platform GCP project must be same_org, got %s", got)
	}
}

func TestOrgDiversity_multiOrg(t *testing.T) {
	t.Setenv("PROXYHUB_PLATFORM_ORG_ID", DefaultPlatformOrgID)
	ops := []models.GatewayOperator{
		{Slug: "edge-a", OrgID: DefaultPlatformOrgID},
		{Slug: "edge-ext", OrgID: "ext-operator-org-1"},
	}
	if got := OrgDiversity(ops); got != OrgDiversityMulti {
		t.Fatalf("got %s", got)
	}
}

func TestProtectForeignOperatorKey_blocksPlatformRotation(t *testing.T) {
	t.Setenv("PROXYHUB_PLATFORM_ORG_ID", DefaultPlatformOrgID)
	exp := time.Unix(1700000000, 0).UTC()
	existing := &models.GatewayOperator{
		Slug:              "edge-ext",
		OrgID:             "ext-operator-org-1",
		Pubkey:            "foreign-pubkey",
		ManifestPayload:   "payload",
		ManifestSignature: "sig",
		ManifestExpiresAt: &exp,
	}
	incoming := &models.GatewayOperator{
		Slug:              "edge-ext",
		OrgID:             DefaultPlatformOrgID,
		Pubkey:            "platform-rotated",
		ManifestPayload:   "hijack",
		ManifestSignature: "bad",
	}
	ProtectForeignOperatorKey(existing, incoming)
	if incoming.Pubkey != "foreign-pubkey" || incoming.OrgID != "ext-operator-org-1" {
		t.Fatalf("platform must not rotate foreign key: %+v", incoming)
	}
	if incoming.ManifestSignature != "sig" || incoming.ManifestPayload != "payload" {
		t.Fatalf("platform must not replace foreign manifest: %+v", incoming)
	}
}

func TestProtectForeignOperatorKey_allowsPlatformSelfRotate(t *testing.T) {
	t.Setenv("PROXYHUB_PLATFORM_ORG_ID", DefaultPlatformOrgID)
	existing := &models.GatewayOperator{
		Slug:   "edge-a",
		OrgID:  DefaultPlatformOrgID,
		Pubkey: "old",
	}
	incoming := &models.GatewayOperator{
		Slug:   "edge-a",
		OrgID:  DefaultPlatformOrgID,
		Pubkey: "new",
	}
	ProtectForeignOperatorKey(existing, incoming)
	if incoming.Pubkey != "new" {
		t.Fatal("platform may rotate its own operator key")
	}
}

func TestHonestyMeta_orgDiversity(t *testing.T) {
	t.Setenv("PROXYHUB_PLATFORM_ORG_ID", DefaultPlatformOrgID)
	t.Setenv("PROXYHUB_OPERATOR_BUNDLE_PATH", "")
	t.Setenv("PROXYHUB_OPERATOR_BUNDLE_URL", "")
	t.Setenv("PROXYHUB_OPERATOR_BUNDLE_CID", "")
	same := HonestyMeta([]models.GatewayOperator{
		{HostID: "host-a", OrgID: DefaultPlatformOrgID},
		{HostID: "host-b"},
	})
	if same["operator_org_diversity"] != OrgDiversitySame {
		t.Fatalf("same: %v", same)
	}
	if same["foreign_operator_key_rotation"] != "operator_only" {
		t.Fatalf("rotation: %v", same)
	}
	multi := HonestyMeta([]models.GatewayOperator{
		{HostID: "host-a", OrgID: DefaultPlatformOrgID},
		{HostID: "vps-1", OrgID: "someone-else"},
	})
	if multi["operator_org_diversity"] != OrgDiversityMulti {
		t.Fatalf("multi: %v", multi)
	}
}
