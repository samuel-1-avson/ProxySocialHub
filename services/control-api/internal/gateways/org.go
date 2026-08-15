package gateways

import (
	"os"
	"strings"

	"github.com/proxyhubb/control-api/internal/models"
)

const (
	// DefaultPlatformOrgID is the gcp-testnet project. Host-A and Host-B share it.
	DefaultPlatformOrgID = "gen-lang-client-0022105784"

	OrgDiversitySame  = "same_org"
	OrgDiversityMulti = "multi_org"
)

// PlatformOrgID is PROXYHUB_PLATFORM_ORG_ID (default the gcp-testnet project).
func PlatformOrgID() string {
	if v := strings.TrimSpace(os.Getenv("PROXYHUB_PLATFORM_ORG_ID")); v != "" {
		return v
	}
	return DefaultPlatformOrgID
}

// NormalizedOrgID returns the operator org, defaulting empty to the platform org.
func NormalizedOrgID(op *models.GatewayOperator) string {
	if op == nil {
		return PlatformOrgID()
	}
	if o := strings.TrimSpace(op.OrgID); o != "" {
		return o
	}
	return PlatformOrgID()
}

// IsPlatformOrg is true when org is empty or equals PROXYHUB_PLATFORM_ORG_ID.
func IsPlatformOrg(orgID string) bool {
	orgID = strings.TrimSpace(orgID)
	if orgID == "" {
		return true
	}
	return strings.EqualFold(orgID, PlatformOrgID())
}

// OrgDiversity is same_org unless at least one operator org differs from the platform.
// two_hosts in the same GCP project is still same_org (W6 Host-B does not count).
func OrgDiversity(ops []models.GatewayOperator) string {
	platform := strings.ToLower(PlatformOrgID())
	orgs := map[string]struct{}{}
	foreign := 0
	for i := range ops {
		org := strings.ToLower(strings.TrimSpace(ops[i].OrgID))
		if org == "" {
			org = platform
		}
		orgs[org] = struct{}{}
		if org != platform {
			foreign++
		}
	}
	if foreign >= 1 && len(orgs) >= 2 {
		return OrgDiversityMulti
	}
	return OrgDiversitySame
}

// ProtectForeignOperatorKey blocks platform seed/env from rotating a foreign
// operator's pubkey, manifest, or org_id. ProxyHubb does not hold that key.
func ProtectForeignOperatorKey(existing, incoming *models.GatewayOperator) {
	if existing == nil || incoming == nil {
		return
	}
	if IsPlatformOrg(existing.OrgID) {
		return
	}
	incoming.Pubkey = existing.Pubkey
	incoming.ManifestPayload = existing.ManifestPayload
	incoming.ManifestSignature = existing.ManifestSignature
	incoming.ManifestExpiresAt = existing.ManifestExpiresAt
	incoming.OrgID = existing.OrgID
}
