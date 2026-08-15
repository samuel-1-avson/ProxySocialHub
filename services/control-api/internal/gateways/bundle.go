package gateways

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/lib/pq"
	"github.com/proxyhubb/control-api/internal/models"
)

const (
	// BundleMessageType identifies a Wave 7.B portable operator-manifest bundle.
	BundleMessageType = "PROXYHUB_OPERATOR_MANIFEST_BUNDLE"
	BundleVersion     = "1"
)

// ManifestBundle is a self-contained copy of W6.B signed operator manifests.
// Each entry verifies with the operator pubkey; Postgres is not required.
type ManifestBundle struct {
	MessageType string           `json:"message_type"`
	Version     string           `json:"version"`
	IssuedAt    int64            `json:"issued_at"`
	Operators   []BundleOperator `json:"operators"`
}

// BundleOperator is the portable subset needed to reconstruct and verify a manifest.
type BundleOperator struct {
	Slug              string   `json:"slug"`
	DisplayName       string   `json:"display_name,omitempty"`
	Pubkey            string   `json:"pubkey"`
	HostID            string   `json:"host_id"`
	OrgID             string   `json:"org_id,omitempty"`
	BuyerBaseURL      string   `json:"buyer_base_url"`
	HealthURL         string   `json:"health_url,omitempty"`
	TunnelAddrs       []string `json:"tunnel_addrs"`
	PeerURLs          []string `json:"peer_urls"`
	StakeAccount      string   `json:"stake_account,omitempty"`
	MinStakeLamports  int64    `json:"min_stake_lamports"`
	Bonded            bool     `json:"bonded"`
	Status            string   `json:"status"`
	ManifestPayload   string   `json:"manifest_payload"`
	ManifestSignature string   `json:"manifest_signature"`
	ManifestExpiresAt *int64   `json:"manifest_expires_at,omitempty"`
}

// BundleConfigured is true when a non-Postgres reconstruct pin is set.
func BundleConfigured() bool {
	return strings.TrimSpace(os.Getenv("PROXYHUB_OPERATOR_BUNDLE_PATH")) != "" ||
		strings.TrimSpace(os.Getenv("PROXYHUB_OPERATOR_BUNDLE_URL")) != "" ||
		strings.TrimSpace(os.Getenv("PROXYHUB_OPERATOR_BUNDLE_CID")) != ""
}

// DiscoverySoT is postgres (API-only) or postgres_cache (bundle pin configured).
func DiscoverySoT() string {
	if BundleConfigured() {
		return "postgres_cache"
	}
	return "postgres"
}

// BuildBundle snapshots operators into a portable bundle (canonical payload + sig).
func BuildBundle(ops []models.GatewayOperator) ManifestBundle {
	b := ManifestBundle{
		MessageType: BundleMessageType,
		Version:     BundleVersion,
		IssuedAt:    time.Now().UTC().Unix(),
		Operators:   make([]BundleOperator, 0, len(ops)),
	}
	for i := range ops {
		b.Operators = append(b.Operators, operatorToBundle(&ops[i]))
	}
	return b
}

func operatorToBundle(op *models.GatewayOperator) BundleOperator {
	payload := strings.TrimSpace(op.ManifestPayload)
	if payload == "" {
		payload = string(CanonicalManifestBytes(op))
	}
	var exp *int64
	if op.ManifestExpiresAt != nil {
		v := op.ManifestExpiresAt.UTC().Unix()
		exp = &v
	}
	status := strings.TrimSpace(op.Status)
	if status == "" {
		status = StatusActive
	}
	return BundleOperator{
		Slug:              op.Slug,
		DisplayName:       op.DisplayName,
		Pubkey:            op.Pubkey,
		HostID:            op.HostID,
		OrgID:             op.OrgID,
		BuyerBaseURL:      op.BuyerBaseURL,
		HealthURL:         op.HealthURL,
		TunnelAddrs:       append([]string(nil), op.TunnelAddrs...),
		PeerURLs:          append([]string(nil), op.PeerURLs...),
		StakeAccount:      op.StakeAccount,
		MinStakeLamports:  op.MinStakeLamports,
		Bonded:            op.Bonded,
		Status:            status,
		ManifestPayload:   payload,
		ManifestSignature: op.ManifestSignature,
		ManifestExpiresAt: exp,
	}
}

