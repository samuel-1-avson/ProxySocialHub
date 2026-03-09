package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

// ShowcaseType represents the type of showcase item
type ShowcaseType string

const (
	ShowcaseTypeSpeedTest   ShowcaseType = "speed_test"
	ShowcaseTypeTestimonial ShowcaseType = "testimonial"
	ShowcaseTypeMetric      ShowcaseType = "metric"
	ShowcaseTypeMedia       ShowcaseType = "media"
	ShowcaseTypeNetwork     ShowcaseType = "network"
)

// ProviderShowcase represents a portfolio item for providers
type ProviderShowcase struct {
	ID          uuid.UUID    `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	ProviderID  uuid.UUID    `gorm:"type:uuid;not null;index" json:"provider_id"`
	
	Title       string       `gorm:"size:200;not null" json:"title"`
	Description string       `json:"description,omitempty"`
	Type        ShowcaseType `gorm:"size:50;not null" json:"type"`
	
	// Media
	MediaURLs    []string `gorm:"type:text[]" json:"media_urls,omitempty"`
	ThumbnailURL string   `json:"thumbnail_url,omitempty"`
	
	// Metrics
	Metrics datatypes.JSON `gorm:"type:jsonb;default:'{}'" json:"metrics,omitempty"`
	
	// Display
	DisplayOrder int  `gorm:"default:0" json:"display_order"`
	IsFeatured   bool `gorm:"default:false" json:"is_featured"`
	IsPublic     bool `gorm:"default:true" json:"is_public"`
	
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	
	// Relations
	Provider *User `gorm:"foreignKey:ProviderID" json:"provider,omitempty"`
}

// TableName sets the table name
func (ProviderShowcase) TableName() string {
	return "provider_showcases"
}

// SpeedTest represents an automated speed test result
type SpeedTest struct {
	ID           uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	ProviderID   uuid.UUID `gorm:"type:uuid;not null;index" json:"provider_id"`
	
	// Results
	DownloadSpeed     float64 `json:"download_speed"`      // Mbps
	UploadSpeed       float64 `json:"upload_speed"`        // Mbps
	LatencyMs         int     `json:"latency_ms"`
	JitterMs          int     `json:"jitter_ms"`
	PacketLossPercent float64 `json:"packet_loss_percent"`
	
	// Location
	ServerLocation string `json:"server_location,omitempty"`
	ProxyLocation  string `json:"proxy_location,omitempty"`
	
	// Metadata
	TestType   string `gorm:"size:50" json:"test_type"`
	TestMethod string `gorm:"size:50" json:"test_method"`
	
	IsPublic  bool      `gorm:"default:true" json:"is_public"`
	TestedAt  time.Time `json:"tested_at"`
	
	// Relations
	Provider *User `gorm:"foreignKey:ProviderID" json:"provider,omitempty"`
}

// TableName sets the table name
func (SpeedTest) TableName() string {
	return "speed_tests"
}

// Testimonial represents a customer testimonial
type Testimonial struct {
	ID         uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	ProviderID uuid.UUID  `gorm:"type:uuid;not null;index" json:"provider_id"`
	CustomerID *uuid.UUID `gorm:"type:uuid" json:"customer_id,omitempty"`
	
	Content string `json:"content"`
	Rating  int    `json:"rating"`
	
	// Verification
	IsVerified bool       `gorm:"default:false" json:"is_verified"`
	OrderID    *uuid.UUID `gorm:"type:uuid" json:"order_id,omitempty"`
	
	// Display
	IsApproved bool `gorm:"default:false" json:"is_approved"`
	IsFeatured bool `gorm:"default:false" json:"is_featured"`
	
	CreatedAt time.Time `json:"created_at"`
	
	// Relations
	Provider *User `gorm:"foreignKey:ProviderID" json:"provider,omitempty"`
	Customer *User `gorm:"foreignKey:CustomerID" json:"customer,omitempty"`
}

// TableName sets the table name
func (Testimonial) TableName() string {
	return "testimonials"
}

// ProviderStats represents cached provider statistics
type ProviderStats struct {
	ProviderID uuid.UUID `gorm:"type:uuid;primary_key" json:"provider_id"`
	
	// Performance
	AvgDownloadSpeed float64 `json:"avg_download_speed"`
	AvgUploadSpeed   float64 `json:"avg_upload_speed"`
	AvgLatencyMs     int     `json:"avg_latency_ms"`
	UptimePercent    float64 `json:"uptime_percent"`
	
	// Business
	TotalSessions    int     `json:"total_sessions"`
	TotalBandwidthTb float64 `json:"total_bandwidth_tb"`
	ActiveCustomers  int     `json:"active_customers"`
	
	// Ratings
	AvgRating    float64 `json:"avg_rating"`
	TotalReviews int     `json:"total_reviews"`
	
	// Metadata
	LastCalculatedAt *time.Time `json:"last_calculated_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	
	// Relations
	Provider *User `gorm:"foreignKey:ProviderID" json:"provider,omitempty"`
}

// TableName sets the table name
func (ProviderStats) TableName() string {
	return "provider_stats"
}
