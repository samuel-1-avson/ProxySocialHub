// Package gateways implements Wave 5.B operator discovery (ADR-0007).
package gateways

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/lib/pq"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	StatusActive   = "active"
	StatusDisabled = "disabled"

	BondModeOff     = "off"
	BondModeObserve = "observe"
	BondModeEnforce = "enforce"
)

// BondEnforceMode returns off | observe | enforce (default off).
// enforce omits unbonded operators from discovery/routing.
func BondEnforceMode() string {
	v := strings.TrimSpace(strings.ToLower(os.Getenv("PROXYHUB_GATEWAY_OPERATOR_BOND_ENFORCE")))
	switch v {
	case BondModeObserve, BondModeEnforce:
		return v
	case "1", "true", "yes", "on":
		return BondModeEnforce
	default:
		return BondModeOff
	}
}

// BondEnforceEnabled is true only in enforce mode (W5.B / W6.D).
func BondEnforceEnabled() bool {
	return BondEnforceMode() == BondModeEnforce
}

// OperatorView is the public discovery DTO (includes live health + W6.B manifest).
type OperatorView struct {
	ID                string   `json:"id"`
	Slug              string   `json:"slug"`
	DisplayName       string   `json:"display_name"`
	Pubkey            string   `json:"pubkey"`
	HostID            string   `json:"host_id"`
	OrgID             string   `json:"org_id"`
	BuyerBaseURL      string   `json:"buyer_base_url"`
	TunnelAddrs       []string `json:"tunnel_addrs"`
	PeerURLs          []string `json:"peer_urls"`
	StakeAccount      string   `json:"stake_account"`
	MinStakeLamports  int64    `json:"min_stake_lamports"`
	Bonded            bool     `json:"bonded"`
	Status            string   `json:"status"`
	Healthy           bool     `json:"healthy"`
	EdgePodID         string   `json:"edge_pod_id"`
	LastHealthyAt     *string  `json:"last_healthy_at,omitempty"`
	Manifest          string   `json:"manifest,omitempty"`
	ManifestSignature string   `json:"manifest_signature,omitempty"`
	ManifestVerified  bool     `json:"manifest_verified"`
	ManifestReason    string   `json:"manifest_reason,omitempty"`
}

// SeedFromEnv upserts J2 logical operators when seeding is enabled (default on).
// Set PROXYHUB_SEED_GATEWAY_OPERATORS=0 to skip.
func SeedFromEnv() error {
	if db.DB == nil {
		return nil
	}
	v := strings.TrimSpace(strings.ToLower(os.Getenv("PROXYHUB_SEED_GATEWAY_OPERATORS")))
	if v == "0" || v == "false" || v == "no" || v == "off" {
		return nil
	}
	return seedJ2Defaults(db.DB)
}

