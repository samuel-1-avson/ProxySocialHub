package models

import (
	"time"

	"github.com/google/uuid"
)

// Subscription Status
type SubscriptionStatus string

const (
	SubscriptionActive    SubscriptionStatus = "active"
	SubscriptionCancelled SubscriptionStatus = "cancelled"
	SubscriptionExpired   SubscriptionStatus = "expired"
	SubscriptionPastDue   SubscriptionStatus = "past_due"
)

// Billing Cycle
type BillingCycle string

const (
	BillingMonthly BillingCycle = "monthly"
	BillingYearly  BillingCycle = "yearly"
)

// SubscriptionPlan represents a pricing tier
type SubscriptionPlan struct {
	ID               uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Name             string    `gorm:"type:varchar(100);unique;not null" json:"name"`
	Description      string    `gorm:"type:text" json:"description"`
	PriceMonthly     float64   `gorm:"type:numeric(10,2);not null" json:"price_monthly"`
	PriceYearly      float64   `gorm:"type:numeric(10,2)" json:"price_yearly"`
	Features         Features  `gorm:"type:jsonb;serializer:json" json:"features"`
	BandwidthLimitGB *int      `json:"bandwidth_limit_gb"` // NULL = unlimited
	ListingLimit     int       `gorm:"default:5" json:"listing_limit"`
	PrioritySupport  bool      `gorm:"default:false" json:"priority_support"`
	IsActive         bool      `gorm:"default:true" json:"is_active"`
	CreatedAt        time.Time `json:"created_at"`
}

func (SubscriptionPlan) TableName() string {
	return "subscription_plans"
}

// Features for subscription plans
type Features struct {
	APIAccess        bool `json:"api_access"`
	Analytics        bool `json:"analytics"`
	CustomPricing    bool `json:"custom_pricing"`
	TeamMembers      int  `json:"team_members"` // -1 = unlimited
	DedicatedSupport bool `json:"dedicated_support"`
}

// UserSubscription represents a user's active subscription
type UserSubscription struct {
	ID                 uuid.UUID          `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID             uuid.UUID          `gorm:"type:uuid;not null" json:"user_id"`
	PlanID             uuid.UUID          `gorm:"type:uuid;not null" json:"plan_id"`
	Status             SubscriptionStatus `gorm:"type:varchar(50);default:'active'" json:"status"`
	BillingCycle       BillingCycle       `gorm:"type:varchar(20);default:'monthly'" json:"billing_cycle"`
	CurrentPeriodStart time.Time          `gorm:"default:now()" json:"current_period_start"`
	CurrentPeriodEnd   *time.Time         `json:"current_period_end"`
	CancelledAt        *time.Time         `json:"cancelled_at,omitempty"`
	CreatedAt          time.Time          `json:"created_at"`
	UpdatedAt          time.Time          `json:"updated_at"`

	// Relations
	User *User             `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Plan *SubscriptionPlan `gorm:"foreignKey:PlanID" json:"plan,omitempty"`
}

func (UserSubscription) TableName() string {
	return "user_subscriptions"
}

// Request/Response types

type SubscribeRequest struct {
	PlanID       uuid.UUID    `json:"plan_id" binding:"required"`
	BillingCycle BillingCycle `json:"billing_cycle" binding:"required"`
}

type CancelSubscriptionRequest struct {
	Reason string `json:"reason"`
}

type ChangePlanRequest struct {
	NewPlanID uuid.UUID `json:"new_plan_id" binding:"required"`
}
