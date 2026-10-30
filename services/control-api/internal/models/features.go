package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
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
	ID     uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null" json:"user_id"`
	Name   string    `gorm:"type:varchar(100);not null" json:"name"`
	// An unconnected node has no observed IP yet. PostgreSQL inet accepts NULL,
	// but rejects the empty string Gorm would otherwise include in INSERTs.
	IPAddress         string         `gorm:"type:inet;default:null" json:"ip_address,omitempty"`
	Country           string         `gorm:"type:varchar(2)" json:"country,omitempty"`
	City              string         `gorm:"type:varchar(100)" json:"city,omitempty"`
	Region            string         `gorm:"type:varchar(100)" json:"region,omitempty"`
	ISP               string         `gorm:"type:varchar(100)" json:"isp,omitempty"`
	LocationUserSet   bool           `gorm:"not null;default:false" json:"location_user_set"` // owner picked the city; gateway IP geo must not overwrite it
	ConnectionType    string         `gorm:"type:varchar(50)" json:"connection_type,omitempty"`
	Port              int            `gorm:"default:0" json:"port,omitempty"`
	Protocol          string         `gorm:"type:varchar(10);default:'http'" json:"protocol,omitempty"`
	Status            NodeStatus     `gorm:"type:varchar(50);default:'offline'" json:"status"`
	IsHealthy         bool           `gorm:"default:false" json:"is_healthy"`
	ActiveConnections int            `gorm:"default:0" json:"active_connections"`
	MaxConnections    int            `gorm:"default:100" json:"max_connections"`
	LatencyMs         int            `gorm:"default:0" json:"latency_ms"`
	TotalBytesUp      int64          `gorm:"default:0" json:"total_bytes_up"`
	TotalBytesDown    int64          `gorm:"default:0" json:"total_bytes_down"`
	SuccessRate       float64        `gorm:"default:1.0" json:"success_rate"`
	TotalBandwidthGB  float64        `gorm:"type:numeric(20,4);default:0" json:"total_bandwidth_gb"`
	QualityScore      float64        `gorm:"default:100" json:"quality_score"` // Network Trust Score
	BasePricePerGB    float64        `gorm:"type:decimal(10,4);default:0.99" json:"base_price_per_gb"`
	LastSeenAt        *time.Time     `json:"last_seen_at,omitempty"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
	DeletedAt         gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`

	// On-Chain Registry
	IsRegisteredOnChain bool    `gorm:"default:false" json:"is_registered_on_chain"`
	NetUID              int     `json:"net_uid"`
	Hotkey              string  `gorm:"size:64" json:"hotkey"` // The hotkey used to register this node
	StakedAmountSOL     float64 `gorm:"default:0" json:"staked_amount_sol"`
	StakePDA            string  `gorm:"size:64" json:"stake_pda,omitempty"`
	StakeStatus         string  `gorm:"size:20;default:'none'" json:"stake_status"` // none, pending, staked

	// Payout
	WalletAddress string `gorm:"type:varchar(64)" json:"wallet_address,omitempty"` // Solana wallet for earnings

	// Verification Tier (Phase 6)
	Tier                string     `gorm:"size:20;default:'unverified'" json:"tier"`
	TierVerifiedAt      *time.Time `json:"tier_verified_at,omitempty"`
	TierScore           float64    `gorm:"type:numeric(5,2);default:0" json:"tier_score"`
	UptimePercent       float64    `gorm:"type:numeric(5,2);default:0" json:"uptime_percent"`
	TotalSessionsServed int        `gorm:"default:0" json:"total_sessions_served"`
	AvgLatencyMs        int        `gorm:"default:0" json:"avg_latency_ms"`
	DisputeCount        int        `gorm:"default:0" json:"dispute_count"`
	DemotionWarnings    int        `gorm:"default:0" json:"demotion_warnings"` // Grace counter before tier demotion

	// Gateway tunnel identity (e.g. node_<user_uuid>) — links to nodes.gateway_node_id
	GatewayNodeID string `gorm:"type:varchar(128);index" json:"gateway_node_id,omitempty"`
	KycVerified   bool   `gorm:"default:false" json:"kyc_verified"`

	// Provider-authored heartbeat proof metadata.
	LatestHeartbeatHash              string     `gorm:"type:varchar(64)" json:"latest_heartbeat_hash,omitempty"`
	LatestHeartbeatSignature         string     `gorm:"type:text" json:"latest_heartbeat_signature,omitempty"`
	LatestHeartbeatSigner            string     `gorm:"type:varchar(64);index" json:"latest_heartbeat_signer,omitempty"`
	LatestHeartbeatSignedAt          *time.Time `json:"latest_heartbeat_signed_at,omitempty"`
	LatestHeartbeatVerified          bool       `gorm:"default:false" json:"latest_heartbeat_verified"`
	LatestHeartbeatVerificationError string     `gorm:"type:text" json:"latest_heartbeat_verification_error,omitempty"`
	LatestHeartbeatNonce             string     `gorm:"type:varchar(128)" json:"latest_heartbeat_nonce,omitempty"`
}

func (ProviderNode) TableName() string {
	return "provider_nodes"
}

// CalculateQualityScore calculates the gateway runtime quality score for the
// canonical provider node row.
func (n *ProviderNode) CalculateQualityScore() float64 {
	score := 100.0
	if n.LatencyMs > 100 {
		score -= float64(n.LatencyMs-100) * 0.1
	}
	if n.SuccessRate > 0 {
		score *= n.SuccessRate
	}
	if n.UptimePercent > 0 {
		score *= (n.UptimePercent / 100)
	}
	totalGB := float64(n.TotalBytesUp+n.TotalBytesDown) / (1024 * 1024 * 1024)
	if totalGB > 10 {
		score += 5
	}
	if totalGB > 100 {
		score += 10
	}
	if score < 0 {
		return 0
	}
	if score > 100 {
		return 100
	}
	return score
}

// GetEarningsMultiplier returns a quality-based SOL earnings multiplier (0.70 – 1.25).
func (n *ProviderNode) GetEarningsMultiplier() float64 {
	switch {
	case n.QualityScore >= 95:
		return 1.25
	case n.QualityScore >= 85:
		return 1.10
	case n.QualityScore >= 75:
		return 1.00
	case n.QualityScore >= 60:
		return 0.85
	default:
		return 0.70
	}
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
