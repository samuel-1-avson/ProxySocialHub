package models

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"gorm.io/gorm"
)

// ValidatorStatus represents the state of a validator
type ValidatorStatus string

const (
	ValidatorPending  ValidatorStatus = "pending"  // Awaiting stake
	ValidatorActive   ValidatorStatus = "active"   // Actively validating
	ValidatorSlashed  ValidatorStatus = "slashed"  // Slashed for dishonesty
	ValidatorInactive ValidatorStatus = "inactive" // Voluntarily inactive
)

// Validator represents a quality attestation validator on Bittensor subnet
type Validator struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_validator_user" json:"user_id"`

	// Bittensor Identity
	Hotkey  string `gorm:"type:varchar(64);not null;uniqueIndex:idx_validator_hotkey" json:"hotkey"`
	Coldkey string `gorm:"type:varchar(64)" json:"coldkey"`
	NetUID  int    `gorm:"not null;default:1" json:"net_uid"` // Bittensor subnet UID

	// Stake & Trust
	StakedAmount     float64 `gorm:"default:0" json:"staked_amount"` // TAO staked
	MinStakeRequired float64 `gorm:"default:10" json:"min_stake_required"`
	TrustScore       float64 `gorm:"default:100" json:"trust_score"` // 0-100

	// Performance
	TotalAttestations    int     `gorm:"default:0" json:"total_attestations"`
	AccurateAttestations int     `gorm:"default:0" json:"accurate_attestations"`
	DisputedAttestations int     `gorm:"default:0" json:"disputed_attestations"`
	AccuracyRate         float64 `gorm:"default:100" json:"accuracy_rate"` // Percent

	// Economics
	TotalEarnings  float64 `gorm:"default:0" json:"total_earnings"`
	PendingRewards float64 `gorm:"default:0" json:"pending_rewards"`
	SlashedAmount  float64 `gorm:"default:0" json:"slashed_amount"`

	// Status
	Status       ValidatorStatus `gorm:"type:varchar(20);default:'pending'" json:"status"`
	LastActiveAt *time.Time      `json:"last_active_at,omitempty"`
	JoinedAt     time.Time       `json:"joined_at"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`

	// Relations
	User         *User                `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Attestations []QualityAttestation `gorm:"foreignKey:ValidatorID" json:"attestations,omitempty"`
}

func (Validator) TableName() string {
	return "validators"
}

func (v *Validator) BeforeCreate(tx *gorm.DB) error {
	if v.ID == uuid.Nil {
		v.ID = uuid.New()
	}
	v.JoinedAt = time.Now()
	return nil
}

// CanValidate checks if validator is eligible to submit attestations
func (v *Validator) CanValidate() bool {
	return v.Status == ValidatorActive &&
		v.StakedAmount >= v.MinStakeRequired &&
		v.TrustScore >= 20 // Minimum trust score
}

// UpdateAccuracyRate recalculates accuracy from attestation history
func (v *Validator) UpdateAccuracyRate() {
	if v.TotalAttestations == 0 {
		v.AccuracyRate = 100
		return
	}
	v.AccuracyRate = float64(v.AccurateAttestations) / float64(v.TotalAttestations) * 100
}

// QualityAttestation represents a validator's quality assessment of a provider
type QualityAttestation struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	ValidatorID uuid.UUID `gorm:"type:uuid;not null;index:idx_attestation_validator" json:"validator_id"`
	ProviderID  uuid.UUID `gorm:"type:uuid;not null;index:idx_attestation_provider" json:"provider_id"`
	NodeID      uuid.UUID `gorm:"type:uuid;index:idx_attestation_node" json:"node_id"`

	// Quality Metrics (0-100 scale)
	LatencyScore     int `gorm:"not null" json:"latency_score"`      // Based on measured latency
	UptimeScore      int `gorm:"not null" json:"uptime_score"`       // Based on availability checks
	SuccessRateScore int `gorm:"not null" json:"success_rate_score"` // Based on request success
	BandwidthScore   int `gorm:"not null" json:"bandwidth_score"`    // Based on throughput

	// Computed overall score
	OverallScore float64 `gorm:"not null" json:"overall_score"`

	// Raw measurements
	MeasuredLatencyMs     int     `json:"measured_latency_ms"`
	MeasuredUptimePct     float64 `json:"measured_uptime_pct"`
	MeasuredSuccessRate   float64 `json:"measured_success_rate"`
	MeasuredBandwidthMbps float64 `json:"measured_bandwidth_mbps"`

	// Cryptographic proof
	MessageHash string `gorm:"type:varchar(64);not null" json:"message_hash"`
	Signature   string `gorm:"type:varchar(128);not null" json:"signature"` // Ed25519

	// Consensus
	IsInConsensus    bool       `gorm:"default:false" json:"is_in_consensus"`
	ConsensusRoundID *uuid.UUID `gorm:"type:uuid" json:"consensus_round_id,omitempty"`

	// Status
	IsValid       bool       `gorm:"default:true" json:"is_valid"`
	DisputedBy    *uuid.UUID `gorm:"type:uuid" json:"disputed_by,omitempty"`
	DisputeReason string     `gorm:"type:text" json:"dispute_reason,omitempty"`

	CreatedAt time.Time `json:"created_at"`

	// Relations
	Validator *Validator `gorm:"foreignKey:ValidatorID" json:"validator,omitempty"`
	Provider  *User      `gorm:"foreignKey:ProviderID" json:"provider,omitempty"`
	Node      *Node      `gorm:"foreignKey:NodeID" json:"node,omitempty"`
}

func (QualityAttestation) TableName() string {
	return "quality_attestations"
}

func (q *QualityAttestation) BeforeCreate(tx *gorm.DB) error {
	if q.ID == uuid.Nil {
		q.ID = uuid.New()
	}
	// Calculate overall score (weighted average)
	q.OverallScore = float64(q.LatencyScore)*0.3 +
		float64(q.UptimeScore)*0.3 +
		float64(q.SuccessRateScore)*0.25 +
		float64(q.BandwidthScore)*0.15
	return nil
}

// GenerateMessage creates the canonical message to be signed
func (q *QualityAttestation) GenerateMessage() []byte {
	msg := fmt.Sprintf(
		"PROXYHUB_QUALITY_ATTESTATION:v1:%s:%s:%d:%d:%d:%d:%d",
		q.ValidatorID.String(),
		q.ProviderID.String(),
		q.LatencyScore,
		q.UptimeScore,
		q.SuccessRateScore,
		q.BandwidthScore,
		q.CreatedAt.Unix(),
	)
	return []byte(msg)
}

// ComputeMessageHash computes SHA256 hash of the message
func (q *QualityAttestation) ComputeMessageHash() string {
	msg := q.GenerateMessage()
	hash := sha256.Sum256(msg)
	return hex.EncodeToString(hash[:])
}

// SetMessageHash computes and sets the message hash
func (q *QualityAttestation) SetMessageHash() {
	q.MessageHash = q.ComputeMessageHash()
}

// VerifySignature verifies the validator's Ed25519 signature
func (q *QualityAttestation) VerifySignature(validatorHotkey string) (bool, error) {
	if q.Signature == "" {
		return false, fmt.Errorf("signature not provided")
	}

	pubKeyBytes, err := base58.Decode(validatorHotkey)
	if err != nil {
		return false, fmt.Errorf("invalid hotkey: %w", err)
	}

	sigBytes, err := base58.Decode(q.Signature)
	if err != nil {
		return false, fmt.Errorf("invalid signature encoding: %w", err)
	}

	if len(pubKeyBytes) != ed25519.PublicKeySize {
		return false, fmt.Errorf("invalid public key length")
	}

	if len(sigBytes) != ed25519.SignatureSize {
		return false, fmt.Errorf("invalid signature length")
	}

	msg := q.GenerateMessage()
	return ed25519.Verify(pubKeyBytes, msg, sigBytes), nil
}

// ConsensusRound represents a quality consensus round for a provider
type ConsensusRound struct {
	ID         uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	ProviderID uuid.UUID `gorm:"type:uuid;not null;index:idx_consensus_provider" json:"provider_id"`
	NodeID     uuid.UUID `gorm:"type:uuid;index:idx_consensus_node" json:"node_id"`

	// Round parameters
	MinValidators int     `gorm:"default:3" json:"min_validators"`
	MaxDeviation  float64 `gorm:"default:15" json:"max_deviation"` // Max % deviation from median

	// Collected attestations
	AttestationCount int `gorm:"default:0" json:"attestation_count"`

	// Consensus results
	ConsensusScore   float64 `gorm:"default:0" json:"consensus_score"` // Median score
	ConsensusReached bool    `gorm:"default:false" json:"consensus_reached"`

	// Individual metric consensus
	ConsensusLatency     int `gorm:"default:0" json:"consensus_latency"`
	ConsensusUptime      int `gorm:"default:0" json:"consensus_uptime"`
	ConsensusSuccessRate int `gorm:"default:0" json:"consensus_success_rate"`
	ConsensusBandwidth   int `gorm:"default:0" json:"consensus_bandwidth"`

	// Timing
	StartedAt   time.Time  `json:"started_at"`
	FinalizedAt *time.Time `json:"finalized_at,omitempty"`
	ExpiresAt   time.Time  `json:"expires_at"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Relations
	Provider     *User                `gorm:"foreignKey:ProviderID" json:"provider,omitempty"`
	Attestations []QualityAttestation `gorm:"foreignKey:ConsensusRoundID" json:"attestations,omitempty"`
}