// ToOperator reconstructs a GatewayOperator for VerifyManifest (no DB).
func (e BundleOperator) ToOperator() *models.GatewayOperator {
	op := &models.GatewayOperator{
		Slug:              e.Slug,
		DisplayName:       e.DisplayName,
		Pubkey:            e.Pubkey,
		HostID:            e.HostID,
		OrgID:             e.OrgID,
		BuyerBaseURL:      e.BuyerBaseURL,
		HealthURL:         e.HealthURL,
		TunnelAddrs:       pq.StringArray(append([]string(nil), e.TunnelAddrs...)),
		PeerURLs:          pq.StringArray(append([]string(nil), e.PeerURLs...)),
		StakeAccount:      e.StakeAccount,
		MinStakeLamports:  e.MinStakeLamports,
		Bonded:            e.Bonded,
		Status:            e.Status,
		ManifestPayload:   e.ManifestPayload,
		ManifestSignature: e.ManifestSignature,
	}
	if e.ManifestExpiresAt != nil {
		t := time.Unix(*e.ManifestExpiresAt, 0).UTC()
		op.ManifestExpiresAt = &t
	}
	return op
}

// ParseBundle decodes a bundle document.
func ParseBundle(raw []byte) (*ManifestBundle, error) {
	var b ManifestBundle
	if err := json.Unmarshal(raw, &b); err != nil {
		return nil, fmt.Errorf("operator bundle: %w", err)
	}
	if b.MessageType != "" && b.MessageType != BundleMessageType {
		return nil, fmt.Errorf("operator bundle: unexpected message_type %q", b.MessageType)
	}
	if b.Version != "" && b.Version != BundleVersion {
		return nil, fmt.Errorf("operator bundle: unsupported version %q", b.Version)
	}
	if b.MessageType == "" {
		b.MessageType = BundleMessageType
	}
	if b.Version == "" {
		b.Version = BundleVersion
	}
	return &b, nil
}

// LoadBundleFile reads a bundle from disk (no Postgres).
func LoadBundleFile(path string) (*ManifestBundle, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("operator bundle file: %w", err)
	}
	return ParseBundle(raw)
}

// VerifiedBundleEntry is one reconstruct result.
type VerifiedBundleEntry struct {
	Operator *models.GatewayOperator
	Verified bool
	Reason   string
}

// VerifyBundleEntries checks each manifest locally. Unsigned/invalid are kept
// with Verified=false unless dropUnverified is true.
func VerifyBundleEntries(b *ManifestBundle, dropUnverified bool) []VerifiedBundleEntry {
	if b == nil {
		return nil
	}
	out := make([]VerifiedBundleEntry, 0, len(b.Operators))
	for i := range b.Operators {
		op := b.Operators[i].ToOperator()
		ok, reason := VerifyManifest(op)
		if dropUnverified && !ok {
			continue
		}
		out = append(out, VerifiedBundleEntry{Operator: op, Verified: ok, Reason: reason})
	}
	return out
}

// BundlePinMeta is public honesty for a configured reconstruct pin.
func BundlePinMeta() map[string]interface{} {
	path := strings.TrimSpace(os.Getenv("PROXYHUB_OPERATOR_BUNDLE_PATH"))
	url := strings.TrimSpace(os.Getenv("PROXYHUB_OPERATOR_BUNDLE_URL"))
	cid := strings.TrimSpace(os.Getenv("PROXYHUB_OPERATOR_BUNDLE_CID"))
	return map[string]interface{}{
		"path": path,
		"url":  url,
		"cid":  cid,
	}
}
