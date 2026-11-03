package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Follow represents a user following another user
type Follow struct {
	FollowerID  uuid.UUID `gorm:"type:uuid;primary_key" json:"follower_id"`
	FollowingID uuid.UUID `gorm:"type:uuid;primary_key" json:"following_id"`
	CreatedAt   time.Time `json:"created_at"`

	// Preloaded relations
	Follower  *User `gorm:"foreignKey:FollowerID" json:"follower,omitempty"`
	Following *User `gorm:"foreignKey:FollowingID" json:"following,omitempty"`
}

// TableName sets the table name for Follow
func (Follow) TableName() string {
	return "follows"
}

// BeforeCreate validates that user can't follow themselves
func (f *Follow) BeforeCreate(tx *gorm.DB) error {
	if f.FollowerID == f.FollowingID {
		return ErrCannotFollowSelf
	}
	return nil
}

// UserPublicProfile is a DTO for public profile display
type UserPublicProfile struct {
	ID            uuid.UUID `json:"id"`
	Username      *string   `json:"username"`
	DisplayName   *string   `json:"display_name"`
	Bio           *string   `json:"bio"`
	AvatarURL     *string   `json:"avatar_url"`
	CoverImageURL *string   `json:"cover_image_url"`
	Location      *string   `json:"location,omitempty"`
	Website       *string   `json:"website,omitempty"`
	Role          string    `json:"role"`
	// Verified is the identity flag (staff/attestation). It is not KYC and not trust_tier.
	Verified           bool       `json:"verified"`
	IsOnline           bool       `json:"is_online"`
	LastSeenAt         *time.Time `json:"last_seen_at,omitempty"`
	FollowersCount     int        `json:"followers_count"`
	FollowingCount     int        `json:"following_count"`
	ReviewsCount       int        `json:"reviews_count"`
	AvgRating          float64    `json:"avg_rating"`
	ProviderSince      *time.Time `json:"provider_since,omitempty"`
	TotalBandwidthSold float64    `json:"total_bandwidth_sold"`
	// TrustTier is the account entitlement (new / verified / premium) used for quotas.
	TrustTier TrustTier `json:"trust_tier"`
	CreatedAt time.Time `json:"created_at"`

	// Relationship status (set dynamically)
	IsFollowing bool `json:"is_following,omitempty"`
	IsBlocked   bool `json:"is_blocked,omitempty"`

	// Professional Identity
	ProfessionalTitle     *string  `json:"professional_title,omitempty"`
	ExperienceYears       int      `json:"experience_years"`
	Languages             []string `json:"languages,omitempty"`
	PrimarySpecialization *string  `json:"primary_specialization,omitempty"`

	// Details
	SocialLinks  map[string]interface{} `json:"social_links,omitempty"`
	Skills       []string               `json:"skills,omitempty"`
	BusinessName *string                `json:"business_name,omitempty"`
}

// Block represents a user blocking another user
type Block struct {
	BlockerID uuid.UUID `gorm:"type:uuid;primary_key" json:"blocker_id"`
	BlockedID uuid.UUID `gorm:"type:uuid;primary_key" json:"blocked_id"`
	Reason    string    `gorm:"size:255" json:"reason"`
	CreatedAt time.Time `json:"created_at"`
}

func (Block) TableName() string {
	return "blocks"
}

// UserSelfProfile is the authenticated user's profile. KYC stays here, never on public GET /users/:id.
type UserSelfProfile struct {
	UserPublicProfile
	KYCStatus KYCStatus `json:"kyc_status"`
}

