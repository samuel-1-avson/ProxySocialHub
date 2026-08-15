package gateways

import (
	"crypto/ed25519"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/proofs"
)

const (
	// ManifestModeOff skips verification (Wave 5.B behavior).
	ManifestModeOff     = "off"
	ManifestModeObserve = "observe"
	ManifestModeEnforce = "enforce"

	manifestPrefix = "PROXYHUB_OPERATOR_MANIFEST:v1:"
)

// ManifestMode returns off | observe | enforce (default off).
func ManifestMode() string {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("PROXYHUB_OPERATOR_MANIFEST")))
	switch raw {
	case ManifestModeObserve, ManifestModeEnforce:
		return raw
	case "1", "true", "yes", "on":
		return ManifestModeObserve
	default:
		return ManifestModeOff
	}
}

func ManifestEnabled() bool { return ManifestMode() != ManifestModeOff }
func ManifestEnforce() bool { return ManifestMode() == ManifestModeEnforce }

// CanonicalManifestBytes is the signed payload (stable field order).
func CanonicalManifestBytes(op *models.GatewayOperator) []byte {
	if op == nil {
		return nil
	}
	exp := int64(0)
	if op.ManifestExpiresAt != nil {
		exp = op.ManifestExpiresAt.UTC().Unix()
	}
	bonded := "0"
	if op.Bonded {
		bonded = "1"
	}
	msg := fmt.Sprintf("%s%s|%s|%s|%s|%s|%s|%s|%d|%s|%d",
		manifestPrefix,
		strings.TrimSpace(op.Slug),
		strings.TrimSpace(op.Pubkey),
		strings.TrimSpace(op.HostID),
		strings.TrimSpace(op.BuyerBaseURL),
		strings.Join(normalizeList(op.TunnelAddrs), ","),
		strings.Join(normalizeList(op.PeerURLs), ","),
		strings.TrimSpace(op.StakeAccount),
		op.MinStakeLamports,
		bonded,
		exp,
	)
	return []byte(msg)
}

func normalizeList(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// SignManifest signs CanonicalManifestBytes with a base58 Ed25519 seed/key.
func SignManifest(op *models.GatewayOperator, secret string) (string, error) {
	priv, pub, err := proofs.DecodeSigningKey(secret)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(op.Pubkey) == "" {
		op.Pubkey = base58.Encode(pub)
	}
	sig := ed25519.Sign(priv, CanonicalManifestBytes(op))
	return base58.Encode(sig), nil
}

// VerifyManifest checks Ed25519 signature + expiry. Empty sig is unverified.
func VerifyManifest(op *models.GatewayOperator) (verified bool, reason string) {
	if op == nil {
		return false, "nil operator"
	}
	if strings.TrimSpace(op.ManifestSignature) == "" {
		return false, "unsigned"
	}
	if strings.TrimSpace(op.Pubkey) == "" {
		return false, "missing pubkey"
	}
	if op.ManifestExpiresAt != nil && time.Now().UTC().After(op.ManifestExpiresAt.UTC()) {
		return false, "expired"
	}
	pubRaw, err := base58.Decode(strings.TrimSpace(op.Pubkey))
	if err != nil || len(pubRaw) != ed25519.PublicKeySize {
		return false, "invalid pubkey"
	}
	sigRaw, err := base58.Decode(strings.TrimSpace(op.ManifestSignature))
	if err != nil || len(sigRaw) != ed25519.SignatureSize {
		return false, "invalid signature encoding"
	}
	if !ed25519.Verify(ed25519.PublicKey(pubRaw), CanonicalManifestBytes(op), sigRaw) {
		return false, "bad signature"
	}
	return true, ""
}

// ManifestPassesEnforce is false when enforce mode and the manifest is not verified.
func ManifestPassesEnforce(op *models.GatewayOperator) bool {
	if !ManifestEnforce() {
		return true
	}
	ok, _ := VerifyManifest(op)
	return ok
}

func maybeSignSeededOperator(op *models.GatewayOperator, envKey string) {
	secret := strings.TrimSpace(os.Getenv(envKey))
	if secret == "" {
		return
	}
	ttlHours := 24 * 30
	if raw := strings.TrimSpace(os.Getenv("PROXYHUB_OPERATOR_MANIFEST_TTL_HOURS")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			ttlHours = n
		}
	}
	exp := time.Now().UTC().Add(time.Duration(ttlHours) * time.Hour)
	op.ManifestExpiresAt = &exp
	sig, err := SignManifest(op, secret)
	if err != nil {
		return
	}
	op.ManifestSignature = sig
	op.ManifestPayload = string(CanonicalManifestBytes(op))
}

