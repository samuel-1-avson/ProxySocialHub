package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CircleQuote represents an enterprise quote request for circle bandwidth
type CircleQuote struct {
	ID             uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	CircleID       uuid.UUID  `gorm:"type:uuid;not null;index" json:"circle_id"`
	RequesterID    uuid.UUID  `gorm:"type:uuid;not null;index" json:"requester_id"`
	
	// Quote details
	BandwidthGB    float64    `gorm:"not null" json:"bandwidth_gb"`
	DurationMonths int        `gorm:"not null" json:"duration_months"`
	BasePrice      float64    `gorm:"not null" json:"base_price"`
	DiscountAmount float64    `gorm:"default:0" json:"discount_amount"`
	FinalPrice     float64    `gorm:"not null" json:"final_price"`
	Requirements   string     `json:"requirements,omitempty"`
	
	// Status
	Status         string     `gorm:"size:20;default:'pending'" json:"status"` // pending, accepted, rejected, expired
	ExpiresAt      time.Time  `json:"expires_at"`
	AcceptedAt     *time.Time `json:"accepted_at,omitempty"`
	
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	
	// Relations
	Circle    *Circle `gorm:"foreignKey:CircleID" json:"circle,omitempty"`
	Requester *User   `gorm:"foreignKey:RequesterID" json:"requester,omitempty"`
}

func (CircleQuote) TableName() string {
	return "circle_quotes"
}

// BeforeCreate generates UUID
func (q *CircleQuote) BeforeCreate(tx *gorm.DB) error {
	if q.ID == uuid.Nil {
		q.ID = uuid.New()
	}
	return nil
}

// CircleSession represents a session using pooled circle bandwidth
type CircleSession struct {
	ID             uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	CircleID       uuid.UUID  `gorm:"type:uuid;not null;index" json:"circle_id"`
	BuyerID        uuid.UUID  `gorm:"type:uuid;not null;index" json:"buyer_id"`
	ProviderID     uuid.UUID  `gorm:"type:uuid;index" json:"provider_id"` // Assigned provider from pool
	QuoteID        *uuid.UUID `gorm:"type:uuid;index" json:"quote_id,omitempty"`
	
	// Usage tracking
	TotalGB        float64    `gorm:"not null" json:"total_gb"`
	UsedGB         float64    `gorm:"default:0" json:"used_gb"`
	DurationMonths int        `gorm:"default:1" json:"duration_months"`
	
	// Status
	Status         string     `gorm:"size:20;default:'active'" json:"status"` // active, paused, completed
	StartedAt      time.Time  `json:"started_at"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	CompletedAt    *time.Time `json:"completed_at,omitempty"`
	
	// Session credentials
	CredentialsUser string `json:"credentials_user,omitempty"`
	CredentialsPass string `json:"credentials_pass,omitempty"`
	Endpoint        string `json:"endpoint,omitempty"`
	
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	
	// Relations
	Circle   *Circle      `gorm:"foreignKey:CircleID" json:"circle,omitempty"`
	Buyer    *User        `gorm:"foreignKey:BuyerID" json:"buyer,omitempty"`
	Provider *User        `gorm:"foreignKey:ProviderID" json:"provider,omitempty"`
	Quote    *CircleQuote `gorm:"foreignKey:QuoteID" json:"quote,omitempty"`
}

func (CircleSession) TableName() string {
	return "circle_sessions"
}

// BeforeCreate generates UUID
func (s *CircleSession) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return nil
}

// CircleRevenue tracks revenue distribution to circle members
type CircleRevenue struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	CircleID    uuid.UUID `gorm:"type:uuid;not null;index" json:"circle_id"`
	ProviderID  uuid.UUID `gorm:"type:uuid;not null;index" json:"provider_id"`
	QuoteID     *uuid.UUID `gorm:"type:uuid;index" json:"quote_id,omitempty"`
	SessionID   *uuid.UUID `gorm:"type:uuid;index" json:"session_id,omitempty"`
	
	// Revenue details
	Amount      float64   `gorm:"not null" json:"amount"`
	RevenueType string    `gorm:"size:50;default:'usage'" json:"revenue_type"` // usage, enterprise_quote, bonus
	
	// Claim status
	Claimed     bool       `gorm:"default:false" json:"claimed"`
	ClaimedAt   *time.Time `json:"claimed_at,omitempty"`
	
	CreatedAt   time.Time  `json:"created_at"`
	
	// Relations
	Circle   *Circle      `gorm:"foreignKey:CircleID" json:"circle,omitempty"`
	Provider *User        `gorm:"foreignKey:ProviderID" json:"provider,omitempty"`
	Quote    *CircleQuote `gorm:"foreignKey:QuoteID" json:"quote,omitempty"`
	Session  *CircleSession `gorm:"foreignKey:SessionID" json:"session,omitempty"`
}

func (CircleRevenue) TableName() string {
	return "circle_revenues"
}

// BeforeCreate generates UUID
func (r *CircleRevenue) BeforeCreate(tx *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}
