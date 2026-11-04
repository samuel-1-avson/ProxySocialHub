package models

import (
	"time"

	"github.com/google/uuid"
)

// ProxyAssessment is immutable evidence for a particular node configuration and price quote.
// Only the worker writes measurements. Provider input is limited to the offer configuration.
type ProxyAssessment struct {
	ID                uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	SellerID          uuid.UUID  `gorm:"type:uuid;not null" json:"-"`
	ProviderNodeID    uuid.UUID  `gorm:"type:uuid;not null" json:"provider_node_id"`
	ConfigurationHash string     `json:"-"`
	ProxyType         string     `json:"proxy_type"`
	Protocol          string     `json:"protocol"`
	RotationType      string     `json:"rotation_type"`
	Country           string     `json:"country"`
	MaxConcurrency    int        `json:"max_concurrency"`
	Status            string     `json:"status"`
	PolicyVersion     string     `json:"policy_version"`
	QualityScore      float64    `json:"quality_score"`
	Tier              string     `json:"tier"`
	PricePerGB        float64    `json:"price_per_gb"`
	Confidence        float64    `json:"confidence"`
	Provisional       bool       `json:"provisional"`
	Samples           int        `json:"samples"`
	SuccessfulSamples int        `json:"successful_samples"`
	LatencyP50Ms      float64    `json:"latency_p50_ms"`
	LatencyP95Ms      float64    `json:"latency_p95_ms"`
	ThroughputMbps    float64    `json:"throughput_mbps"`
	BytesTransferred  int64      `json:"bytes_transferred"`
	Summary           string     `json:"summary"`
	CreatedAt         time.Time  `json:"created_at"`
	StartedAt         *time.Time `json:"started_at,omitempty"`
	CompletedAt       *time.Time `json:"completed_at,omitempty"`
	ValidUntil        *time.Time `json:"valid_until,omitempty"`
}

func (ProxyAssessment) TableName() string { return "proxy_assessments" }
