package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Circle represents a provider group/pool (Clan)
type Circle struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Name        string    `gorm:"size:100;not null" json:"name"`
	Description string    `json:"description"`
	OwnerID     uuid.UUID `gorm:"type:uuid;not null" json:"owner_id"`
	Visibility  string    `gorm:"size:20;default:'private'" json:"visibility"` // "public" or "private"
	MemberCount int       `gorm:"default:0" json:"member_count"`

	// Enterprise & Clan Features
	IsEnterprise        bool    `gorm:"default:false" json:"is_enterprise"`
	PricePerGB          float64 `gorm:"default:0.50" json:"price_per_gb"`   // Custom pricing
	PriorityLevel       int     `gorm:"default:0" json:"priority_level"`    // 0=normal, 1-5=priority
	BandwidthPoolGB     float64 `gorm:"default:0" json:"bandwidth_pool_gb"` // Shared bandwidth pool
	BandwidthUsedGB     float64 `gorm:"default:0" json:"bandwidth_used_gb"`
	RevenueSharePercent float64 `gorm:"default:0.0" json:"revenue_share_percent"` // 0.0 to 1.0 (e.g. 0.10 = 10%)

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Preloaded relations
	Owner *User `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`
}

// TableName sets the table name for Circle
func (Circle) TableName() string {
	return "circles"
}

// BeforeCreate generates a UUID if not set
func (c *Circle) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	return nil
}

