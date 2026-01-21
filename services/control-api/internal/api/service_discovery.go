package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterServiceDiscoveryRoutes registers service discovery/marketplace routes
func RegisterServiceDiscoveryRoutes(r *gin.RouterGroup) {
	discovery := r.Group("/services")
	{
		discovery.GET("", discoverServices)
		discovery.GET("/filters", getAvailableFilters)
		discovery.GET("/routing-profiles", getRoutingProfiles)
		discovery.GET("/geo-coverage", getGeoCoverage)
		discovery.POST("/match", matchServices)
	}
}

// @Summary Discover available services with filters
// @Tags service-discovery
// @Accept json
// @Produce json
// @Param protocols query []string false "Protocols (http,https,socks5,ssh)"
// @Param target_countries query []string false "Target countries"
// @Param min_quality_score query number false "Minimum quality score"
// @Param max_price_per_gb query number false "Maximum price per GB"
// @Success 200 {array} ServiceResult
// @Router /v1/services [get]
func discoverServices(c *gin.Context) {
	var filter models.ServiceFilter
	if err := c.ShouldBindQuery(&filter); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Default pagination
	if filter.Limit == 0 {
		filter.Limit = 20
	}
	if filter.Limit > 100 {
		filter.Limit = 100
	}

	// Build query
	query := db.DB.Model(&models.ProxyListing{}).
		Joins("LEFT JOIN service_configurations sc ON sc.node_id = proxy_listings.id").
		Joins("LEFT JOIN nodes n ON n.id = proxy_listings.id").
		Where("proxy_listings.status = ?", models.ListingStatusActive)

	// Protocol filters
	if len(filter.Protocols) > 0 {
		protocolConditions := []string{}
		for _, p := range filter.Protocols {
			switch p {
			case "http":
				protocolConditions = append(protocolConditions, "COALESCE(sc.enable_http, true) = true")
			case "https":
				protocolConditions = append(protocolConditions, "COALESCE(sc.enable_https, true) = true")
			case "socks5":
				protocolConditions = append(protocolConditions, "sc.enable_socks5 = true")
			case "ssh":
				protocolConditions = append(protocolConditions, "sc.enable_ssh_tunnel = true")
			}
		}
		if len(protocolConditions) > 0 {
			query = query.Where("(" + strings.Join(protocolConditions, " OR ") + ")")
		}
	}

	// Geographic filters
	if len(filter.TargetCountries) > 0 {
		query = query.Where("proxy_listings.country IN ?", filter.TargetCountries)
	}

	// Quality filters
	if filter.MinQualityScore > 0 {
		query = query.Where("proxy_listings.quality_score >= ?", filter.MinQualityScore)
	}
	if filter.MinSuccessRate > 0 {
		query = query.Where("proxy_listings.success_rate >= ?", filter.MinSuccessRate)
	}
	if filter.MinUptimePercent > 0 {
		query = query.Where("proxy_listings.uptime_percent >= ?", filter.MinUptimePercent)
	}

	// Speed filters
	if filter.MinBandwidthMbps > 0 {
		query = query.Where("COALESCE(sc.max_bandwidth_mbps, 100) >= ?", filter.MinBandwidthMbps)
	}
	if filter.PriorityTier != "" {
		query = query.Where("COALESCE(sc.priority_tier, 'standard') = ?", filter.PriorityTier)
	}

	// Premium service filters
	if filter.RequireCaptchaSolving {
		query = query.Where("sc.captcha_solving_enabled = true")
	}
	if filter.RequireJsRendering {
		query = query.Where("sc.javascript_render_enabled = true")
	}
	if filter.RequireBrowserFingerprint {
		query = query.Where("sc.browser_fingerprint_enabled = true")
	}

	// Price filter
	if filter.MaxPricePerGB > 0 {
		query = query.Where("proxy_listings.price_per_gb <= ?", filter.MaxPricePerGB)
	}

	// Rotation filters
	if filter.RequireStickySession {
		query = query.Where("COALESCE(sc.supports_sticky_session, true) = true")
	}
	if filter.RequireAutoRotation {
		query = query.Where("COALESCE(sc.supports_auto_rotation, true) = true")
	}

	// Count total
	var total int64
	query.Count(&total)

	// Fetch results
	var listings []models.ProxyListing
	if err := query.
		Preload("Seller").
		Order("proxy_listings.quality_score DESC, proxy_listings.price_per_gb ASC").
		Offset(filter.Page * filter.Limit).
		Limit(filter.Limit).
		Find(&listings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch services"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"services": listings,
		"total":    total,
		"page":     filter.Page,
		"limit":    filter.Limit,
	})
}

