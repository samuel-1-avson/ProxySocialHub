package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

// ServiceTier represents quality/priority tiers
type ServiceTier string

const (
	TierStandard   ServiceTier = "standard"
	TierPriority   ServiceTier = "priority"
	TierEnterprise ServiceTier = "enterprise"
)

// ServiceConfiguration represents a provider's service configuration for a node
type ServiceConfiguration struct {
	ID     uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	NodeID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_svc_config_node" json:"node_id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;index:idx_svc_config_user" json:"user_id"`

	// Protocols Offered
	EnableHTTP      bool `gorm:"default:true" json:"enable_http"`
	EnableHTTPS     bool `gorm:"default:true" json:"enable_https"`
	EnableSOCKS5    bool `gorm:"default:false" json:"enable_socks5"`
	EnableSSHTunnel bool `gorm:"default:false" json:"enable_ssh_tunnel"`

	// Speed/Quality Tiers
	MaxBandwidthMbps int         `gorm:"default:100" json:"max_bandwidth_mbps"`
	PriorityTier     ServiceTier `gorm:"type:varchar(20);default:'standard'" json:"priority_tier"`

	// Geographic Access Control
	AllowedCountries pq.StringArray `gorm:"type:text[]" json:"allowed_countries"` // Empty = all
	BlockedCountries pq.StringArray `gorm:"type:text[]" json:"blocked_countries"`
	AllowedCities    pq.StringArray `gorm:"type:text[]" json:"allowed_cities"`

	// Usage Limits
	MaxConcurrentConnections int     `gorm:"default:10" json:"max_concurrent_connections"`
	MaxDailyBandwidthGB      float64 `gorm:"default:0" json:"max_daily_bandwidth_gb"` // 0 = unlimited
	MaxRequestsPerMinute     int     `gorm:"default:1000" json:"max_requests_per_minute"`

	// Port Access Control
	AllowedPorts pq.Int64Array `gorm:"type:integer[]" json:"allowed_ports"` // Empty = default (80, 443, 8080)
	BlockedPorts pq.Int64Array `gorm:"type:integer[]" json:"blocked_ports"`

	// Domain Access Control
	AllowedDomains pq.StringArray `gorm:"type:text[]" json:"allowed_domains"` // Whitelist
	BlockedDomains pq.StringArray `gorm:"type:text[]" json:"blocked_domains"` // Blacklist

	// Premium Services - Captcha Solving
	CaptchaSolvingEnabled bool    `gorm:"default:false" json:"captcha_solving_enabled"`
	CaptchaPricePerSolve  float64 `gorm:"default:0.002" json:"captcha_price_per_solve"`
	CaptchaProviderKey    string  `gorm:"type:varchar(255)" json:"-"` // API key for 2captcha, anticaptcha, etc.

	// Premium Services - Browser Fingerprinting
	BrowserFingerprintEnabled  bool    `gorm:"default:false" json:"browser_fingerprint_enabled"`
	FingerprintPricePerSession float64 `gorm:"default:0.01" json:"fingerprint_price_per_session"`

	// Premium Services - JavaScript Rendering
	JavascriptRenderEnabled bool    `gorm:"default:false" json:"javascript_render_enabled"`
	JSRenderPricePerPage    float64 `gorm:"default:0.005" json:"js_render_price_per_page"`

	// Premium Services - Screenshot API
	ScreenshotEnabled         bool    `gorm:"default:false" json:"screenshot_enabled"`
	ScreenshotPricePerCapture float64 `gorm:"default:0.005" json:"screenshot_price_per_capture"`

	// Pricing Multipliers
	PriceMultiplierHTTP     float64 `gorm:"default:1.0" json:"price_multiplier_http"`
	PriceMultiplierHTTPS    float64 `gorm:"default:1.0" json:"price_multiplier_https"`
	PriceMultiplierSOCKS5   float64 `gorm:"default:1.2" json:"price_multiplier_socks5"`
	PriceMultiplierSSH      float64 `gorm:"default:1.5" json:"price_multiplier_ssh"`
	PriceMultiplierPriority float64 `gorm:"default:1.5" json:"price_multiplier_priority"`

	// Rotation Settings
	SupportsStickySession  bool `gorm:"default:true" json:"supports_sticky_session"`
	SupportsAutoRotation   bool `gorm:"default:true" json:"supports_auto_rotation"`
	MinRotationIntervalSec int  `gorm:"default:60" json:"min_rotation_interval_sec"`

	// Dynamic Pricing Settings
	DynamicPricingEnabled bool    `gorm:"default:false" json:"dynamic_pricing_enabled"`
	TargetUtilization     float64 `gorm:"default:0.7" json:"target_utilization"` // 0.0 - 1.0 (70%)
	MinPriceMultiplier    float64 `gorm:"default:0.8" json:"min_price_multiplier"`
	MaxPriceMultiplier    float64 `gorm:"default:2.0" json:"max_price_multiplier"`
	AdjustmentStep        float64 `gorm:"default:0.05" json:"adjustment_step"` // +/- 5%

	// Status
	IsActive  bool      `gorm:"default:true" json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Relations
	Node *Node `gorm:"foreignKey:NodeID" json:"node,omitempty"`
	User *User `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

// SharedServiceTemplate allows providers to share their configs
type SharedServiceTemplate struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	UserID      uuid.UUID `gorm:"type:uuid;not null" json:"user_id"` // Author
	Name        string    `gorm:"type:varchar(100);not null" json:"name"`
	Description string    `gorm:"type:text" json:"description"`
	Price       float64   `gorm:"default:0" json:"price"` // 0 = Free
	Downloads   int       `gorm:"default:0" json:"downloads"`
	Rating      float64   `gorm:"default:0" json:"rating"`

	// The configuration snapshot (JSON)
	ConfigSnapshot string `gorm:"type:text" json:"config_snapshot"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	Author *User `gorm:"foreignKey:UserID" json:"author,omitempty"`
}

func (SharedServiceTemplate) TableName() string {
	return "shared_service_templates"
}

// ServiceConfigHistory tracks changes to service configurations
type ServiceConfigHistory struct {
	ID              uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	ServiceConfigID uuid.UUID `gorm:"type:uuid;not null;index" json:"service_config_id"`
	ChangedBy       uuid.UUID `gorm:"type:uuid;not null" json:"changed_by"`
	ChangeReason    string    `gorm:"type:varchar(255)" json:"change_reason"`

	// Snapshot of the config at that time (JSON)
	ConfigSnapshot string `gorm:"type:text" json:"config_snapshot"`

	CreatedAt time.Time `json:"created_at"`
}

func (ServiceConfigHistory) TableName() string {
	return "service_config_history"
}

func (ServiceConfiguration) TableName() string {
	return "service_configurations"
}

func (s *ServiceConfiguration) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	// Set default allowed ports if empty
	if len(s.AllowedPorts) == 0 {
		s.AllowedPorts = []int64{80, 443, 8080, 8443}
	}
	return nil
}

// GetEffectivePrice calculates effective price with multipliers
func (s *ServiceConfiguration) GetEffectivePrice(basePrice float64, protocol string, isPriority bool) float64 {
	price := basePrice

	switch protocol {
	case "http":
		price *= s.PriceMultiplierHTTP
	case "https":
		price *= s.PriceMultiplierHTTPS
	case "socks5":
		price *= s.PriceMultiplierSOCKS5
	case "ssh":
		price *= s.PriceMultiplierSSH
	}

	if isPriority {
		price *= s.PriceMultiplierPriority
	}

	return price
}

// IsProtocolEnabled checks if a protocol is enabled
func (s *ServiceConfiguration) IsProtocolEnabled(protocol string) bool {
	switch protocol {
	case "http":
		return s.EnableHTTP
	case "https":
		return s.EnableHTTPS
	case "socks5":
		return s.EnableSOCKS5
	case "ssh":
		return s.EnableSSHTunnel
	}
	return false
}

// IsCountryAllowed checks if access from a country is allowed
func (s *ServiceConfiguration) IsCountryAllowed(country string) bool {
	// If allowed list exists and is not empty, only those countries are allowed
	if len(s.AllowedCountries) > 0 {
		for _, c := range s.AllowedCountries {
			if c == country {
				return true
			}
		}
		return false
	}

	// Check blocked list
	for _, c := range s.BlockedCountries {
		if c == country {
			return false
		}
	}

	return true
}

// IsDomainAllowed checks if a domain is allowed
func (s *ServiceConfiguration) IsDomainAllowed(domain string) bool {
	// Check blocked first
	for _, d := range s.BlockedDomains {
		if d == domain {
			return false
		}
	}

	// If whitelist exists, check it
	if len(s.AllowedDomains) > 0 {
		for _, d := range s.AllowedDomains {
			if d == domain {
				return true
			}
		}
		return false
	}

	return true
}

// CreateServiceConfigRequest for API binding
type CreateServiceConfigRequest struct {
	NodeID uuid.UUID `json:"node_id" binding:"required"`

	// Protocols
	EnableHTTP      *bool `json:"enable_http"`
	EnableHTTPS     *bool `json:"enable_https"`
	EnableSOCKS5    *bool `json:"enable_socks5"`
	EnableSSHTunnel *bool `json:"enable_ssh_tunnel"`

	// Tiers
	MaxBandwidthMbps *int         `json:"max_bandwidth_mbps"`
	PriorityTier     *ServiceTier `json:"priority_tier"`

	// Geographic
	AllowedCountries []string `json:"allowed_countries"`
	BlockedCountries []string `json:"blocked_countries"`

	// Limits
	MaxConcurrentConnections *int     `json:"max_concurrent_connections"`
	MaxDailyBandwidthGB      *float64 `json:"max_daily_bandwidth_gb"`
	MaxRequestsPerMinute     *int     `json:"max_requests_per_minute"`

	// Premium Services
	CaptchaSolvingEnabled     *bool    `json:"captcha_solving_enabled"`
	CaptchaPricePerSolve      *float64 `json:"captcha_price_per_solve"`
	JavascriptRenderEnabled   *bool    `json:"javascript_render_enabled"`
	JSRenderPricePerPage      *float64 `json:"js_render_price_per_page"`
	BrowserFingerprintEnabled *bool    `json:"browser_fingerprint_enabled"`

	// Pricing
	PriceMultiplierHTTP   *float64 `json:"price_multiplier_http"`
	PriceMultiplierSOCKS5 *float64 `json:"price_multiplier_socks5"`
}

// UpdateServiceConfigRequest for partial updates
type UpdateServiceConfigRequest struct {
	EnableHTTP               *bool    `json:"enable_http"`
	EnableHTTPS              *bool    `json:"enable_https"`
	EnableSOCKS5             *bool    `json:"enable_socks5"`
	EnableSSHTunnel          *bool    `json:"enable_ssh_tunnel"`
	MaxBandwidthMbps         *int     `json:"max_bandwidth_mbps"`
	PriorityTier             *string  `json:"priority_tier"`
	AllowedCountries         []string `json:"allowed_countries"`
	BlockedCountries         []string `json:"blocked_countries"`
	MaxConcurrentConnections *int     `json:"max_concurrent_connections"`
	MaxDailyBandwidthGB      *float64 `json:"max_daily_bandwidth_gb"`
	CaptchaSolvingEnabled    *bool    `json:"captcha_solving_enabled"`
	JavascriptRenderEnabled  *bool    `json:"javascript_render_enabled"`
	ScreenshotEnabled        *bool    `json:"screenshot_enabled"`
	IsActive                 *bool    `json:"is_active"`
}

// ServiceConfigTemplate predefined configuration templates
type ServiceConfigTemplate struct {
	Name        string               `json:"name"`
	Description string               `json:"description"`
	Config      ServiceConfiguration `json:"config"`
}

// GetDefaultTemplates returns predefined service configuration templates
func GetDefaultTemplates() []ServiceConfigTemplate {
	return []ServiceConfigTemplate{
		{
			Name:        "Basic HTTP",
			Description: "Standard HTTP/HTTPS proxy for general browsing",
			Config: ServiceConfiguration{
				EnableHTTP:               true,
				EnableHTTPS:              true,
				EnableSOCKS5:             false,
				MaxBandwidthMbps:         50,
				PriorityTier:             TierStandard,
				MaxConcurrentConnections: 5,
			},
		},
		{
			Name:        "Full Protocol",
			Description: "All protocols enabled including SOCKS5 and SSH",
			Config: ServiceConfiguration{
				EnableHTTP:               true,
				EnableHTTPS:              true,
				EnableSOCKS5:             true,
				EnableSSHTunnel:          true,
				MaxBandwidthMbps:         100,
				PriorityTier:             TierPriority,
				MaxConcurrentConnections: 20,
			},
		},
		{
			Name:        "Scraping Optimized",
			Description: "Optimized for web scraping with captcha solving and JS rendering",
			Config: ServiceConfiguration{
				EnableHTTP:              true,
				EnableHTTPS:             true,
				MaxBandwidthMbps:        200,
				PriorityTier:            TierPriority,
				CaptchaSolvingEnabled:   true,
				JavascriptRenderEnabled: true,
				SupportsAutoRotation:    true,
			},
		},
		{
			Name:        "Enterprise",
			Description: "Maximum performance with all premium features",
			Config: ServiceConfiguration{
				EnableHTTP:                true,
				EnableHTTPS:               true,
				EnableSOCKS5:              true,
				EnableSSHTunnel:           true,
				MaxBandwidthMbps:          500,
				PriorityTier:              TierEnterprise,
				MaxConcurrentConnections:  100,
				CaptchaSolvingEnabled:     true,
				JavascriptRenderEnabled:   true,
				BrowserFingerprintEnabled: true,
				ScreenshotEnabled:         true,
			},
		},
	}
}
