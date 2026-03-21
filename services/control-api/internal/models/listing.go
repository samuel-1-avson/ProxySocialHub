package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// ListingStatus represents the status of a proxy listing
type ListingStatus string

const (
	ListingStatusActive  ListingStatus = "active"
	ListingStatusPaused  ListingStatus = "paused"
	ListingStatusSoldOut ListingStatus = "sold_out"
	ListingStatusDeleted ListingStatus = "deleted"
)

// ProxyType represents the type of proxy
type ProxyType string

const (
	ProxyTypeResidential ProxyType = "residential"
	ProxyTypeMobile      ProxyType = "mobile"
	ProxyTypeDatacenter  ProxyType = "datacenter"
)

// ProxyListing represents a marketplace listing for proxy bandwidth
type ProxyListing struct {
	ID       uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	SellerID uuid.UUID `gorm:"type:uuid;not null;index:idx_listing_seller" json:"seller_id"`

	// Listing details
	Title        string     `gorm:"size:200;not null" json:"title"`
	Description  string     `json:"description"`
	ProxyType    ProxyType  `gorm:"size:50;default:'residential'" json:"proxy_type"`
	Protocol     string     `gorm:"size:20;default:'HTTP'" json:"protocol"`
	RotationType string     `gorm:"size:20;default:'static';index:idx_listing_rotation" json:"rotation_type"` // "static", "rotating", "sticky"
	CircleID     *uuid.UUID `gorm:"type:uuid;index:idx_listing_circle" json:"circle_id,omitempty"`            // Clan link

	// Targeting & Location
	Country string `gorm:"size:50;index:idx_listing_country" json:"country"`
	ISP     string `gorm:"size:100;index:idx_listing_isp" json:"isp"`

	// Pricing
	PricePerGB    float64        `gorm:"not null" json:"price_per_gb"`
	MinPurchaseGB float64        `gorm:"default:1" json:"min_purchase_gb"`
	BulkDiscounts datatypes.JSON `gorm:"type:jsonb;default:'[]'" json:"bulk_discounts"`

	// Availability
	AvailableBandwidthGB float64 `gorm:"not null" json:"available_bandwidth_gb"`
	MaxConcurrency       int     `gorm:"default:5" json:"max_concurrency"`

	// Performance metrics (auto-calculated)
	AvgLatencyMs  int     `gorm:"default:0" json:"avg_latency_ms"`
	UptimePercent float64 `gorm:"default:100" json:"uptime_percent"`
	SuccessRate   float64 `gorm:"default:100" json:"success_rate"`
	QualityScore  float64 `gorm:"default:100" json:"quality_score"`
	CurrentTier   string  `gorm:"size:20;default:'Bronze'" json:"current_tier"`

	// Social metrics
	ViewsCount          int  `gorm:"default:0" json:"views_count"`
	SavesCount          int  `gorm:"default:0" json:"saves_count"`
	OrdersCount         int  `gorm:"default:0" json:"orders_count"`
	ActiveSessionsCount int  `gorm:"default:0" json:"active_sessions_count"`
	AllowDirectMessage  bool `gorm:"default:true" json:"allow_direct_message"`

	Status    ListingStatus `gorm:"size:50;default:'active';index:idx_listing_status" json:"status"`
	CreatedAt time.Time     `json:"created_at"`
	UpdatedAt time.Time     `json:"updated_at"`

	// Preloaded relations
	Seller *User   `gorm:"foreignKey:SellerID" json:"seller,omitempty"`
	Circle *Circle `gorm:"foreignKey:CircleID" json:"circle,omitempty"`
}

// TableName sets the table name for ProxyListing
func (ProxyListing) TableName() string {
	return "proxy_listings"
}

// BeforeCreate generates a UUID if not set
func (l *ProxyListing) BeforeCreate(tx *gorm.DB) error {
	if l.ID == uuid.Nil {
		l.ID = uuid.New()
	}
	return nil
}

// BulkDiscount represents a discount tier for bulk purchases
type BulkDiscount struct {
	MinGB      float64 `json:"min_gb"`
	PricePerGB float64 `json:"price_per_gb"`
}

// SavedListing represents a bookmarked listing
type SavedListing struct {
	UserID    uuid.UUID `gorm:"type:uuid;primary_key" json:"user_id"`
	ListingID uuid.UUID `gorm:"type:uuid;primary_key" json:"listing_id"`
	CreatedAt time.Time `json:"created_at"`

	// Preloaded relations
	Listing *ProxyListing `gorm:"foreignKey:ListingID" json:"listing,omitempty"`
}

// CreateListingRequest represents a request to create a new listing
type CreateListingRequest struct {
	Title                string         `json:"title" binding:"required,min=5,max=200"`
	Description          string         `json:"description" binding:"max=2000"`
	ProxyType            ProxyType      `json:"proxy_type" binding:"required"`
	Protocol             string         `json:"protocol" binding:"required"`
	RotationType         string         `json:"rotation_type"`
	Country              string         `json:"country"`
	ISP                  string         `json:"isp"`
	PricePerGB           float64        `json:"price_per_gb" binding:"required,gt=0"`
	MinPurchaseGB        float64        `json:"min_purchase_gb" binding:"gte=0"`
	AvailableBandwidthGB float64        `json:"available_bandwidth_gb" binding:"required,gt=0"`
	MaxConcurrency       int            `json:"max_concurrency" binding:"gte=1,lte=100"`
	BulkDiscounts        []BulkDiscount `json:"bulk_discounts"`
}

// UpdateListingRequest represents a request to update a listing
type UpdateListingRequest struct {
	Title                *string        `json:"title" binding:"omitempty,min=5,max=200"`
	Description          *string        `json:"description" binding:"omitempty,max=2000"`
	PricePerGB           *float64       `json:"price_per_gb" binding:"omitempty,gt=0"`
	MinPurchaseGB        *float64       `json:"min_purchase_gb" binding:"omitempty,gte=0"`
	AvailableBandwidthGB *float64       `json:"available_bandwidth_gb" binding:"omitempty,gte=0"`
	MaxConcurrency       *int           `json:"max_concurrency" binding:"omitempty,gte=1,lte=100"`
	BulkDiscounts        []BulkDiscount `json:"bulk_discounts"`
	Status               *ListingStatus `json:"status" binding:"omitempty,oneof=active paused"`
}

// ListingFilters for marketplace browsing
type ListingFilters struct {
	ProxyType    ProxyType `form:"proxy_type"`
	Protocol     string    `form:"protocol"`
	RotationType string    `form:"rotation_type"`
	Country      string    `form:"country"`
	ISP          string    `form:"isp"`
	MinPrice     float64   `form:"min_price"`
	MaxPrice     float64   `form:"max_price"`
	MinRating    float64   `form:"min_rating"`
	SellerID     uuid.UUID `form:"seller_id"`
	SortBy       string    `form:"sort_by"` // "price_asc", "price_desc", "rating", "newest"
	Page         int       `form:"page"`
	Limit        int       `form:"limit"`
}
