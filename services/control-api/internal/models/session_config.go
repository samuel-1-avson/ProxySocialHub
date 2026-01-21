package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

// SessionConfiguration represents per-session settings for a buyer
type SessionConfiguration struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	SessionID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_session_config" json:"session_id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;index:idx_session_config_user" json:"user_id"`

	// Access Control
	AllowedDomains pq.StringArray `gorm:"type:text[]" json:"allowed_domains"` // Whitelist
	BlockedDomains pq.StringArray `gorm:"type:text[]" json:"blocked_domains"` // Blacklist
	AllowedPorts   pq.Int64Array  `gorm:"type:integer[]" json:"allowed_ports"`
	BlockedPorts   pq.Int64Array  `gorm:"type:integer[]" json:"blocked_ports"`

	// Usage Limits
	BandwidthLimitGB float64 `gorm:"default:0" json:"bandwidth_limit_gb"` // 0 = unlimited
	RequestLimit     int     `gorm:"default:0" json:"request_limit"`      // 0 = unlimited
	TimeLimitMinutes int     `gorm:"default:0" json:"time_limit_minutes"` // 0 = unlimited

	// Rotation Settings
	RotationType     string `gorm:"type:varchar(20);default:'none'" json:"rotation_type"` // "none", "per-request", "time-based"
	RotationInterval int    `gorm:"default:60" json:"rotation_interval_seconds"`
	StickyTarget     string `gorm:"type:varchar(255)" json:"sticky_target"` // Target domain for sticky

	// Quality Preferences
	PreferredCountry string  `gorm:"type:varchar(10)" json:"preferred_country"`
	PreferredCity    string  `gorm:"type:varchar(100)" json:"preferred_city"`
	PreferredISP     string  `gorm:"type:varchar(100)" json:"preferred_isp"`
	MinQualityScore  float64 `gorm:"default:0" json:"min_quality_score"`
	MaxLatencyMs     int     `gorm:"default:0" json:"max_latency_ms"` // 0 = any

	// Protocol Preference
	PreferredProtocol string `gorm:"type:varchar(20)" json:"preferred_protocol"` // "http", "https", "socks5"

	// Premium Features Requested
	UseCaptchaSolving     bool `gorm:"default:false" json:"use_captcha_solving"`
	UseJavascriptRender   bool `gorm:"default:false" json:"use_javascript_render"`
	UseBrowserFingerprint bool `gorm:"default:false" json:"use_browser_fingerprint"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Relations
	Session *Session `gorm:"foreignKey:SessionID" json:"session,omitempty"`
}

func (SessionConfiguration) TableName() string {
	return "session_configurations"
}

func (s *SessionConfiguration) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return nil
}

// RoutingProfile represents intelligent routing configuration
type RoutingProfile struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	Name        string    `gorm:"type:varchar(100);not null" json:"name"`
	Slug        string    `gorm:"type:varchar(50);not null;uniqueIndex" json:"slug"`
	Description string    `gorm:"type:text" json:"description"`
	UseCase     string    `gorm:"type:varchar(50)" json:"use_case"` // web_scraping, social_media, etc.
	IsDefault   bool      `gorm:"default:false" json:"is_default"`
	IsActive    bool      `gorm:"default:true" json:"is_active"`

	// Weighted Priorities (0.0-1.0)
	SpeedWeight     float64 `gorm:"default:0.5" json:"speed_weight"`
	StabilityWeight float64 `gorm:"default:0.5" json:"stability_weight"`
	PriceWeight     float64 `gorm:"default:0.5" json:"price_weight"`
	LocationWeight  float64 `gorm:"default:0.3" json:"location_weight"`

	// Auto-Features
	AutoRotation     bool `gorm:"default:false" json:"auto_rotation"`
	RotationInterval int  `gorm:"default:300" json:"rotation_interval_seconds"`
	AutoFailover     bool `gorm:"default:true" json:"auto_failover"`
	MaxRetries       int  `gorm:"default:3" json:"max_retries"`

	// Recommended Settings
	RecommendedProtocols pq.StringArray `gorm:"type:text[]" json:"recommended_protocols"`
	RecommendedTier      ServiceTier    `gorm:"type:varchar(20)" json:"recommended_tier"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (RoutingProfile) TableName() string {
	return "routing_profiles"
}

func (r *RoutingProfile) BeforeCreate(tx *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}