// HostDiversity classifies operator host_ids / tunnel hosts.
// same_host: all collapse to one identity (J2 loopback twins).
// two_hosts: at least two distinct non-loopback identities.
// unknown: no operators.
func HostDiversity(ops []models.GatewayOperator) string {
	if len(ops) == 0 {
		return "unknown"
	}
	seen := map[string]struct{}{}
	nonLoop := 0
	for i := range ops {
		id := operatorHostIdentity(&ops[i])
		if id == "" {
			continue
		}
		seen[id] = struct{}{}
		if !isLoopbackHostIdentity(id) {
			nonLoop++
		}
	}
	if len(seen) == 0 {
		return "unknown"
	}
	distinctNonLoop := 0
	for id := range seen {
		if !isLoopbackHostIdentity(id) {
			distinctNonLoop++
		}
	}
	if distinctNonLoop >= 2 {
		return "two_hosts"
	}
	return "same_host"
}

func operatorHostIdentity(op *models.GatewayOperator) string {
	if op == nil {
		return ""
	}
	if h := strings.TrimSpace(op.HostID); h != "" {
		return strings.ToLower(h)
	}
	for _, a := range op.TunnelAddrs {
		if host := hostFromAddr(a); host != "" {
			return host
		}
	}
	if host := hostFromURL(op.BuyerBaseURL); host != "" {
		return host
	}
	return ""
}

func hostFromAddr(a string) string {
	a = normalizeAddr(a)
	if a == "" {
		return ""
	}
	host, _, err := net.SplitHostPort(a)
	if err != nil {
		host = a
	}
	return strings.ToLower(strings.TrimSpace(host))
}

func hostFromURL(u string) string {
	u = strings.TrimSpace(u)
	u = strings.TrimPrefix(u, "https://")
	u = strings.TrimPrefix(u, "http://")
	if i := strings.Index(u, "/"); i >= 0 {
		u = u[:i]
	}
	host, _, err := net.SplitHostPort(u)
	if err != nil {
		host = u
	}
	return strings.ToLower(strings.TrimSpace(host))
}

func isLoopbackHostIdentity(id string) bool {
	id = strings.ToLower(strings.TrimSpace(id))
	switch id {
	case "", "localhost", "127.0.0.1", "::1", "0.0.0.0",
		"edge-a", "edge-b", "edge-gateway-a", "edge-gateway-b",
		"j2", "same-vm", "primary-loopback":
		return true
	}
	if strings.HasPrefix(id, "127.") {
		return true
	}
	return false
}

// HonestyMeta is public Wave 6/7 discovery honesty (not DePIN).
func HonestyMeta(ops []models.GatewayOperator) map[string]interface{} {
	div := HostDiversity(ops)
	sot := DiscoverySoT()
	note := "Centralized discovery. Control-api remains a directory cache, not DePIN. "
	if sot == "postgres_cache" {
		note = "Postgres is a cache of W6.B signed manifests. A pinned bundle (file/URL/CID) can reconstruct operators without the API. Not DePIN. "
	} else {
		note += "No operator bundle pin configured (PROXYHUB_OPERATOR_BUNDLE_PATH|URL|CID). "
	}
	switch div {
	case "two_hosts":
		note += "Operator host_ids span two distinct non-loopback hosts (W6.A). "
	case "same_host":
		note += "Operators still collapse to one host (J2 same-VM or unset host_id). "
	default:
		note += "Host diversity unknown (no operators). "
	}
	orgDiv := OrgDiversity(ops)
	switch orgDiv {
	case OrgDiversityMulti:
		note += "operator_org_diversity=multi_org: at least one org_id differs from PROXYHUB_PLATFORM_ORG_ID. Not permissionless join. Not DePIN."
	default:
		note += "operator_org_diversity=same_org: Host-B in gen-lang-client-0022105784 does not count as a third-party operator (W7.D)."
	}
	return map[string]interface{}{
		"catalog_source":                "postgres",
		"discovery_sot":                 sot,
		"operator_host_diversity":       div,
		"operator_org_diversity":        orgDiv,
		"platform_org_id":               PlatformOrgID(),
		"foreign_operator_key_rotation": "operator_only",
		"control_plane":                 "shared",
		"bond_enforce_mode":             BondEnforceMode(),
		"operator_manifest_mode":        ManifestMode(),
		"operator_bundle":               BundlePinMeta(),
		"live_economic_slash":           false,
		"programs_session":              "unsafe_do_not_deploy",
		"bonded_gateway_program":        BondedGatewayProgramHonesty(),
		"gateway_slash_execute":         SlashExecuteMode(),
		"note":                          note,
	}
}
