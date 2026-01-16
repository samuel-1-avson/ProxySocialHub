package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Review represents a review of a seller by a buyer
type Review struct {
	ID         uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	ReviewerID uuid.UUID  `gorm:"type:uuid;not null" json:"reviewer_id"`
	SellerID   uuid.UUID  `gorm:"type:uuid;not null" json:"seller_id"`
	ListingID  *uuid.UUID `gorm:"type:uuid" json:"listing_id,omitempty"`
	OrderID    *uuid.UUID `gorm:"type:uuid" json:"order_id,omitempty"`

	// Rating
	Rating  int    `gorm:"not null" json:"rating"` // 1-5
	Title   string `gorm:"size:200" json:"title"`
	Content string `json:"content"`

	// Sub-ratings (1-5, optional)
	SpeedRating       *int `json:"speed_rating,omitempty"`
	ReliabilityRating *int `json:"reliability_rating,omitempty"`
	SupportRating     *int `json:"support_rating,omitempty"`
	ValueRating       *int `json:"value_rating,omitempty"`

	// Engagement
	HelpfulCount int `gorm:"default:0" json:"helpful_count"`

	// Seller response
	SellerResponse *string    `json:"seller_response,omitempty"`
	ResponseAt     *time.Time `json:"response_at,omitempty"`

	VerifiedPurchase bool      `gorm:"default:false" json:"verified_purchase"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`

	// Preloaded relations
	Reviewer *User         `gorm:"foreignKey:ReviewerID" json:"reviewer,omitempty"`
	Seller   *User         `gorm:"foreignKey:SellerID" json:"seller,omitempty"`
	Listing  *ProxyListing `gorm:"foreignKey:ListingID" json:"listing,omitempty"`
	Order    *Order        `gorm:"foreignKey:OrderID" json:"order,omitempty"`
}

// TableName sets the table name for Review
func (Review) TableName() string {
	return "reviews"
}

// BeforeCreate generates a UUID if not set
func (r *Review) BeforeCreate(tx *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}

// CreateReviewRequest represents a request to create a review
type CreateReviewRequest struct {
	OrderID           uuid.UUID `json:"order_id" binding:"required"`
	Rating            int       `json:"rating" binding:"required,min=1,max=5"`
	Title             string    `json:"title" binding:"max=200"`
	Content           string    `json:"content" binding:"max=2000"`
	SpeedRating       *int      `json:"speed_rating" binding:"omitempty,min=1,max=5"`
	ReliabilityRating *int      `json:"reliability_rating" binding:"omitempty,min=1,max=5"`
	SupportRating     *int      `json:"support_rating" binding:"omitempty,min=1,max=5"`
	ValueRating       *int      `json:"value_rating" binding:"omitempty,min=1,max=5"`
}

// RespondToReviewRequest represents a seller's response to a review
type RespondToReviewRequest struct {
	Response string `json:"response" binding:"required,max=1000"`
}