// FilterOptions represents available filter options
type FilterOptions struct {
	Protocols     []string `json:"protocols"`
	Countries     []string `json:"countries"`
	Cities        []string `json:"cities"`
	ISPs          []string `json:"isps"`
	ProxyTypes    []string `json:"proxy_types"`
	RotationTypes []string `json:"rotation_types"`
	PriorityTiers []string `json:"priority_tiers"`
}

// @Summary Get available filter options
// @Tags service-discovery
// @Produce json
// @Success 200 {object} FilterOptions
// @Router /v1/services/filters [get]
func getAvailableFilters(c *gin.Context) {
	options := FilterOptions{
		Protocols:     []string{"http", "https", "socks5", "ssh"},
		ProxyTypes:    []string{"residential", "mobile", "datacenter"},
		RotationTypes: []string{"static", "rotating", "sticky"},
		PriorityTiers: []string{"standard", "priority", "enterprise"},
	}

	// Get distinct countries
	var countries []string
	db.DB.Model(&models.ProxyListing{}).
		Where("status = ?", models.ListingStatusActive).
		Distinct("country").
		Pluck("country", &countries)
	options.Countries = countries

	// Get distinct ISPs
	var isps []string
	db.DB.Model(&models.ProxyListing{}).
		Where("status = ? AND isp != ''", models.ListingStatusActive).
		Distinct("isp").
		Pluck("isp", &isps)
	options.ISPs = isps

	c.JSON(http.StatusOK, options)
}

// @Summary Get routing profiles
// @Tags service-discovery
// @Produce json
// @Success 200 {array} models.RoutingProfile
// @Router /v1/services/routing-profiles [get]
func getRoutingProfiles(c *gin.Context) {
	// First check DB for custom profiles
	var profiles []models.RoutingProfile
	db.DB.Where("is_active = ?", true).Order("name").Find(&profiles)

	// If empty, seed with defaults
	if len(profiles) == 0 {
		defaults := models.GetDefaultRoutingProfiles()
		for _, p := range defaults {
			db.DB.Create(&p)
			profiles = append(profiles, p)
		}
	}

	c.JSON(http.StatusOK, gin.H{"profiles": profiles})
}

// GeoCoverage represents geographic coverage stats
type GeoCoverage struct {
	Country        string  `json:"country"`
	NodeCount      int     `json:"node_count"`
	AvgQuality     float64 `json:"avg_quality"`
	AvgPrice       float64 `json:"avg_price"`
	HasResidential bool    `json:"has_residential"`
	HasMobile      bool    `json:"has_mobile"`
	HasDatacenter  bool    `json:"has_datacenter"`
}

