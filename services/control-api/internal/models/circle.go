package models

import (
	"time"

	"github.com/google/uuid"
)

// Circle represents a provider group/pool
type Circle struct {
	ID          string    `json:"id" gorm:"primaryKey"`
	Name        string    `json:"name" gorm:"not null"`
	Description string    `json:"description"`
	OwnerID     string    `json:"owner_id" gorm:"not null"`
	Visibility  string    `json:"visibility" gorm:"default:'private'"` // "public" or "private"
	MemberCount int       `json:"member_count" gorm:"default:0"`
	
	// Enterprise Features
	IsEnterprise      bool    `json:"is_enterprise" gorm:"default:false"`
	PricePerGB        float64 `json:"price_per_gb" gorm:"default:0.50"`        // Custom pricing
	PriorityLevel     int     `json:"priority_level" gorm:"default:0"`         // 0=normal, 1-5=priority
	BandwidthPoolGB   float64 `json:"bandwidth_pool_gb" gorm:"default:0"`      // Shared bandwidth pool
	BandwidthUsedGB   float64 `json:"bandwidth_used_gb" gorm:"default:0"`
	
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// CircleSLA defines Service Level Agreement for enterprise circles
type CircleSLA struct {
	ID                string    `json:"id" gorm:"primaryKey"`
	CircleID          string    `json:"circle_id" gorm:"not null;uniqueIndex"`
	UptimeGuarantee   float64   `json:"uptime_guarantee" gorm:"default:99.0"`     // Percentage
	MaxLatencyMs      int       `json:"max_latency_ms" gorm:"default:100"`
	MinSuccessRate    float64   `json:"min_success_rate" gorm:"default:0.95"`
	SupportTier       string    `json:"support_tier" gorm:"default:'standard'"`   // standard, priority, dedicated
	MaxConcurrency    int       `json:"max_concurrency" gorm:"default:100"`
	IncidentResponse  int       `json:"incident_response_mins" gorm:"default:60"` // Minutes
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// CircleMember represents membership in a circle
type CircleMember struct {
	ID        string    `json:"id" gorm:"primaryKey"`
	CircleID  string    `json:"circle_id" gorm:"not null;index"`
	UserID    string    `json:"user_id" gorm:"not null;index"`
	Role      string    `json:"role" gorm:"default:'member'"` // "owner", "admin", "member"
	Status    string    `json:"status" gorm:"default:'active'"` // "active", "pending", "banned"
	JoinedAt  time.Time `json:"joined_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// CircleDailyStats tracks daily statistics for a circle
type CircleDailyStats struct {
	ID           string    `json:"id" gorm:"primaryKey"`
	CircleID     string    `json:"circle_id" gorm:"not null;index"`
	Date         time.Time `json:"date" gorm:"not null;index"`
	TotalBytes   int64     `json:"total_bytes" gorm:"default:0"`
	TotalRevenue float64   `json:"total_revenue" gorm:"default:0"`
	ActiveNodes  int       `json:"active_nodes" gorm:"default:0"`
	Uptime       float64   `json:"uptime" gorm:"default:0"` // Average uptime percentage
	CreatedAt    time.Time `json:"created_at"`
}

// CircleInvite represents an invitation to join a circle
type CircleInvite struct {
	ID        string    `json:"id" gorm:"primaryKey"`
	CircleID  string    `json:"circle_id" gorm:"not null;index"`
	InviterID string    `json:"inviter_id" gorm:"not null"`
	InviteeID string    `json:"invitee_id" gorm:"not null;index"`
	Status    string    `json:"status" gorm:"default:'pending'"` // "pending", "accepted", "declined", "expired"
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

// CircleLease represents an enterprise lease of a circle's bandwidth
type CircleLease struct {
	ID              string    `json:"id" gorm:"primaryKey"`
	CircleID        string    `json:"circle_id" gorm:"not null;index"`
	LesseeUserID    string    `json:"lessee_user_id" gorm:"not null;index"`
	Status          string    `json:"status" gorm:"default:'active'"` // active, expired, cancelled
	BandwidthGB     float64   `json:"bandwidth_gb" gorm:"not null"`
	PricePerGB      float64   `json:"price_per_gb" gorm:"not null"`
	TotalPrice      float64   `json:"total_price" gorm:"not null"`
	BandwidthUsedGB float64   `json:"bandwidth_used_gb" gorm:"default:0"`
	StartsAt        time.Time `json:"starts_at"`
	ExpiresAt       time.Time `json:"expires_at"`
	CreatedAt       time.Time `json:"created_at"`
}

// NewCircle creates a new circle with default values
func NewCircle(name, description, ownerID string, visibility string) *Circle {
	return &Circle{
		ID:          uuid.New().String(),
		Name:        name,
		Description: description,
		OwnerID:     ownerID,
		Visibility:  visibility,
		MemberCount: 1, // Owner counts as member
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
}

// NewEnterpriseCircle creates a new enterprise circle with SLA defaults
func NewEnterpriseCircle(name, description, ownerID string, bandwidthPoolGB float64, pricePerGB float64) *Circle {
	circle := NewCircle(name, description, ownerID, "private")
	circle.IsEnterprise = true
	circle.BandwidthPoolGB = bandwidthPoolGB
	circle.PricePerGB = pricePerGB
	circle.PriorityLevel = 2 // Default priority for enterprise
	return circle
}

// NewCircleMember creates a new circle membership
func NewCircleMember(circleID, userID, role string) *CircleMember {
	return &CircleMember{
		ID:        uuid.New().String(),
		CircleID:  circleID,
		UserID:    userID,
		Role:      role,
		Status:    "active",
		JoinedAt:  time.Now(),
		UpdatedAt: time.Now(),
	}
}

// NewCircleSLA creates a new SLA configuration
func NewCircleSLA(circleID string) *CircleSLA {
	return &CircleSLA{
		ID:               uuid.New().String(),
		CircleID:         circleID,
		UptimeGuarantee:  99.0,
		MaxLatencyMs:     100,
		MinSuccessRate:   0.95,
		SupportTier:      "standard",
		MaxConcurrency:   100,
		IncidentResponse: 60,
		CreatedAt:        time.Now(),
		UpdatedAt:        time.Now(),
	}
}

// CircleStats is returned by the stats endpoint
type CircleStats struct {
	CircleID      string  `json:"circle_id"`
	Name          string  `json:"name"`
	MemberCount   int     `json:"member_count"`
	TotalBytesGB  float64 `json:"total_bytes_gb"`
	TotalRevenue  float64 `json:"total_revenue"`
	AvgUptime     float64 `json:"avg_uptime"`
	ActiveNodes   int     `json:"active_nodes"`
	Last7DaysGB   float64 `json:"last_7_days_gb"`
	Last30DaysGB  float64 `json:"last_30_days_gb"`
	IsEnterprise  bool    `json:"is_enterprise"`
	PriorityLevel int     `json:"priority_level"`
}

// GetRemainingBandwidth returns remaining bandwidth for enterprise circles
func (c *Circle) GetRemainingBandwidth() float64 {
	if !c.IsEnterprise || c.BandwidthPoolGB <= 0 {
		return -1 // Unlimited
	}
	return c.BandwidthPoolGB - c.BandwidthUsedGB
}

// HasBandwidth checks if circle has remaining bandwidth
func (c *Circle) HasBandwidth() bool {
	remaining := c.GetRemainingBandwidth()
	return remaining < 0 || remaining > 0
}
