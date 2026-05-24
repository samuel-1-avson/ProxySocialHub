package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

type UserStatus string

const (
	UserStatusActive    UserStatus = "active"
	UserStatusPending   UserStatus = "pending"
	UserStatusSuspended UserStatus = "suspended"
	UserStatusBanned    UserStatus = "banned"
)

type KYCStatus string

const (
	KYCStatusNone              KYCStatus = "none"
	KYCStatusPending           KYCStatus = "pending"
	KYCStatusApproved          KYCStatus = "approved"
	KYCStatusRejected          KYCStatus = "rejected"
	KYCStatusInsufficientFunds KYCStatus = "insufficient_funds"
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
	Status    UserStatus `gorm:"type:varchar(50);default:'active'" json:"status"`
	TrustTier TrustTier `gorm:"default:'new'" json:"trust_tier"`
	KYCStatus KYCStatus `gorm:"type:varchar(50);default:'none'" json:"kyc_status"`

	// Social Profile fields
	DisplayName   *string        `gorm:"size:100" json:"display_name,omitempty"`
	Username      *string        `gorm:"size:50;unique" json:"username,omitempty"`
	Bio           *string        `json:"bio,omitempty"`
	AvatarURL     *string        `json:"avatar_url,omitempty"`
	CoverImageURL *string        `json:"cover_image_url,omitempty"`
	Location      *string        `gorm:"size:100" json:"location,omitempty"`
	ISP           *string        `gorm:"size:100" json:"isp,omitempty"`
	Website       *string        `gorm:"size:255" json:"website,omitempty"`
	SocialLinks   JSONMap        `gorm:"type:jsonb" json:"social_links,omitempty"` // {"twitter": "...", "github": "..."}
	Skills        pq.StringArray `gorm:"type:text[]" json:"skills,omitempty"`

	// Professional Identity
	ProfessionalTitle     *string        `gorm:"size:100" json:"professional_title,omitempty"`
	ExperienceYears       int            `gorm:"default:0" json:"experience_years"`
	Languages             pq.StringArray `gorm:"type:text[]" json:"languages,omitempty"`
	PrimarySpecialization *string        `gorm:"size:100" json:"primary_specialization,omitempty"`

	// Business Profile
	BusinessName *string `gorm:"size:100" json:"business_name,omitempty"`
	TaxID        *string `gorm:"size:50" json:"tax_id,omitempty"` // Private? Or Verified?

	// Social Stats
	FollowersCount int     `gorm:"default:0" json:"followers_count"`
	FollowingCount int     `gorm:"default:0" json:"following_count"`
	ReviewsCount   int     `gorm:"default:0" json:"reviews_count"`
	AvgRating      float64 `gorm:"default:0" json:"avg_rating"`
	Verified       bool    `gorm:"default:false" json:"verified"`

	// Provider Stats
	ProviderSince         *time.Time `json:"provider_since,omitempty"`
	TotalBandwidthSold    float64    `gorm:"default:0" json:"total_bandwidth_sold"`
	WalletAddress         *string    `gorm:"size:64;index" json:"wallet_address,omitempty"`    // Solana wallet address (base58)
	PaystackRecipientCode *string    `gorm:"size:50" json:"paystack_recipient_code,omitempty"` // Cached Paystack recipient

	// Auth / Verification
	VerificationToken *string `gorm:"size:255" json:"verification_token,omitempty"`
	EmailVerified     bool    `gorm:"default:false" json:"email_verified"`

	// Online presence
	IsOnline     bool       `gorm:"default:false;index:idx_user_online" json:"is_online"`
	LastSeenAt   *time.Time `json:"last_seen_at,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// JSONMap for generic JSON DB storage
type JSONMap map[string]interface{}

// Scan implements sql.Scanner
func (j *JSONMap) Scan(value interface{}) error {
	if value == nil {
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return errors.New("type assertion to []byte failed")
	}
	return json.Unmarshal(bytes, &j)
}

// Value implements driver.Valuer
func (j JSONMap) Value() (driver.Value, error) {
	if j == nil {
		return nil, nil
	}
	return json.Marshal(j)
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
	if u.Status == "" {
		u.Status = UserStatusActive
	}
	return
}

// IsActive returns true only when the user's status is active or pending.
// Banned and suspended users are rejected by auth middleware.
func (u *User) IsActive() bool {
	return u.Status != UserStatusBanned && u.Status != UserStatusSuspended
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
