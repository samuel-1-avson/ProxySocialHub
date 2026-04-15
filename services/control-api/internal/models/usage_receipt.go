package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type UsageReceiptStatus string

const (
	UsageReceiptPending    UsageReceiptStatus = "pending"
	UsageReceiptAggregated UsageReceiptStatus = "aggregated"
	UsageReceiptSettled    UsageReceiptStatus = "settled"
	UsageReceiptFailed     UsageReceiptStatus = "failed"
)

type SettlementManifestStatus string

const (
	SettlementManifestOpen        SettlementManifestStatus = "open"
	SettlementManifestCoordinated SettlementManifestStatus = "coordinated"
	SettlementManifestSettled     SettlementManifestStatus = "settled"
	SettlementManifestFailed      SettlementManifestStatus = "failed"
)

// UsageReceipt is the append-only accounting record for a single metering flush.
// It is written before the receipt is coordinated into a settlement window.
type UsageReceipt struct {
	ID                uuid.UUID          `gorm:"type:uuid;primaryKey" json:"id"`
	ManifestID        *uuid.UUID         `gorm:"type:uuid;index:idx_usage_receipt_manifest" json:"manifest_id,omitempty"`
	SessionID         uuid.UUID          `gorm:"type:uuid;not null;index:idx_usage_receipt_session" json:"session_id"`
	SessionUsername   string             `gorm:"type:varchar(120);not null;uniqueIndex:idx_usage_receipt_session_nonce" json:"session_username"`
	UserRef           string             `gorm:"type:varchar(120);index:idx_usage_receipt_user" json:"user_ref,omitempty"`
	ProviderRef       string             `gorm:"type:varchar(120);index:idx_usage_receipt_provider" json:"provider_ref,omitempty"`
	ProviderNodeID    string             `gorm:"type:varchar(120)" json:"provider_node_id,omitempty"`
	RouteHost         string             `gorm:"type:varchar(255)" json:"route_host,omitempty"`
	BillingPricePerGB float64            `gorm:"default:0" json:"billing_price_per_gb"`
	BytesUp           int64              `gorm:"not null;default:0" json:"bytes_up"`
	BytesDown         int64              `gorm:"not null;default:0" json:"bytes_down"`
	TotalBytes        int64              `gorm:"not null;default:0" json:"total_bytes"`
	Nonce             uint64             `gorm:"not null;uniqueIndex:idx_usage_receipt_session_nonce" json:"nonce"`
	Signature         string             `gorm:"type:text" json:"signature,omitempty"`
	Source            string             `gorm:"type:varchar(32);not null;default:'gateway_report'" json:"source"`
	Status            UsageReceiptStatus `gorm:"type:varchar(20);not null;default:'pending';index:idx_usage_receipt_status" json:"status"`
	ReportedAt        time.Time          `gorm:"not null;index:idx_usage_receipt_reported_at" json:"reported_at"`
	AggregatedAt      *time.Time         `json:"aggregated_at,omitempty"`
	SettledAt         *time.Time         `json:"settled_at,omitempty"`
	LastError         *string            `gorm:"type:text" json:"last_error,omitempty"`
	CreatedAt         time.Time          `json:"created_at"`
	UpdatedAt         time.Time          `json:"updated_at"`

	Manifest *SettlementManifest `gorm:"foreignKey:ManifestID" json:"manifest,omitempty"`
}

func (UsageReceipt) TableName() string {
	return "usage_receipts"
}

func (u *UsageReceipt) BeforeCreate(tx *gorm.DB) error {
	if u.ID == uuid.Nil {
		u.ID = uuid.New()
	}
	if u.TotalBytes == 0 {
		u.TotalBytes = u.BytesUp + u.BytesDown
	}
	if u.ReportedAt.IsZero() {
		u.ReportedAt = time.Now().UTC()
	}
	return nil
}

// SettlementManifest is the durable coordinator boundary between raw receipts
// and the downstream settlement workers.
type SettlementManifest struct {
	ID              uuid.UUID                `gorm:"type:uuid;primaryKey" json:"id"`
	WindowKey       string                   `gorm:"type:varchar(160);not null;uniqueIndex:idx_settlement_manifest_window_key" json:"window_key"`
	SessionID       uuid.UUID                `gorm:"type:uuid;not null;index:idx_settlement_manifest_session" json:"session_id"`
	SessionUsername string                   `gorm:"type:varchar(120);not null" json:"session_username"`
	UserRef         string                   `gorm:"type:varchar(120);index:idx_settlement_manifest_user" json:"user_ref,omitempty"`
	ProviderRef     string                   `gorm:"type:varchar(120);index:idx_settlement_manifest_provider" json:"provider_ref,omitempty"`
	ReceiptCount    int                      `gorm:"not null;default:0" json:"receipt_count"`
	TotalBytesUp    int64                    `gorm:"not null;default:0" json:"total_bytes_up"`
	TotalBytesDown  int64                    `gorm:"not null;default:0" json:"total_bytes_down"`
	TotalBytes      int64                    `gorm:"not null;default:0" json:"total_bytes"`
	Status          SettlementManifestStatus `gorm:"type:varchar(20);not null;default:'open';index:idx_settlement_manifest_status" json:"status"`
	WindowStartedAt time.Time                `gorm:"not null" json:"window_started_at"`
	WindowEndedAt   time.Time                `gorm:"not null" json:"window_ended_at"`
	LastReceiptAt   time.Time                `gorm:"not null" json:"last_receipt_at"`
	CoordinatedAt   *time.Time               `json:"coordinated_at,omitempty"`
	SettledAt       *time.Time               `json:"settled_at,omitempty"`
	LastError       *string                  `gorm:"type:text" json:"last_error,omitempty"`
	CreatedAt       time.Time                `json:"created_at"`
	UpdatedAt       time.Time                `json:"updated_at"`

	Receipts []UsageReceipt `gorm:"foreignKey:ManifestID" json:"receipts,omitempty"`
}

func (SettlementManifest) TableName() string {
	return "settlement_manifests"
}

func (s *SettlementManifest) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return nil
}