func seedJ2Defaults(gdb *gorm.DB) error {
	publicHost := strings.TrimSpace(os.Getenv("PROVIDER_TUNNEL_PUBLIC_ADDR"))
	hostOnly := publicHost
	if i := strings.LastIndex(publicHost, ":"); i > 0 {
		hostOnly = publicHost[:i]
	}
	if hostOnly == "" || hostOnly == "localhost" || hostOnly == "127.0.0.1" {
		hostOnly = "127.0.0.1"
	}

	tunnelA := strings.TrimSpace(os.Getenv("GATEWAY_OP_A_TUNNEL"))
	if tunnelA == "" {
		if publicHost != "" {
			tunnelA = publicHost
		} else {
			tunnelA = hostOnly + ":3128"
		}
	}
	tunnelB := strings.TrimSpace(os.Getenv("GATEWAY_OP_B_TUNNEL"))
	if tunnelB == "" {
		tunnelB = hostOnly + ":3129"
	}

	buyerA := envOr("GATEWAY_OP_A_BUYER_URL", "http://127.0.0.1:18090")
	buyerB := envOr("GATEWAY_OP_B_BUYER_URL", "http://127.0.0.1:18091")
	healthA := envOr("GATEWAY_OP_A_HEALTH_URL", buyerA+"/health")
	healthB := envOr("GATEWAY_OP_B_HEALTH_URL", buyerB+"/health")
	hostA := envOr("GATEWAY_OP_A_HOST_ID", "primary-loopback")
	hostB := envOr("GATEWAY_OP_B_HOST_ID", "primary-loopback")
	orgA := envOr("GATEWAY_OP_A_ORG_ID", PlatformOrgID())
	orgB := envOr("GATEWAY_OP_B_ORG_ID", PlatformOrgID())
	peerA := envOr("GATEWAY_OP_A_PEER_URLS", "edge-b@http://edge-gateway-b:8090")
	peerB := envOr("GATEWAY_OP_B_PEER_URLS", "edge-a@http://edge-gateway-a:8090")

	ops := []models.GatewayOperator{
		{
			Slug:         "edge-a",
			DisplayName:  "Edge A (J2)",
			BuyerBaseURL: buyerA,
			HealthURL:    healthA,
			TunnelAddrs:  pq.StringArray{tunnelA},
			PeerURLs:     pq.StringArray{peerA},
			HostID:       hostA,
			OrgID:        orgA,
			Bonded:       envBonded("GATEWAY_OP_A_BONDED", true),
			Status:       seededStatus("GATEWAY_OP_A_STATUS"),
			Pubkey:       strings.TrimSpace(os.Getenv("GATEWAY_OP_A_PUBKEY")),
		},
		{
			Slug:         "edge-b",
			DisplayName:  envOr("GATEWAY_OP_B_DISPLAY_NAME", "Edge B (J2)"),
			BuyerBaseURL: buyerB,
			HealthURL:    healthB,
			TunnelAddrs:  pq.StringArray{tunnelB},
			PeerURLs:     pq.StringArray{peerB},
			HostID:       hostB,
			OrgID:        orgB,
			Bonded:       envBonded("GATEWAY_OP_B_BONDED", true),
			Status:       seededStatus("GATEWAY_OP_B_STATUS"),
			Pubkey:       strings.TrimSpace(os.Getenv("GATEWAY_OP_B_PUBKEY")),
		},
	}
	maybeSignSeededOperator(&ops[0], "GATEWAY_OP_A_SIGNING_KEY")
	maybeSignSeededOperator(&ops[1], "GATEWAY_OP_B_SIGNING_KEY")

	for _, op := range ops {
		row := op
		var existing models.GatewayOperator
		if err := gdb.Where("slug = ?", row.Slug).First(&existing).Error; err == nil {
			ProtectForeignOperatorKey(&existing, &row)
		}
		err := gdb.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "slug"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"display_name", "buyer_base_url", "health_url",
				"tunnel_addrs", "peer_urls", "bonded", "status", "updated_at",
				"host_id", "org_id", "pubkey", "manifest_payload", "manifest_signature",
				"manifest_expires_at",
			}),
		}).Create(&row).Error
		if err != nil {
			return err
		}
	}
	return nil
}

// Disabled operators remain disabled across API restarts and reseeding.
func seededStatus(key string) string {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "", StatusActive:
		return StatusActive
	default:
		return StatusDisabled
	}
}

