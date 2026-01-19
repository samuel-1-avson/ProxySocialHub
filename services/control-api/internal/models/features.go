package models

import (
	"time"

	"github.com/google/uuid"
)

// ============ Referral Program ============

type ReferralCode struct {
	ID            uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID        uuid.UUID `gorm:"type:uuid;not null" json:"user_id"`
	Code          string    `gorm:"type:varchar(20);unique;not null" json:"code"`
	UsesCount     int       `gorm:"default:0" json:"uses_count"`
	TotalEarnings float64   `gorm:"type:numeric(20,4);default:0" json:"total_earnings"`
	IsActive      bool      `gorm:"default:true" json:"is_active"`
	CreatedAt     time.Time `json:"created_at"`

	User *User `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (ReferralCode) TableName() string {
	return "referral_codes"
}

type RewardType string

const (
	RewardSignup        RewardType = "signup"
	RewardFirstPurchase RewardType = "first_purchase"
	RewardSubscription  RewardType = "subscription"
)

type RewardStatus string

const (
	RewardPending  RewardStatus = "pending"
	RewardCredited RewardStatus = "credited"
	RewardExpired  RewardStatus = "expired"
)

type ReferralReward struct {
	ID           uuid.UUID    `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	ReferrerID   uuid.UUID    `gorm:"type:uuid;not null" json:"referrer_id"`
	ReferredID   uuid.UUID    `gorm:"type:uuid;not null" json:"referred_id"`
	ReferralCode string       `gorm:"type:varchar(20);not null" json:"referral_code"`
	RewardAmount float64      `gorm:"type:numeric(20,4);not null" json:"reward_amount"`
	RewardType   RewardType   `gorm:"type:varchar(50);default:'signup'" json:"reward_type"`
	Status       RewardStatus `gorm:"type:varchar(50);default:'pending'" json:"status"`
	CreditedAt   *time.Time   `json:"credited_at,omitempty"`
	CreatedAt    time.Time    `json:"created_at"`

	Referrer *User `gorm:"foreignKey:ReferrerID" json:"referrer,omitempty"`
	Referred *User `gorm:"foreignKey:ReferredID" json:"referred,omitempty"`
}

func (ReferralReward) TableName() string {
	return "referral_rewards"
}

// ============ Favorites ============

type Favorite struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null" json:"user_id"`
	ListingID uuid.UUID `gorm:"type:uuid;not null" json:"listing_id"`
	CreatedAt time.Time `json:"created_at"`

	Listing *ProxyListing `gorm:"foreignKey:ListingID" json:"listing,omitempty"`
}

func (Favorite) TableName() string {
	return "favorites"
}

// ============ Saved Searches ============

type SearchFilters struct {
	MinPrice  *float64 `json:"min_price,omitempty"`
	MaxPrice  *float64 `json:"max_price,omitempty"`
	Country   string   `json:"country,omitempty"`
	City      string   `json:"city,omitempty"`
	ProxyType string   `json:"proxy_type,omitempty"`
	MinRating float64  `json:"min_rating,omitempty"`
}

type SavedSearch struct {
	ID             uuid.UUID     `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID         uuid.UUID     `gorm:"type:uuid;not null" json:"user_id"`
	Name           string        `gorm:"type:varchar(100);not null" json:"name"`
	Filters        SearchFilters `gorm:"type:jsonb;serializer:json" json:"filters"`
	NotifyOnMatch  bool          `gorm:"default:true" json:"notify_on_match"`
	LastNotifiedAt *time.Time    `json:"last_notified_at,omitempty"`
	CreatedAt      time.Time     `json:"created_at"`
}

func (SavedSearch) TableName() string {
	return "saved_searches"
}

// ============ IP Allowlist ============

type IPAllowlist struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null" json:"user_id"`
	IPAddress string    `gorm:"type:inet;not null" json:"ip_address"`
	Label     string    `gorm:"type:varchar(100)" json:"label"`
	IsActive  bool      `gorm:"default:true" json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
}

func (IPAllowlist) TableName() string {
	return "ip_allowlists"
}

// ============ Teams ============

type Team struct {
	ID         uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Name       string    `gorm:"type:varchar(100);not null" json:"name"`
	OwnerID    uuid.UUID `gorm:"type:uuid;not null" json:"owner_id"`
	MaxMembers int       `gorm:"default:5" json:"max_members"`
	CreatedAt  time.Time `json:"created_at"`

	Owner   *User        `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`
	Members []TeamMember `gorm:"foreignKey:TeamID" json:"members,omitempty"`
}

func (Team) TableName() string {
	return "teams"
}

type TeamRole string

const (
	TeamRoleOwner  TeamRole = "owner"
	TeamRoleAdmin  TeamRole = "admin"
	TeamRoleMember TeamRole = "member"
)

type TeamMember struct {
	ID       uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	TeamID   uuid.UUID `gorm:"type:uuid;not null" json:"team_id"`
	UserID   uuid.UUID `gorm:"type:uuid;not null" json:"user_id"`
	Role     TeamRole  `gorm:"type:varchar(50);default:'member'" json:"role"`
	JoinedAt time.Time `json:"joined_at"`

	User *User `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Team *Team `gorm:"foreignKey:TeamID" json:"team,omitempty"`
}

func (TeamMember) TableName() string {
	return "team_members"
}

// ============ Provider Nodes ============

type NodeStatus string

const (
	NodeOnline      NodeStatus = "online"
	NodeOffline     NodeStatus = "offline"
	NodeMaintenance NodeStatus = "maintenance"
)

type ProviderNode struct {
	ID               uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID           uuid.UUID  `gorm:"type:uuid;not null" json:"user_id"`
	Name             string     `gorm:"type:varchar(100);not null" json:"name"`
	IPAddress        string     `gorm:"type:inet" json:"ip_address,omitempty"`
	Country          string     `gorm:"type:varchar(2)" json:"country,omitempty"`
	City             string     `gorm:"type:varchar(100)" json:"city,omitempty"`
	Status           NodeStatus `gorm:"type:varchar(50);default:'offline'" json:"status"`
	TotalBandwidthGB float64    `gorm:"type:numeric(20,4);default:0" json:"total_bandwidth_gb"`
	QualityScore     float64    `gorm:"default:100" json:"quality_score"` // Network Trust Score
	LastSeenAt       *time.Time `json:"last_seen_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`

	// On-Chain Registry
	IsRegisteredOnChain bool   `gorm:"default:false" json:"is_registered_on_chain"`
	NetUID              int    `json:"net_uid"`
	Hotkey              string `gorm:"size:64" json:"hotkey"` // The hotkey used to register this node
}

func (ProviderNode) TableName() string {
	return "provider_nodes"
}

type UptimeCheck struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	NodeID    uuid.UUID `gorm:"type:uuid;not null" json:"node_id"`
	IsUp      bool      `gorm:"not null" json:"is_up"`
	LatencyMs int       `json:"latency_ms,omitempty"`
	CheckedAt time.Time `json:"checked_at"`
}

func (UptimeCheck) TableName() string {
	return "uptime_checks"
}
