package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// GatewayOperator is a Wave 5.B discovery registry row (ADR-0007).
// Centralized Postgres is intentional for testnet; not on-chain stake.
type GatewayOperator struct {
	ID                uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Slug              string         `gorm:"type:varchar(64);uniqueIndex;not null" json:"slug"`
	DisplayName       string         `gorm:"type:varchar(128);not null" json:"display_name"`
	Pubkey            string         `gorm:"type:varchar(64);not null;default:''" json:"pubkey"`
	BuyerBaseURL      string         `gorm:"type:text;not null" json:"buyer_base_url"`
	HealthURL         string         `gorm:"type:text;not null;default:''" json:"health_url"`
	TunnelAddrs       pq.StringArray `gorm:"type:text[];not null;default:'{}'" json:"tunnel_addrs"`
	PeerURLs          pq.StringArray `gorm:"type:text[];not null;default:'{}'" json:"peer_urls"`
	HostID            string         `gorm:"type:varchar(128);not null;default:''" json:"host_id"`
	OrgID             string         `gorm:"type:varchar(128);not null;default:''" json:"org_id"`
	ManifestPayload   string         `gorm:"type:text;not null;default:''" json:"manifest_payload,omitempty"`
	ManifestSignature string         `gorm:"type:varchar(128);not null;default:''" json:"manifest_signature,omitempty"`
	ManifestExpiresAt *time.Time     `json:"manifest_expires_at,omitempty"`
	StakeAccount      string         `gorm:"type:varchar(64);not null;default:''" json:"stake_account"`
	MinStakeLamports  int64          `gorm:"not null;default:0" json:"min_stake_lamports"`
	Bonded            bool           `gorm:"not null;default:true" json:"bonded"`
	Status            string         `gorm:"type:varchar(20);not null;default:'active'" json:"status"`
	LastHealthyAt     *time.Time     `json:"last_healthy_at,omitempty"`
	LastEdgePodID     string         `gorm:"type:varchar(64);not null;default:''" json:"last_edge_pod_id"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
}

func (GatewayOperator) TableName() string {
	return "gateway_operators"
}