func envBonded(key string, def bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	switch v {
	case "0", "false", "no", "off":
		return false
	case "1", "true", "yes", "on":
		return true
	default:
		return def
	}
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// ListActive returns active operators, optionally filtering unbonded when enforce is on.
func ListActive(enforceBond bool) ([]models.GatewayOperator, error) {
	if db.DB == nil {
		return nil, gorm.ErrInvalidDB
	}
	q := db.DB.Where("status = ?", StatusActive)
	if enforceBond {
		q = q.Where("bonded = ?", true)
	}
	var rows []models.GatewayOperator
	if err := q.Order("slug asc").Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

// GetByIDOrSlug loads one operator by UUID or slug.
func GetByIDOrSlug(idOrSlug string) (*models.GatewayOperator, error) {
	if db.DB == nil {
		return nil, gorm.ErrInvalidDB
	}
	var row models.GatewayOperator
	q := db.DB.Where("slug = ?", idOrSlug)
	if err := q.First(&row).Error; err == nil {
		return &row, nil
	}
	err := db.DB.Where("id = ?", idOrSlug).First(&row).Error
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// RegistryTunnelAddrs returns deduped tunnel endpoints from active (bond-filtered) operators.
func RegistryTunnelAddrs() []string {
	rows, err := ListActive(BondEnforceEnabled())
	if err != nil || len(rows) == 0 {
		return nil
	}
	out := make([]string, 0, 8)
	seen := map[string]struct{}{}
	for _, r := range rows {
		for _, a := range r.TunnelAddrs {
			a = normalizeAddr(a)
			if a == "" {
				continue
			}
			if _, ok := seen[a]; ok {
				continue
			}
			seen[a] = struct{}{}
			out = append(out, a)
		}
	}
	return out
}

func normalizeAddr(a string) string {
	a = strings.TrimSpace(a)
	a = strings.TrimPrefix(a, "https://")
	a = strings.TrimPrefix(a, "http://")
	return strings.TrimSpace(a)
}

// ProbeHealth GETs the operator health URL and updates last_healthy_at / edge_pod_id.
func ProbeHealth(ctx context.Context, op *models.GatewayOperator) (healthy bool, edgePodID string) {
	url := strings.TrimSpace(op.HealthURL)
	if url == "" {
		url = strings.TrimRight(op.BuyerBaseURL, "/") + "/health"
	}
	client := &http.Client{Timeout: 3 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, op.LastEdgePodID
	}
	resp, err := client.Do(req)
	if err != nil {
		return false, op.LastEdgePodID
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false, op.LastEdgePodID
	}
	edgePodID = op.LastEdgePodID
	var parsed struct {
		Status    string `json:"status"`
		EdgePodID string `json:"edge_pod_id"`
	}
	if json.Unmarshal(body, &parsed) == nil {
		if parsed.EdgePodID != "" {
			edgePodID = parsed.EdgePodID
		}
		if parsed.Status != "" && !strings.EqualFold(parsed.Status, "healthy") && !strings.EqualFold(parsed.Status, "ok") {
			return false, edgePodID
		}
	}
	if hdr := resp.Header.Get("X-Edge-Pod-Id"); hdr != "" {
		edgePodID = hdr
	}
	now := time.Now().UTC()
	_ = db.DB.Model(op).Updates(map[string]any{
		"last_healthy_at":  now,
		"last_edge_pod_id": edgePodID,
		"updated_at":       now,
	}).Error
	op.LastHealthyAt = &now
	op.LastEdgePodID = edgePodID
	return true, edgePodID
}

// ToView converts a row + health probe result into the public DTO.
func ToView(op *models.GatewayOperator, healthy bool, edgePodID string) OperatorView {
	verified, reason := VerifyManifest(op)
	v := OperatorView{
		ID:                op.ID.String(),
		Slug:              op.Slug,
		DisplayName:       op.DisplayName,
		Pubkey:            op.Pubkey,
		HostID:            op.HostID,
		OrgID:             op.OrgID,
		BuyerBaseURL:      op.BuyerBaseURL,
		TunnelAddrs:       append([]string(nil), op.TunnelAddrs...),
		PeerURLs:          append([]string(nil), op.PeerURLs...),
		StakeAccount:      op.StakeAccount,
		MinStakeLamports:  op.MinStakeLamports,
		Bonded:            op.Bonded,
		Status:            op.Status,
		Healthy:           healthy,
		EdgePodID:         edgePodID,
		Manifest:          string(CanonicalManifestBytes(op)),
		ManifestSignature: op.ManifestSignature,
		ManifestVerified:  verified,
		ManifestReason:    reason,
	}
	if ManifestMode() == ManifestModeOff {
		v.Manifest = ""
		v.ManifestSignature = ""
		v.ManifestReason = ""
		v.ManifestVerified = false
	}
	if op.LastHealthyAt != nil {
		s := op.LastHealthyAt.UTC().Format(time.RFC3339)
		v.LastHealthyAt = &s
	}
	return v
}
