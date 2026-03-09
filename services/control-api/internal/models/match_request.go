package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// MatchRequest represents a user's request for smart provider selection
type MatchRequest struct {
	ID               uuid.UUID  `gorm:"type:uuid;primary_key" json:"id"`
	UserID           uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	UseCase          string     `gorm:"size:50" json:"use_case"`          // e.g. "web_scraping", "social_media", "streaming"
	PreferredGeo     string     `gorm:"size:10" json:"preferred_geo"`     // ISO country code
	PreferredISP     string     `gorm:"size:100" json:"preferred_isp"`    // ISP name preference
	MaxPricePerGB    float64    `json:"max_price_per_gb"`
	MinUptimePercent float64    `json:"min_uptime_percent"`
	MaxLatencyMs     int        `json:"max_latency_ms"`
	SessionType      string     `gorm:"size:20" json:"session_type"` // rotating|sticky
	RequiredTier     string     `gorm:"size:20" json:"required_tier"` // min tier
	BandwidthGB      float64    `json:"bandwidth_gb"`
	MatchedListingID *uuid.UUID `gorm:"type:uuid" json:"matched_listing_id,omitempty"`
	MatchScore       float64    `json:"match_score"`
	CreatedAt        time.Time  `json:"created_at"`
}

func (MatchRequest) TableName() string {
	return "match_requests"
}

func (m *MatchRequest) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	return nil
}