func (ConsensusRound) TableName() string {
	return "consensus_rounds"
}

func (c *ConsensusRound) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	c.StartedAt = time.Now()
	c.ExpiresAt = time.Now().Add(1 * time.Hour) // 1 hour to collect attestations
	return nil
}

// CalculateConsensus computes consensus from collected attestations
func (c *ConsensusRound) CalculateConsensus(attestations []QualityAttestation) {
	if len(attestations) < c.MinValidators {
		return // Not enough validators
	}

	c.AttestationCount = len(attestations)

	// Collect scores for median calculation
	overallScores := make([]float64, len(attestations))
	latencyScores := make([]int, len(attestations))
	uptimeScores := make([]int, len(attestations))
	successScores := make([]int, len(attestations))
	bandwidthScores := make([]int, len(attestations))

	for i, a := range attestations {
		overallScores[i] = a.OverallScore
		latencyScores[i] = a.LatencyScore
		uptimeScores[i] = a.UptimeScore
		successScores[i] = a.SuccessRateScore
		bandwidthScores[i] = a.BandwidthScore
	}

	// Calculate medians
	c.ConsensusScore = medianFloat(overallScores)
	c.ConsensusLatency = medianInt(latencyScores)
	c.ConsensusUptime = medianInt(uptimeScores)
	c.ConsensusSuccessRate = medianInt(successScores)
	c.ConsensusBandwidth = medianInt(bandwidthScores)
	c.ConsensusReached = true

	now := time.Now()
	c.FinalizedAt = &now
}