// CircleSLA defines Service Level Agreement for enterprise circles
type CircleSLA struct {
	ID               uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	CircleID         uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"circle_id"`
	UptimeGuarantee  float64   `gorm:"default:99.0" json:"uptime_guarantee"` // Percentage
	MaxLatencyMs     int       `gorm:"default:100" json:"max_latency_ms"`
	MinSuccessRate   float64   `gorm:"default:0.95" json:"min_success_rate"`
	SupportTier      string    `gorm:"default:'standard'" json:"support_tier"` // standard, priority, dedicated
	MaxConcurrency   int       `gorm:"default:100" json:"max_concurrency"`
	IncidentResponse int       `gorm:"default:60" json:"incident_response_mins"` // Minutes
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func (CircleSLA) TableName() string {
	return "circle_slas"
}

// CircleMember represents membership in a circle
type CircleMember struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	CircleID  uuid.UUID `gorm:"type:uuid;not null;index" json:"circle_id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Role      string    `gorm:"size:20;default:'member'" json:"role"`   // "owner", "admin", "member"
	Status    string    `gorm:"size:20;default:'active'" json:"status"` // "active", "pending", "banned"
	JoinedAt  time.Time `json:"joined_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Relations
	User *User `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (CircleMember) TableName() string {
	return "circle_members"
}

// CircleDailyStats tracks daily statistics for a circle
type CircleDailyStats struct {
	ID           uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	CircleID     uuid.UUID `gorm:"type:uuid;not null;index" json:"circle_id"`
	Date         time.Time `gorm:"not null;index" json:"date"`
	TotalBytes   int64     `gorm:"default:0" json:"total_bytes"`
	TotalRevenue float64   `gorm:"default:0" json:"total_revenue"`
	ActiveNodes  int       `gorm:"default:0" json:"active_nodes"`
	Uptime       float64   `gorm:"default:0" json:"uptime"` // Average uptime percentage
	CreatedAt    time.Time `json:"created_at"`
}

func (CircleDailyStats) TableName() string {
	return "circle_stats"
}

// CircleInvite represents an invitation to join a circle
type CircleInvite struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	CircleID  uuid.UUID `gorm:"type:uuid;not null;index" json:"circle_id"`
	InviterID uuid.UUID `gorm:"type:uuid;not null" json:"inviter_id"`
	InviteeID uuid.UUID `gorm:"type:uuid;not null;index" json:"invitee_id"`
	Status    string    `gorm:"size:20;default:'pending'" json:"status"` // "pending", "accepted", "declined", "expired"
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

func (CircleInvite) TableName() string {
	return "circle_invites"
}

// CircleLease represents an enterprise lease of a circle's bandwidth
type CircleLease struct {
	ID              uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	CircleID        uuid.UUID `gorm:"type:uuid;not null;index" json:"circle_id"`
	LesseeUserID    uuid.UUID `gorm:"type:uuid;not null;index" json:"lessee_user_id"`
	Status          string    `gorm:"size:20;default:'active'" json:"status"` // active, expired, cancelled
	BandwidthGB     float64   `gorm:"not null" json:"bandwidth_gb"`
	PricePerGB      float64   `gorm:"not null" json:"price_per_gb"`
	TotalPrice      float64   `gorm:"not null" json:"total_price"`
	BandwidthUsedGB float64   `gorm:"default:0" json:"bandwidth_used_gb"`
	StartsAt        time.Time `json:"starts_at"`
	ExpiresAt       time.Time `json:"expires_at"`
	CreatedAt       time.Time `json:"created_at"`
}

func (CircleLease) TableName() string {
	return "circle_leases"
}

// NewCircle creates a new circle with default values
func NewCircle(name, description string, ownerID uuid.UUID, visibility string) *Circle {
	return &Circle{
		ID:          uuid.New(),
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
func NewEnterpriseCircle(name, description string, ownerID uuid.UUID, bandwidthPoolGB float64, pricePerGB float64) *Circle {
	circle := NewCircle(name, description, ownerID, "private")
	circle.IsEnterprise = true
	circle.BandwidthPoolGB = bandwidthPoolGB
	circle.PricePerGB = pricePerGB
	circle.PriorityLevel = 2 // Default priority for enterprise
	return circle
}

// NewCircleMember creates a new circle membership
func NewCircleMember(circleID, userID uuid.UUID, role string) *CircleMember {
	return &CircleMember{
		ID:        uuid.New(),
		CircleID:  circleID,
		UserID:    userID,
		Role:      role,
		Status:    "active",
		JoinedAt:  time.Now(),
		UpdatedAt: time.Now(),
	}
}

// NewCircleSLA creates a new SLA configuration
func NewCircleSLA(circleID uuid.UUID) *CircleSLA {
	return &CircleSLA{
		ID:               uuid.New(),
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
	CircleID      uuid.UUID `json:"circle_id"`
	Name          string    `json:"name"`
	MemberCount   int       `json:"member_count"`
	TotalBytesGB  float64   `json:"total_bytes_gb"`
	TotalRevenue  float64   `json:"total_revenue"`
	AvgUptime     float64   `json:"avg_uptime"`
	ActiveNodes   int       `json:"active_nodes"`
	Last7DaysGB   float64   `json:"last_7_days_gb"`
	Last30DaysGB  float64   `json:"last_30_days_gb"`
	IsEnterprise  bool      `json:"is_enterprise"`
	PriorityLevel int       `json:"priority_level"`
}

// GetRemainingBandwidth returns remaining bandwidth for enterprise circles
func (c *Circle) GetRemainingBandwidth() float64 {
	if !c.IsEnterprise || c.BandwidthPoolGB <= 0 {
		return -1 // Unlimited
	}
	return c.BandwidthPoolGB - c.BandwidthUsedGB
}

// HasBandwidth checks if circle has remaining bandwidth
// HasBandwidth checks if circle has remaining bandwidth
func (c *Circle) HasBandwidth() bool {
	remaining := c.GetRemainingBandwidth()
	return remaining < 0 || remaining > 0
}

// CirclePost represents a post in a circle's feed
type CirclePost struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	CircleID  uuid.UUID `gorm:"type:uuid;not null;index" json:"circle_id"`
	AuthorID  uuid.UUID `gorm:"type:uuid;not null" json:"author_id"`
	Content   string    `gorm:"type:text;not null" json:"content"`
	Pinned    bool      `gorm:"default:false" json:"pinned"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Relations
	Author *User `gorm:"foreignKey:AuthorID" json:"author,omitempty"`
}

func (CirclePost) TableName() string {
	return "circle_posts"
}