// GetDefaultRoutingProfiles returns predefined routing profiles
func GetDefaultRoutingProfiles() []RoutingProfile {
	return []RoutingProfile{
		{
			Name:                 "Web Scraping",
			Slug:                 "web-scraping",
			Description:          "Optimized for high-volume web scraping and data extraction",
			UseCase:              "web_scraping",
			SpeedWeight:          0.7,
			StabilityWeight:      0.8,
			PriceWeight:          0.5,
			AutoRotation:         true,
			RotationInterval:     60,
			AutoFailover:         true,
			MaxRetries:           5,
			RecommendedProtocols: []string{"http", "https"},
			RecommendedTier:      TierPriority,
		},
		{
			Name:                 "Social Media",
			Slug:                 "social-media",
			Description:          "Residential IPs for social media management",
			UseCase:              "social_media",
			SpeedWeight:          0.4,
			StabilityWeight:      0.9,
			LocationWeight:       0.8,
			AutoRotation:         false,
			AutoFailover:         true,
			RecommendedProtocols: []string{"http", "https"},
			RecommendedTier:      TierPriority,
		},
		{
			Name:                 "E-Commerce",
			Slug:                 "e-commerce",
			Description:          "Stable connections for price monitoring and checkout",
			UseCase:              "e_commerce",
			SpeedWeight:          0.6,
			StabilityWeight:      0.9,
			PriceWeight:          0.3,
			AutoRotation:         true,
			RotationInterval:     300,
			AutoFailover:         true,
			RecommendedProtocols: []string{"http", "https"},
			RecommendedTier:      TierStandard,
		},
		{
			Name:                 "Gaming",
			Slug:                 "gaming",
			Description:          "Low-latency connections for gaming and real-time apps",
			UseCase:              "gaming",
			SpeedWeight:          0.95,
			StabilityWeight:      0.7,
			LocationWeight:       0.9,
			AutoFailover:         true,
			MaxRetries:           1,
			RecommendedProtocols: []string{"socks5"},
			RecommendedTier:      TierEnterprise,
		},
		{
			Name:                 "Streaming",
			Slug:                 "streaming",
			Description:          "High-bandwidth connections for video streaming",
			UseCase:              "streaming",
			SpeedWeight:          0.95,
			StabilityWeight:      0.6,
			LocationWeight:       0.7,
			AutoFailover:         true,
			RecommendedProtocols: []string{"socks5", "http"},
			RecommendedTier:      TierPriority,
		},
		{
			Name:                 "SEO Monitoring",
			Slug:                 "seo-monitoring",
			Description:          "Diverse geo-locations for search engine ranking checks",
			UseCase:              "seo_monitoring",
			SpeedWeight:          0.5,
			StabilityWeight:      0.8,
			LocationWeight:       1.0,
			AutoRotation:         true,
			RotationInterval:     30,
			RecommendedProtocols: []string{"http", "https"},
			RecommendedTier:      TierStandard,
		},
	}
}

// ServiceFilter for marketplace filtering
type ServiceFilter struct {
	// Protocols
	Protocols []string `json:"protocols" form:"protocols"`

	// Geographic
	TargetCountries []string `json:"target_countries" form:"target_countries"`
	TargetCities    []string `json:"target_cities" form:"target_cities"`
	TargetISPs      []string `json:"target_isps" form:"target_isps"`

	// Quality
	MinSuccessRate   float64 `json:"min_success_rate" form:"min_success_rate"`
	MaxLatencyMs     int     `json:"max_latency_ms" form:"max_latency_ms"`
	MinUptimePercent float64 `json:"min_uptime_percent" form:"min_uptime_percent"`
	MinQualityScore  float64 `json:"min_quality_score" form:"min_quality_score"`

	// Speed
	MinBandwidthMbps int         `json:"min_bandwidth_mbps" form:"min_bandwidth_mbps"`
	PriorityTier     ServiceTier `json:"priority_tier" form:"priority_tier"`

	// Premium Services
	RequireCaptchaSolving     bool `json:"require_captcha_solving" form:"require_captcha_solving"`
	RequireJsRendering        bool `json:"require_js_rendering" form:"require_js_rendering"`
	RequireBrowserFingerprint bool `json:"require_browser_fingerprint" form:"require_browser_fingerprint"`
	RequireScreenshot         bool `json:"require_screenshot" form:"require_screenshot"`

	// Pricing
	MaxPricePerGB float64 `json:"max_price_per_gb" form:"max_price_per_gb"`

	// Rotation
	RequireStickySession bool `json:"require_sticky_session" form:"require_sticky_session"`
	RequireAutoRotation  bool `json:"require_auto_rotation" form:"require_auto_rotation"`

	// Pagination
	Page  int `json:"page" form:"page"`
	Limit int `json:"limit" form:"limit"`
}
