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
	ID                 uuid.UUID  `json:"id"`
	Username           *string    `json:"username"`
	DisplayName        *string    `json:"display_name"`
	Bio                *string    `json:"bio"`
	AvatarURL          *string    `json:"avatar_url"`
	CoverImageURL      *string    `json:"cover_image_url"`
	Location           *string    `json:"location"`
	Website            *string    `json:"website"`
	Role               string     `json:"role"`
	Verified           bool       `json:"verified"`
	FollowersCount     int        `json:"followers_count"`
	FollowingCount     int        `json:"following_count"`
	ReviewsCount       int        `json:"reviews_count"`
	AvgRating          float64    `json:"avg_rating"`
	ProviderSince      *time.Time `json:"provider_since,omitempty"`
	TotalBandwidthSold float64    `json:"total_bandwidth_sold"`
	TrustTier          TrustTier  `json:"trust_tier"`
	CreatedAt          time.Time  `json:"created_at"`

	// Relationship status (set dynamically)
	IsFollowing bool `json:"is_following,omitempty"`
	IsBlocked   bool `json:"is_blocked,omitempty"`

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

// ToPublicProfile converts a User to a public profile DTO
func (u *User) ToPublicProfile() UserPublicProfile {
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
		FollowersCount:     u.FollowersCount,
		FollowingCount:     u.FollowingCount,
		ReviewsCount:       u.ReviewsCount,
		AvgRating:          u.AvgRating,
		ProviderSince:      u.ProviderSince,
		TotalBandwidthSold: u.TotalBandwidthSold,
		TrustTier:          u.TrustTier,
		CreatedAt:          u.CreatedAt,
		SocialLinks:        u.SocialLinks,
		Skills:             u.Skills,
		BusinessName:       u.BusinessName,
	}
}

// UpdateProfileRequest represents a request to update user profile
type UpdateProfileRequest struct {
	DisplayName   *string                `json:"display_name" binding:"omitempty,max=100"`
	Username      *string                `json:"username" binding:"omitempty,min=3,max=50,alphanum"`
	Bio           *string                `json:"bio" binding:"omitempty,max=500"`
	Location      *string                `json:"location" binding:"omitempty,max=100"`
	Website       *string                `json:"website" binding:"omitempty,url,max=255"`
	AvatarURL     *string                `json:"avatar_url" binding:"omitempty,url"`
	CoverImageURL *string                `json:"cover_image_url" binding:"omitempty,url"`
	Skills        []string               `json:"skills"`
	SocialLinks   map[string]interface{} `json:"social_links"`
	BusinessName  *string                `json:"business_name" binding:"omitempty,max=100"`
	TaxID         *string                `json:"tax_id" binding:"omitempty,max=50"`
}
