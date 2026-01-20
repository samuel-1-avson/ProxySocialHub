package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type UserStatus string

const (
	UserStatusActive    UserStatus = "active"
	UserStatusPending   UserStatus = "pending"
	UserStatusSuspended UserStatus = "suspended"
	UserStatusBanned    UserStatus = "banned"
)

type TrustTier string

const (
	TrustTierNew      TrustTier = "new"
	TrustTierVerified TrustTier = "verified"
	TrustTierPremium  TrustTier = "premium"
)

// User maps to the 'profiles' table in Supabase
type User struct {
	ID        uuid.UUID  `gorm:"type:uuid;primary_key" json:"id"` // References auth.users
	Email     string     `gorm:"unique;not null" json:"email"`
	Role      string     `gorm:"not null" json:"role"` // 'buyer', 'provider', 'admin'
	Status    UserStatus `gorm:"-" json:"status"`      // Derived from auth or custom logic? For now ignored/transient
	TrustTier TrustTier  `gorm:"default:'new'" json:"trust_tier"`
	KYCStatus KYCStatus  `gorm:"default:'not_started'" json:"kyc_status"`

	// Social Profile fields
	DisplayName   *string `gorm:"size:100" json:"display_name,omitempty"`
	Username      *string `gorm:"size:50;unique" json:"username,omitempty"`
	Bio           *string `json:"bio,omitempty"`
	AvatarURL     *string `json:"avatar_url,omitempty"`
	CoverImageURL *string `json:"cover_image_url,omitempty"`
	Location      *string `gorm:"size:100" json:"location,omitempty"`
	Website       *string `gorm:"size:255" json:"website,omitempty"`

	// Social Stats
	FollowersCount int     `gorm:"default:0" json:"followers_count"`
	FollowingCount int     `gorm:"default:0" json:"following_count"`
	ReviewsCount   int     `gorm:"default:0" json:"reviews_count"`
	AvgRating      float64 `gorm:"default:0" json:"avg_rating"`
	Verified       bool    `gorm:"default:false" json:"verified"`

	// Provider Stats
	ProviderSince      *time.Time `json:"provider_since,omitempty"`
	TotalBandwidthSold float64    `gorm:"default:0" json:"total_bandwidth_sold"`
	WalletAddress      *string    `gorm:"size:42;index" json:"wallet_address,omitempty"`    // ETH Address
	BittensorAddress   *string    `gorm:"size:64;index" json:"bittensor_address,omitempty"` // SS58 Address

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// TableName overrides the table name used by User to `profiles`
func (User) TableName() string {
	return "profiles"
}

func (u *User) BeforeCreate(tx *gorm.DB) (err error) {
	// ID is provided by Supabase Auth (auth.users), so we don't generate it here usually.
	// But if the trigger creates it, this code might not even run for the initial creation?
	// The Go code might read/update it.
	if u.TrustTier == "" {
		u.TrustTier = TrustTierNew
	}
	if u.KYCStatus == "" {
		u.KYCStatus = KYCStatusNotStarted
	}
	return
}

// IsActive returns true (Legacy check, assume always active or check ban list)
func (u *User) IsActive() bool {
	return true // TODO: Check Supabase ban status if possible
}

// IsKYCVerified returns true if user has passed KYC
func (u *User) IsKYCVerified() bool {
	return u.KYCStatus == KYCStatusApproved
}

// TierConfig holds the rate limits for each trust tier
type TierConfig struct {
	Tier              TrustTier
	RequestsPerMinute int
	MaxBandwidthGB    float64 // -1 for unlimited
	MaxConcurrency    int
	AllowAutomation   bool
}

// GetTierConfig returns the configuration for a given trust tier
func GetTierConfig(tier TrustTier) TierConfig {
	switch tier {
	case TrustTierVerified:
		return TierConfig{
			Tier:              TrustTierVerified,
			RequestsPerMinute: 100,
			MaxBandwidthGB:    50,
			MaxConcurrency:    10,
			AllowAutomation:   true,
		}
	case TrustTierPremium:
		return TierConfig{
			Tier:              TrustTierPremium,
			RequestsPerMinute: 1000,
			MaxBandwidthGB:    -1, // Unlimited
			MaxConcurrency:    100,
			AllowAutomation:   true,
		}
	default: // TrustTierNew
		return TierConfig{
			Tier:              TrustTierNew,
			RequestsPerMinute: 10,
			MaxBandwidthGB:    5,
			MaxConcurrency:    3,
			AllowAutomation:   false,
		}
	}
}