// @Summary Get geographic coverage
// @Tags service-discovery
// @Produce json
// @Success 200 {array} GeoCoverage
// @Router /v1/services/geo-coverage [get]
func getGeoCoverage(c *gin.Context) {
	var coverage []GeoCoverage

	// Aggregate by country
	rows, err := db.DB.Model(&models.ProxyListing{}).
		Select(`
			country,
			COUNT(*) as node_count,
			AVG(quality_score) as avg_quality,
			AVG(price_per_gb) as avg_price,
			BOOL_OR(proxy_type = 'residential') as has_residential,
			BOOL_OR(proxy_type = 'mobile') as has_mobile,
			BOOL_OR(proxy_type = 'datacenter') as has_datacenter
		`).
		Where("status = ? AND country != ''", models.ListingStatusActive).
		Group("country").
		Order("node_count DESC").
		Rows()

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch coverage"})
		return
	}
	defer rows.Close()

	for rows.Next() {
		var cov GeoCoverage
		if err := rows.Scan(
			&cov.Country,
			&cov.NodeCount,
			&cov.AvgQuality,
			&cov.AvgPrice,
			&cov.HasResidential,
			&cov.HasMobile,
			&cov.HasDatacenter,
		); err == nil {
			coverage = append(coverage, cov)
		}
	}

	c.JSON(http.StatusOK, gin.H{"coverage": coverage})
}

// MatchRequest for advanced matching
type MatchRequest struct {
	UseCase           string   `json:"use_case"`
	RoutingProfileID  string   `json:"routing_profile_id"`
	TargetCountries   []string `json:"target_countries"`
	RequiredProtocols []string `json:"required_protocols"`
	MinQuality        float64  `json:"min_quality"`
	MaxPrice          float64  `json:"max_price"`
	Count             int      `json:"count"`
}

// @Summary Match services using intelligent routing
// @Tags service-discovery
// @Accept json
// @Produce json
// @Param request body MatchRequest true "Match criteria"
// @Success 200 {array} models.ProxyListing
// @Router /v1/services/match [post]
func matchServices(c *gin.Context) {
	var req MatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Count == 0 {
		req.Count = 5
	}

	// Get routing profile if specified
	var profile models.RoutingProfile
	if req.RoutingProfileID != "" {
		db.DB.Where("id = ? OR slug = ?", req.RoutingProfileID, req.RoutingProfileID).First(&profile)
	} else if req.UseCase != "" {
		db.DB.Where("use_case = ? AND is_active = true", req.UseCase).First(&profile)
	}

	// Build weighted query
	query := db.DB.Model(&models.ProxyListing{}).
		Where("status = ?", models.ListingStatusActive)

	// Apply filters
	if len(req.TargetCountries) > 0 {
		query = query.Where("country IN ?", req.TargetCountries)
	}
	if req.MinQuality > 0 {
		query = query.Where("quality_score >= ?", req.MinQuality)
	}
	if req.MaxPrice > 0 {
		query = query.Where("price_per_gb <= ?", req.MaxPrice)
	}

	// Build weighted score
	weightedScore := "("
	if profile.ID.String() != "" {
		weightedScore += "quality_score * " + floatToStr(profile.StabilityWeight) + " + "
		weightedScore += "(100.0 / NULLIF(avg_latency_ms, 0)) * " + floatToStr(profile.SpeedWeight) + " + "
		weightedScore += "(10.0 / NULLIF(price_per_gb, 0)) * " + floatToStr(profile.PriceWeight)
	} else {
		weightedScore += "quality_score * 0.5 + (100.0 / NULLIF(avg_latency_ms, 1)) * 0.3"
	}
	weightedScore += ") as match_score"

	var listings []models.ProxyListing
	if err := query.
		Select("*, " + weightedScore).
		Preload("Seller").
		Order("match_score DESC").
		Limit(req.Count).
		Find(&listings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to match services"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"matches": listings,
		"profile": profile,
		"count":   len(listings),
	})
}

func floatToStr(f float64) string {
	return strings.TrimRight(strings.TrimRight(
		strings.Replace(
			strings.TrimPrefix(
				"0.00"+strings.TrimPrefix(
					strings.Replace(
						"0.00",
						".",
						"",
						1,
					)+strings.TrimPrefix(
						"0",
						"",
					),
					"",
				),
				"0",
			),
			"",
			".",
			1,
		),
		"0",
	), ".")
}
