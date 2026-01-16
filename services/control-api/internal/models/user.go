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

type User struct {
	ID           uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Email        string     `gorm:"unique;not null" json:"email"`
	PasswordHash string     `gorm:"not null" json:"-"`    // Never expose in JSON
	Role         string     `gorm:"not null" json:"role"` // 'buyer', 'provider', 'admin'
	Status       UserStatus `gorm:"default:'pending'" json:"status"`
	TrustTier    TrustTier  `gorm:"default:'new'" json:"trust_tier"`
	KYCStatus    KYCStatus  `gorm:"default:'not_started'" json:"kyc_status"`

	// Email verification fields
	EmailVerified            bool       `gorm:"default:false" json:"email_verified"`
	VerificationToken        *string    `gorm:"size:64" json:"-"`
	VerificationTokenExpires *time.Time `json:"-"`

	// Two-Factor Authentication fields
	TOTPSecret  *string `gorm:"size:64" json:"-"`
	TOTPEnabled bool    `gorm:"default:false" json:"totp_enabled"`

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

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type OAuthIdentity struct {
	ID             uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	UserID         uuid.UUID `gorm:"type:uuid;not null"`
	Provider       string    `gorm:"not null"` // 'google', 'github'
	ProviderUserID string    `gorm:"not null"`
	Email          string    `gorm:"not null"`
	AccessToken    string
	RefreshToken   string
	ExpiresAt      time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

func (u *User) BeforeCreate(tx *gorm.DB) (err error) {
	if u.ID == uuid.Nil {
		u.ID = uuid.New()
	}
	if u.Status == "" {
		u.Status = UserStatusPending
	}
	if u.TrustTier == "" {
		u.TrustTier = TrustTierNew
	}
	if u.KYCStatus == "" {
		u.KYCStatus = KYCStatusNotStarted
	}
	return
}

// IsActive returns true if user is in good standing
func (u *User) IsActive() bool {
	return u.Status == UserStatusActive
}

// IsKYCVerified returns true if user has passed KYC
func (u *User) IsKYCVerified() bool {
	return u.KYCStatus == KYCStatusApproved
}

// IsEmailVerified returns true if user has verified their email
func (u *User) IsEmailVerified() bool {
	return u.EmailVerified
}

// GenerateVerificationToken creates a new verification token with 24-hour expiry
func (u *User) GenerateVerificationToken() string {
	token := uuid.New().String() + uuid.New().String()
	token = token[:64] // Ensure 64 chars
	u.VerificationToken = &token
	expires := time.Now().Add(24 * time.Hour)
	u.VerificationTokenExpires = &expires
	return token
}

// ClearVerificationToken removes the verification token after successful verification
func (u *User) ClearVerificationToken() {
	u.VerificationToken = nil
	u.VerificationTokenExpires = nil
	u.EmailVerified = true
}

// IsVerificationTokenValid checks if the token matches and hasn't expired
func (u *User) IsVerificationTokenValid(token string) bool {
	if u.VerificationToken == nil || u.VerificationTokenExpires == nil {
		return false
	}
	if *u.VerificationToken != token {
		return false
	}
	return time.Now().Before(*u.VerificationTokenExpires)
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
