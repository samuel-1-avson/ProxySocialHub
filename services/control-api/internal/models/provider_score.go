package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ProviderScore represents a provider's on-chain credit score calculated from
// multiple performance metrics. This enables buyers to filter by reputation.
type ProviderScore struct {
	ID         uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	ProviderID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"provider_id"`

	// Performance Metrics (0-100 scale)
	UptimeScore      float64 `gorm:"type:numeric(5,2);default:100" json:"uptime_score"`      // Based on availability
	LatencyScore     float64 `gorm:"type:numeric(5,2);default:100" json:"latency_score"`     // Based on response time
	ReliabilityScore float64 `gorm:"type:numeric(5,2);default:100" json:"reliability_score"` // Based on success rate
	DisputeScore     float64 `gorm:"type:numeric(5,2);default:100" json:"dispute_score"`     // Penalty for disputes

	// Aggregated Score
	OverallScore float64 `gorm:"type:numeric(5,2);default:100" json:"overall_score"` // Weighted average

	// Raw Metrics
	TotalSessions      int64   `gorm:"default:0" json:"total_sessions"`
	SuccessfulSessions int64   `gorm:"default:0" json:"successful_sessions"`
	FailedSessions     int64   `gorm:"default:0" json:"failed_sessions"`
	TotalBytesServed   int64   `gorm:"default:0" json:"total_bytes_served"`
	TotalDisputes      int     `gorm:"default:0" json:"total_disputes"`
	DisputesWon        int     `gorm:"default:0" json:"disputes_won"`
	DisputesLost       int     `gorm:"default:0" json:"disputes_lost"`
	AverageLatencyMs   float64 `gorm:"type:numeric(10,2);default:0" json:"average_latency_ms"`
	UptimePercentage   float64 `gorm:"type:numeric(5,2);default:100" json:"uptime_percentage"`

	// Time Tracking
	FirstSessionAt *time.Time `json:"first_session_at,omitempty"`
	LastSessionAt  *time.Time `json:"last_session_at,omitempty"`
	LastUpdatedAt  time.Time  `json:"last_updated_at"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`

	// Relations
	Provider *User `gorm:"foreignKey:ProviderID" json:"provider,omitempty"`
}

func (ProviderScore) TableName() string {
	return "provider_scores"
}

func (p *ProviderScore) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}

// CalculateOverallScore recalculates the overall score from component scores
// Weights: Uptime 30%, Latency 25%, Reliability 30%, Dispute 15%
func (p *ProviderScore) CalculateOverallScore() {
	p.OverallScore = (p.UptimeScore * 0.30) +
		(p.LatencyScore * 0.25) +
		(p.ReliabilityScore * 0.30) +
		(p.DisputeScore * 0.15)
}

// UpdateUptimeScore updates the uptime score based on uptime percentage
func (p *ProviderScore) UpdateUptimeScore(uptimePct float64) {
	p.UptimePercentage = uptimePct
	// Direct mapping: 100% uptime = 100 score
	p.UptimeScore = uptimePct
	p.CalculateOverallScore()
}

// UpdateLatencyScore updates the latency score based on average latency
// Lower latency = higher score
func (p *ProviderScore) UpdateLatencyScore(avgLatencyMs float64) {
	p.AverageLatencyMs = avgLatencyMs

	// Scoring:
	// < 50ms = 100 (excellent)
	// < 100ms = 90 (great)
	// < 200ms = 75 (good)
	// < 500ms = 50 (acceptable)
	// < 1000ms = 25 (poor)
	// >= 1000ms = 10 (very poor)
	switch {
	case avgLatencyMs < 50:
		p.LatencyScore = 100
	case avgLatencyMs < 100:
		p.LatencyScore = 90
	case avgLatencyMs < 200:
		p.LatencyScore = 75
	case avgLatencyMs < 500:
		p.LatencyScore = 50
	case avgLatencyMs < 1000:
		p.LatencyScore = 25
	default:
		p.LatencyScore = 10
	}
	p.CalculateOverallScore()
}

// UpdateReliabilityScore updates reliability based on success rate
func (p *ProviderScore) UpdateReliabilityScore() {
	if p.TotalSessions == 0 {
		p.ReliabilityScore = 100
		return
	}
	successRate := float64(p.SuccessfulSessions) / float64(p.TotalSessions) * 100
	p.ReliabilityScore = successRate
	p.CalculateOverallScore()
}

// UpdateDisputeScore updates dispute score based on dispute history
func (p *ProviderScore) UpdateDisputeScore() {
	if p.TotalDisputes == 0 {
		p.DisputeScore = 100
		return
	}

	// Penalty: -10 points per lost dispute, max penalty 70 points
	lostPenalty := float64(p.DisputesLost) * 10
	if lostPenalty > 70 {
		lostPenalty = 70
	}

	// Bonus: +2 points per won dispute
	wonBonus := float64(p.DisputesWon) * 2
	if wonBonus > 20 {
		wonBonus = 20
	}

	p.DisputeScore = 100 - lostPenalty + wonBonus
	if p.DisputeScore < 0 {
		p.DisputeScore = 0
	}
	if p.DisputeScore > 100 {
		p.DisputeScore = 100
	}
	p.CalculateOverallScore()
}

// RecordSessionCompletion records a completed session and updates metrics
func (p *ProviderScore) RecordSessionCompletion(success bool, bytesServed int64, latencyMs float64) {
	now := time.Now()
	p.TotalSessions++
	p.TotalBytesServed += bytesServed
	p.LastSessionAt = &now

	if p.FirstSessionAt == nil {
		p.FirstSessionAt = &now
	}

	if success {
		p.SuccessfulSessions++
	} else {
		p.FailedSessions++
	}

	// Update running average latency
	if p.TotalSessions == 1 {
		p.AverageLatencyMs = latencyMs
	} else {
		// Exponential moving average with alpha = 0.1
		p.AverageLatencyMs = p.AverageLatencyMs*0.9 + latencyMs*0.1
	}

	p.UpdateReliabilityScore()
	p.UpdateLatencyScore(p.AverageLatencyMs)
	p.LastUpdatedAt = now
}

// RecordDispute records a dispute and its outcome
func (p *ProviderScore) RecordDispute(won bool) {
	p.TotalDisputes++
	if won {
		p.DisputesWon++
	} else {
		p.DisputesLost++
	}
	p.UpdateDisputeScore()
	p.LastUpdatedAt = time.Now()
}

// GetScoreTier returns a human-readable tier based on overall score
func (p *ProviderScore) GetScoreTier() string {
	switch {
	case p.OverallScore >= 95:
		return "Platinum"
	case p.OverallScore >= 85:
		return "Gold"
	case p.OverallScore >= 70:
		return "Silver"
	case p.OverallScore >= 50:
		return "Bronze"
	default:
		return "Unverified"
	}
}

// GetEarningsMultiplier returns earnings multiplier based on score tier
func (p *ProviderScore) GetEarningsMultiplier() float64 {
	switch p.GetScoreTier() {
	case "Platinum":
		return 1.25 // 25% bonus
	case "Gold":
		return 1.10 // 10% bonus
	case "Silver":
		return 1.00 // Standard rate
	case "Bronze":
		return 0.90 // 10% penalty
	default:
		return 0.80 // 20% penalty
	}
}
