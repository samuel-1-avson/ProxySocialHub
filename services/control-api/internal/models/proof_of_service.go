package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ProofOfService represents a provider's performance metrics for a given period
// These are reported by the Edge Gateway and used by validators to set weights
type ProofOfService struct {
	ID         uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	ProviderID uuid.UUID `gorm:"type:uuid;not null;index" json:"provider_id"`
	NodeID     uuid.UUID `gorm:"type:uuid;not null;index" json:"node_id"`

	// Performance Metrics
	UptimePercentage float64 `gorm:"not null" json:"uptime_percentage"`  // 0-100
	AvgLatencyMs     int     `gorm:"not null" json:"avg_latency_ms"`     // Average response time
	TotalBytesServed int64   `gorm:"not null" json:"total_bytes_served"` // Bandwidth served in period
	TotalRequests    int64   `gorm:"not null" json:"total_requests"`     // Number of requests handled
	SuccessRate      float64 `gorm:"not null" json:"success_rate"`       // 0-100, % of successful requests

	// Quality Metrics
	UniqueIPsServed int     `gorm:"default:0" json:"unique_ips_served"` // Diversity of clients
	GeoDiversity    float64 `gorm:"default:0" json:"geo_diversity"`     // 0-1, score based on geo spread

	// Time Period
	PeriodStart time.Time `gorm:"not null;index" json:"period_start"`
	PeriodEnd   time.Time `gorm:"not null" json:"period_end"`

	// Verification
	Verified   bool       `gorm:"default:false" json:"verified"` // Has been verified by validator
	VerifiedAt *time.Time `json:"verified_at,omitempty"`
	VerifiedBy *uuid.UUID `gorm:"type:uuid" json:"verified_by,omitempty"` // Validator ID

	// Score calculated from metrics
	QualityScore float64 `gorm:"default:0" json:"quality_score"` // 0-100, combined score

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Relations
	Provider *User         `gorm:"foreignKey:ProviderID" json:"provider,omitempty"`
	Node     *ProviderNode `gorm:"foreignKey:NodeID" json:"node,omitempty"`
}

func (p *ProofOfService) BeforeCreate(tx *gorm.DB) (err error) {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return
}

// CalculateQualityScore computes a weighted quality score from the metrics
func (p *ProofOfService) CalculateQualityScore() float64 {
	// Weight factors (sum to 1.0)
	const (
		uptimeWeight      = 0.30
		latencyWeight     = 0.20
		successRateWeight = 0.25
		bandwidthWeight   = 0.15
		diversityWeight   = 0.10
	)

	// Normalize latency (lower is better, cap at 500ms as "worst")
	latencyScore := 100.0 - (float64(p.AvgLatencyMs) / 5.0)
	if latencyScore < 0 {
		latencyScore = 0
	}

	// Normalize bandwidth (log scale, 1GB = 100 points base)
	bandwidthScore := float64(p.TotalBytesServed) / (1024 * 1024 * 1024) * 10
	if bandwidthScore > 100 {
		bandwidthScore = 100
	}

	// Combine scores
	p.QualityScore = (p.UptimePercentage * uptimeWeight) +
		(latencyScore * latencyWeight) +
		(p.SuccessRate * successRateWeight) +
		(bandwidthScore * bandwidthWeight) +
		(p.GeoDiversity * 100 * diversityWeight)

	return p.QualityScore
}

// MinerWeight represents the weight a validator assigns to a miner
type MinerWeight struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	ValidatorID uuid.UUID `gorm:"type:uuid;not null;index" json:"validator_id"`
	MinerID     uuid.UUID `gorm:"type:uuid;not null;index" json:"miner_id"` // Provider/Node ID
	NetUID      int       `gorm:"not null" json:"net_uid"`                  // Subnet ID
	Weight      float64   `gorm:"not null" json:"weight"`                   // 0-1 normalized weight

	EpochNumber int `gorm:"not null;index" json:"epoch_number"` // Bittensor epoch

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (m *MinerWeight) BeforeCreate(tx *gorm.DB) (err error) {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	return
}