// ToPublicProfile converts a User to a public profile DTO with Privacy Masking
func (u *User) ToPublicProfile() UserPublicProfile {
	p := u.profileFields()
	p.AvatarURL = publicMedia(p.AvatarURL)
	p.CoverImageURL = publicMedia(p.CoverImageURL)
	if !u.PresenceVisible || u.LastSeenAt == nil || time.Since(*u.LastSeenAt) > 2*time.Minute {
		p.IsOnline = false
		p.LastSeenAt = nil
	}
	if p.LastSeenAt != nil {
		rounded := p.LastSeenAt.Truncate(5 * time.Minute)
		p.LastSeenAt = &rounded
	}
	if !u.ProfilePublic {
		// Public contributions/offers retain a pseudonymous identifier, not the
		// user's personal profile, location, remote media, or social graph.
		return UserPublicProfile{ID: u.ID, Username: u.Username, Role: u.Role, AvgRating: u.AvgRating, ReviewsCount: u.ReviewsCount, Verified: u.Verified, TrustTier: u.TrustTier}
	}
	return p
}

func (u *User) profileFields() UserPublicProfile {
	// STRICT PRIVACY MASK: Email, TaxID, KYC, ISP, and wallet stay off the public DTO.

	return UserPublicProfile{
		ID:                 u.ID,
		Username:           u.Username,
		DisplayName:        u.DisplayName,
		Bio:                u.Bio,
		AvatarURL:          u.AvatarURL,
		CoverImageURL:      u.CoverImageURL,
		Location:           u.Location,
		Website:            u.Website,
		Role:               u.Role,
		Verified:           u.Verified,
		IsOnline:           u.IsOnline,
		LastSeenAt:         u.LastSeenAt,
		FollowersCount:     u.FollowersCount,
		FollowingCount:     u.FollowingCount,
		ReviewsCount:       u.ReviewsCount,
		AvgRating:          u.AvgRating,
		ProviderSince:      u.ProviderSince,
		TotalBandwidthSold: u.TotalBandwidthSold,
		TrustTier:          u.TrustTier,
		CreatedAt:          u.CreatedAt,

		ProfessionalTitle:     u.ProfessionalTitle,
		ExperienceYears:       u.ExperienceYears,
		Languages:             u.Languages,
		PrimarySpecialization: u.PrimarySpecialization,

		SocialLinks:  u.SocialLinks,
		Skills:       u.Skills,
		BusinessName: u.BusinessName,
	}
}

// ToSelfProfile is GET /v1/profile for the signed-in user (includes KYC).
func (u *User) ToSelfProfile() UserSelfProfile {
	return UserSelfProfile{
		UserPublicProfile: u.profileFields(),
		KYCStatus:         u.KYCStatus,
	}
}

// UpdateProfileRequest represents a request to update user profile
type UpdateProfileRequest struct {
	DisplayName   *string                `json:"display_name" binding:"omitempty,max=100"`
	Username      *string                `json:"username" binding:"omitempty,min=3,max=50"`
	Bio           *string                `json:"bio" binding:"omitempty,max=500"`
	Location      *string                `json:"location" binding:"omitempty,max=100"`
	Website       *string                `json:"website" binding:"omitempty,max=255"`
	AvatarURL     *string                `json:"avatar_url" binding:"omitempty,max=80000"`
	CoverImageURL *string                `json:"cover_image_url" binding:"omitempty,max=80000"`
	Skills        []string               `json:"skills" binding:"omitempty,max=50,dive,max=50"`
	SocialLinks   map[string]interface{} `json:"social_links" binding:"omitempty,max=10"`
	BusinessName  *string                `json:"business_name" binding:"omitempty,max=100"`
	TaxID         *string                `json:"tax_id" binding:"omitempty,max=50"`

	// New Professional fields
	ProfessionalTitle     *string  `json:"professional_title" binding:"omitempty,max=100"`
	ExperienceYears       *int     `json:"experience_years" binding:"omitempty,gte=0"`
	Languages             []string `json:"languages" binding:"omitempty,max=10,dive,max=50"`
	PrimarySpecialization *string  `json:"primary_specialization" binding:"omitempty,max=100"`

	Role *string `json:"role" binding:"omitempty,max=20"`
}
