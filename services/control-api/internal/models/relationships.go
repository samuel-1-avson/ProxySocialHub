package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ProviderBuyerRelationship tracks ongoing relationships between providers and buyers
// This is crucial for PAYG model where relationships are ongoing, not transactional
type ProviderBuyerRelationship struct {
	ID                uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	ProviderID        uuid.UUID `gorm:"type:uuid;not null;index:idx_rel_provider" json:"provider_id"`
	BuyerID           uuid.UUID `gorm:"type:uuid;not null;index:idx_rel_buyer" json:"buyer_id"`
	FirstSessionAt    time.Time `json:"first_session_at"`
	LastSessionAt     *time.Time `json:"last_session_at,omitempty"`
	TotalSessions     int       `gorm:"default:0" json:"total_sessions"`
	TotalBandwidthGB  float64   `gorm:"default:0" json:"total_bandwidth_gb"`
	TotalSpent        float64   `gorm:"default:0" json:"total_spent"`
	RelationshipScore int       `gorm:"default:0" json:"relationship_score"`
	Status            string    `gorm:"size:20;default:'active'" json:"status"` // 'active', 'vip', 'inactive'
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`

	// Preloaded relations
	Provider *User `gorm:"foreignKey:ProviderID" json:"provider,omitempty"`
	Buyer    *User `gorm:"foreignKey:BuyerID" json:"buyer,omitempty"`
}

// TableName sets the table name
func (ProviderBuyerRelationship) TableName() string {
	return "provider_buyer_relationships"
}

// BeforeCreate generates UUID
func (r *ProviderBuyerRelationship) BeforeCreate(tx *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}

// UsageMilestone tracks usage achievements for gamification
type UsageMilestone struct {
	ID            uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	UserID        uuid.UUID `gorm:"type:uuid;not null;index:idx_milestone_user" json:"user_id"`
	ProviderID    *uuid.UUID `gorm:"type:uuid;index:idx_milestone_provider" json:"provider_id,omitempty"`
	MilestoneType string    `gorm:"size:50;not null" json:"milestone_type"` // 'first_gb', 'ten_gb', 'hundred_gb', 'tb_club'
	ThresholdGB   float64   `gorm:"not null" json:"threshold_gb"`
	AchievedAt    time.Time `json:"achieved_at"`
	RewardClaimed bool      `gorm:"default:false" json:"reward_claimed"`
	RewardAmount  float64   `gorm:"default:0" json:"reward_amount"`
	Notified      bool      `gorm:"default:false" json:"notified"`

	// Preloaded relations
	User     *User `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Provider *User `gorm:"foreignKey:ProviderID" json:"provider,omitempty"`
}

// TableName sets the table name
func (UsageMilestone) TableName() string {
	return "usage_milestones"
}

// BeforeCreate generates UUID
func (m *UsageMilestone) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	return nil
}

// MilestoneDefinition represents a milestone tier
type MilestoneDefinition struct {
	Type         string  `json:"type"`
	ThresholdGB  float64 `json:"threshold_gb"`
	RewardAmount float64 `json:"reward_amount"`
	BadgeName    string  `json:"badge_name"`
}

// MilestoneDefinitions defines all available milestones
var MilestoneDefinitions = []MilestoneDefinition{
	{"first_gb", 1, 0, "First Steps"},
	{"ten_gb", 10, 5, "Power User"},
	{"hundred_gb", 100, 25, "Bandwidth Champion"},
	{"five_hundred_gb", 500, 50, "Heavy Hitter"},
	{"tb_club", 1000, 100, "1TB Club"},
}
