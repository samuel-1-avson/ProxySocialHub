package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/cache"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/marketplace/discovery"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterServiceDiscoveryRoutes registers legacy service discovery routes (deprecated; use /v1/listings).
func RegisterServiceDiscoveryRoutes(r *gin.RouterGroup) {
	discoveryGroup := r.Group("/services")
	discoveryGroup.Use(deprecatedDiscoveryHeaders())
	{
		discoveryGroup.GET("", discoverServices)
		discoveryGroup.GET("/filters", getAvailableFilters)
		discoveryGroup.GET("/routing-profiles", getRoutingProfiles)
		discoveryGroup.GET("/geo-coverage", getGeoCoverage)
		discoveryGroup.POST("/match", matchServices)
	}
}

// @Summary Discover available services with filters (deprecated)
// @Description Deprecated: use GET /v1/listings. This route wraps the shared listing discovery layer.
// @Tags service-discovery
// @Deprecated
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

	logging.Info().
		Interface("filter", filter).
		Msg("Discovering services (deprecated /v1/services)")

	cacheKey := generateSearchKey(filter)
	var cachedResponse gin.H
	if hit, _ := cache.Get(cacheKey, &cachedResponse); hit {
		logging.Debug().Msg("Search cache hit")
		c.JSON(http.StatusOK, cachedResponse)
		return
	}

	q := discovery.FromServiceFilter(filter)
	query := discovery.Apply(discovery.BaseQuery(db.DB), q)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch services"})
		return
	}

	var listings []models.ProxyListing
	offset := discovery.Offset(q.Page, q.Limit)
	if err := discovery.ServiceDiscoveryOrder(query).
		Preload("Seller").
		Offset(offset).
		Limit(q.Limit).
		Find(&listings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch services"})
		return
	}

	response := gin.H{
		"services": listings,
		"total":    total,
		"page":     filter.Page,
		"limit":    q.Limit,
	}

	cache.Set(cacheKey, response, cache.DiscoverySearchTTL)

	c.JSON(http.StatusOK, response)
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

// @Summary Get available filter options (deprecated)
// @Tags service-discovery
// @Deprecated
// @Produce json
// @Success 200 {object} FilterOptions
// @Router /v1/services/filters [get]
func getAvailableFilters(c *gin.Context) {
	cacheKey := cache.DiscoveryKeyPrefix + "filters"
	var cachedOptions FilterOptions
	if hit, _ := cache.Get(cacheKey, &cachedOptions); hit {
		c.JSON(http.StatusOK, cachedOptions)
		return
	}

	options := FilterOptions{
		Protocols:     []string{"http", "https", "socks5", "ssh"},
		ProxyTypes:    []string{"residential", "mobile", "datacenter"},
		RotationTypes: []string{"static", "rotating", "sticky"},
		PriorityTiers: []string{"standard", "priority", "enterprise"},
	}

	var countries []string
	db.DB.Model(&models.ProxyListing{}).
		Where("status = ?", models.ListingStatusActive).
		Distinct("country").
		Pluck("country", &countries)
	options.Countries = countries

	var isps []string
	db.DB.Model(&models.ProxyListing{}).
		Where("status = ? AND isp != ''", models.ListingStatusActive).
		Distinct("isp").
		Pluck("isp", &isps)
	options.ISPs = isps

	cache.Set(cacheKey, options, cache.DiscoveryFiltersTTL)
	c.JSON(http.StatusOK, options)
}

// @Summary Get routing profiles (deprecated)
// @Tags service-discovery
// @Deprecated
// @Produce json
// @Success 200 {array} models.RoutingProfile
// @Router /v1/services/routing-profiles [get]
func getRoutingProfiles(c *gin.Context) {
	var profiles []models.RoutingProfile
	db.DB.Where("is_active = ?", true).Order("name").Find(&profiles)

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

// @Summary Get geographic coverage (deprecated)
// @Tags service-discovery
// @Deprecated
// @Produce json
// @Success 200 {array} GeoCoverage
// @Router /v1/services/geo-coverage [get]
func getGeoCoverage(c *gin.Context) {
	cacheKey := cache.DiscoveryKeyPrefix + "geo"
	var cachedCoverage []GeoCoverage
	if hit, _ := cache.Get(cacheKey, &cachedCoverage); hit {
		c.JSON(http.StatusOK, gin.H{"coverage": cachedCoverage})
		return
	}

	var coverage []GeoCoverage

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

	cache.Set(cacheKey, coverage, cache.DiscoveryGeoTTL)
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

// @Summary Match services using intelligent routing (deprecated)
// @Tags service-discovery
// @Deprecated
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

	logging.Info().
		Str("use_case", req.UseCase).
		Str("profile_id", req.RoutingProfileID).
		Int("count", req.Count).
		Msg("Matching services (deprecated /v1/services/match)")

	cacheKey := generateMatchKey(req)
	var cachedResponse gin.H
	if hit, _ := cache.Get(cacheKey, &cachedResponse); hit {
		c.JSON(http.StatusOK, cachedResponse)
		return
	}

	if req.Count == 0 {
		req.Count = 5
	}

	var profile models.RoutingProfile
	if req.RoutingProfileID != "" {
		db.DB.Where("id = ? OR slug = ?", req.RoutingProfileID, req.RoutingProfileID).First(&profile)
	} else if req.UseCase != "" {
		db.DB.Where("use_case = ? AND is_active = true", req.UseCase).First(&profile)
	}

	matchQuery := discovery.Query{TargetCountries: req.TargetCountries}
	if req.MinQuality > 0 {
		matchQuery.MinQualityScore = req.MinQuality
		matchQuery.MinQualitySet = true
	}
	if req.MaxPrice > 0 {
		matchQuery.MaxPrice = req.MaxPrice
		matchQuery.MaxPriceSet = true
	}
	if len(req.RequiredProtocols) > 0 {
		matchQuery.Protocols = req.RequiredProtocols
	}

	query := discovery.Apply(discovery.BaseQuery(db.DB), matchQuery)

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

	response := gin.H{
		"matches": listings,
		"profile": profile,
		"count":   len(listings),
	}

	cache.Set(cacheKey, response, cache.DiscoveryMatchTTL)

	c.JSON(http.StatusOK, response)
}

func floatToStr(f float64) string {
	return strconv.FormatFloat(f, 'f', -1, 64)
}

func generateSearchKey(filter models.ServiceFilter) string {
	data, _ := json.Marshal(filter)
	hash := sha256.Sum256(data)
	return cache.DiscoveryKeyPrefix + "search:" + hex.EncodeToString(hash[:])
}

func generateMatchKey(req MatchRequest) string {
	data, _ := json.Marshal(req)
	hash := sha256.Sum256(data)
	return cache.DiscoveryKeyPrefix + "match:" + hex.EncodeToString(hash[:])
}