// Helper functions for median calculation
func medianFloat(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)
	mid := len(sorted) / 2
	if len(sorted)%2 == 0 {
		return (sorted[mid-1] + sorted[mid]) / 2
	}
	return sorted[mid]
}

func medianInt(values []int) int {
	if len(values) == 0 {
		return 0
	}
	sorted := make([]int, len(values))
	copy(sorted, values)
	sort.Ints(sorted)
	mid := len(sorted) / 2
	if len(sorted)%2 == 0 {
		return (sorted[mid-1] + sorted[mid]) / 2
	}
	return sorted[mid]
}

// CreateAttestationRequest for API binding
type CreateAttestationRequest struct {
	ProviderID uuid.UUID `json:"provider_id" binding:"required"`
	NodeID     uuid.UUID `json:"node_id"`

	LatencyScore     int `json:"latency_score" binding:"min=0,max=100"`
	UptimeScore      int `json:"uptime_score" binding:"min=0,max=100"`
	SuccessRateScore int `json:"success_rate_score" binding:"min=0,max=100"`
	BandwidthScore   int `json:"bandwidth_score" binding:"min=0,max=100"`

	// Raw measurements
	MeasuredLatencyMs     int     `json:"measured_latency_ms"`
	MeasuredUptimePct     float64 `json:"measured_uptime_pct"`
	MeasuredSuccessRate   float64 `json:"measured_success_rate"`
	MeasuredBandwidthMbps float64 `json:"measured_bandwidth_mbps"`

	Signature string `json:"signature" binding:"required"`
}

// ValidatorRegistrationRequest for API binding
type ValidatorRegistrationRequest struct {
	Hotkey  string `json:"hotkey" binding:"required"`
	Coldkey string `json:"coldkey"`
	NetUID  int    `json:"net_uid"`
}
