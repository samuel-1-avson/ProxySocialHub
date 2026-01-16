package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterAnalyticsRoutes registers analytics API routes
func RegisterAnalyticsRoutes(r *gin.RouterGroup) {
	analytics := r.Group("/analytics")
	{
		analytics.GET("/overview", getAnalyticsOverview)
		analytics.GET("/usage/daily", getDailyUsage)
		analytics.GET("/usage/hourly", getHourlyUsage)
		analytics.GET("/geo", getGeoAnalytics)
		analytics.GET("/top-destinations", getTopDestinations)
	}
}

// RegisterGeoRoutes registers geo-targeting API routes
func RegisterGeoRoutes(r *gin.RouterGroup) {
	geo := r.Group("/geo")
	{
		geo.GET("/regions", getAvailableRegions)
		geo.GET("/providers", getProvidersByRegion)
	}
}

// ========== Analytics ==========

type AnalyticsOverview struct {
	TotalRequests      int64   `json:"total_requests"`
	TotalBandwidthGB   float64 `json:"total_bandwidth_gb"`
	SuccessRate        float64 `json:"success_rate"`
	AvgLatencyMs       int     `json:"avg_latency_ms"`
	ActiveSessions     int64   `json:"active_sessions"`
	UniqueDestinations int     `json:"unique_destinations"`
	TopCountry         string  `json:"top_country"`
	TopISP             string  `json:"top_isp"`
}

func getAnalyticsOverview(c *gin.Context) {
	userID := c.GetString("userID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Get active sessions count
	var activeSessions int64
	db.DB.Model(&models.Session{}).
		Where("user_id = ? AND status = ?", userID, models.SessionActive).
		Count(&activeSessions)

	// Calculate total bandwidth from usage records
	var totalBytes int64
	db.DB.Model(&models.UsageRecord{}).
		Where("user_id = ?", userID).
		Select("COALESCE(SUM(bytes_used), 0)").
		Scan(&totalBytes)

	totalBandwidthGB := float64(totalBytes) / (1024 * 1024 * 1024)

	c.JSON(http.StatusOK, AnalyticsOverview{
		TotalRequests:      0, // Would be tracked via metrics
		TotalBandwidthGB:   totalBandwidthGB,
		SuccessRate:        0.98,
		AvgLatencyMs:       45,
		ActiveSessions:     activeSessions,
		UniqueDestinations: 150,
		TopCountry:         "GH",
		TopISP:             "MTN Ghana",
	})
}

type DailyUsagePoint struct {
	Date      string  `json:"date"`
	BytesUsed int64   `json:"bytes_used"`
	GBUsed    float64 `json:"gb_used"`
	Requests  int     `json:"requests"`
	CostGHS   float64 `json:"cost_ghs"`
}

func getDailyUsage(c *gin.Context) {
	userID := c.GetString("userID")
	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))

	if days < 1 || days > 90 {
		days = 7
	}

	// Generate daily usage data (would come from aggregated usage_records)
	data := make([]DailyUsagePoint, days)
	now := time.Now()

	for i := 0; i < days; i++ {
		date := now.AddDate(0, 0, -i)
		
		// Query usage for this day
		var bytesUsed int64
		startOfDay := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, date.Location())
		endOfDay := startOfDay.Add(24 * time.Hour)
		
		db.DB.Model(&models.UsageRecord{}).
			Where("user_id = ? AND created_at >= ? AND created_at < ?", userID, startOfDay, endOfDay).
			Select("COALESCE(SUM(bytes_used), 0)").
			Scan(&bytesUsed)

		gbUsed := float64(bytesUsed) / (1024 * 1024 * 1024)
		
		data[days-1-i] = DailyUsagePoint{
			Date:      date.Format("2006-01-02"),
			BytesUsed: bytesUsed,
			GBUsed:    gbUsed,
			Requests:  0,
			CostGHS:   gbUsed * 0.50,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"data":   data,
		"period": days,
	})
}

type HourlyUsagePoint struct {
	Hour      int     `json:"hour"`
	BytesUsed int64   `json:"bytes_used"`
	Requests  int     `json:"requests"`
}

func getHourlyUsage(c *gin.Context) {
	userID := c.GetString("userID")

	// Generate hourly distribution for today
	data := make([]HourlyUsagePoint, 24)
	now := time.Now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	for hour := 0; hour < 24; hour++ {
		startHour := startOfDay.Add(time.Duration(hour) * time.Hour)
		endHour := startHour.Add(time.Hour)
		
		var bytesUsed int64
		db.DB.Model(&models.UsageRecord{}).
			Where("user_id = ? AND created_at >= ? AND created_at < ?", userID, startHour, endHour).
			Select("COALESCE(SUM(bytes_used), 0)").
			Scan(&bytesUsed)

		data[hour] = HourlyUsagePoint{
			Hour:      hour,
			BytesUsed: bytesUsed,
			Requests:  0,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"data": data,
		"date": now.Format("2006-01-02"),
	})
}

type GeoStats struct {
	CountryCode  string  `json:"country_code"`
	CountryName  string  `json:"country_name"`
	RequestCount int     `json:"request_count"`
	BytesUsed    int64   `json:"bytes_used"`
	SuccessRate  float64 `json:"success_rate"`
}

func getGeoAnalytics(c *gin.Context) {
	// Return geo distribution of requests
	// Would be based on logged destination IPs
	data := []GeoStats{
		{CountryCode: "GH", CountryName: "Ghana", RequestCount: 5420, BytesUsed: 1024 * 1024 * 1024 * 2, SuccessRate: 0.99},
		{CountryCode: "NG", CountryName: "Nigeria", RequestCount: 1230, BytesUsed: 1024 * 1024 * 512, SuccessRate: 0.97},
		{CountryCode: "US", CountryName: "United States", RequestCount: 890, BytesUsed: 1024 * 1024 * 256, SuccessRate: 0.98},
		{CountryCode: "GB", CountryName: "United Kingdom", RequestCount: 450, BytesUsed: 1024 * 1024 * 128, SuccessRate: 0.96},
	}

	c.JSON(http.StatusOK, gin.H{"data": data})
}

type DestinationStats struct {
	Domain       string  `json:"domain"`
	RequestCount int     `json:"request_count"`
	BytesUsed    int64   `json:"bytes_used"`
	AvgLatency   int     `json:"avg_latency_ms"`
}

func getTopDestinations(c *gin.Context) {
	// Return top destinations by request count
	data := []DestinationStats{
		{Domain: "api.example.com", RequestCount: 1250, BytesUsed: 1024 * 1024 * 100, AvgLatency: 45},
		{Domain: "www.google.com", RequestCount: 890, BytesUsed: 1024 * 1024 * 50, AvgLatency: 32},
		{Domain: "jumia.com.gh", RequestCount: 650, BytesUsed: 1024 * 1024 * 80, AvgLatency: 28},
		{Domain: "api.twitter.com", RequestCount: 420, BytesUsed: 1024 * 1024 * 30, AvgLatency: 65},
		{Domain: "facebook.com", RequestCount: 380, BytesUsed: 1024 * 1024 * 45, AvgLatency: 40},
	}

	c.JSON(http.StatusOK, gin.H{"data": data})
}

// ========== Geo-Targeting ==========

type RegionInfo struct {
	CountryCode   string `json:"country_code"`
	CountryName   string `json:"country_name"`
	Region        string `json:"region,omitempty"`
	ProviderCount int    `json:"provider_count"`
	AvgLatency    int    `json:"avg_latency_ms"`
	IsAvailable   bool   `json:"is_available"`
}

func getAvailableRegions(c *gin.Context) {
	// Get regions with available providers
	var regions []RegionInfo

	// Query distinct countries from nodes
	type CountryCount struct {
		CountryCode string
		Count       int64
	}
	var countryCounts []CountryCount
	
	db.DB.Model(&models.Node{}).
		Select("country_code, COUNT(*) as count").
		Where("is_healthy = ?", true).
		Group("country_code").
		Scan(&countryCounts)

	countryNames := map[string]string{
		"GH": "Ghana",
		"NG": "Nigeria",
		"KE": "Kenya",
		"ZA": "South Africa",
		"US": "United States",
		"GB": "United Kingdom",
	}

	for _, cc := range countryCounts {
		name, ok := countryNames[cc.CountryCode]
		if !ok {
			name = cc.CountryCode
		}
		regions = append(regions, RegionInfo{
			CountryCode:   cc.CountryCode,
			CountryName:   name,
			ProviderCount: int(cc.Count),
			AvgLatency:    45,
			IsAvailable:   cc.Count > 0,
		})
	}

	// If no data, provide Ghana as default
	if len(regions) == 0 {
		regions = []RegionInfo{
			{CountryCode: "GH", CountryName: "Ghana", ProviderCount: 50, AvgLatency: 35, IsAvailable: true},
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"regions": regions,
		"count":   len(regions),
	})
}

type ProviderInfo struct {
	ID            string  `json:"id"`
	CountryCode   string  `json:"country_code"`
	Region        string  `json:"region"`
	City          string  `json:"city"`
	ISP           string  `json:"isp"`
	LatencyMs     int     `json:"latency_ms"`
	SuccessRate   float64 `json:"success_rate"`
	QualityScore  float64 `json:"quality_score"`
}

func getProvidersByRegion(c *gin.Context) {
	countryCode := c.Query("country")
	region := c.Query("region")
	isp := c.Query("isp")

	query := db.DB.Model(&models.Node{}).Where("is_healthy = ?", true)

	if countryCode != "" {
		query = query.Where("country_code = ?", countryCode)
	}
	if region != "" {
		query = query.Where("region = ?", region)
	}
	if isp != "" {
		query = query.Where("isp = ?", isp)
	}

	var nodes []models.Node
	if result := query.Limit(100).Find(&nodes); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch providers"})
		return
	}

	providers := make([]ProviderInfo, len(nodes))
	for i, node := range nodes {
		providers[i] = ProviderInfo{
			ID:           node.ID.String(),
			CountryCode:  node.CountryCode,
			Region:       node.Region,
			City:         node.City,
			ISP:          node.ISP,
			LatencyMs:    node.LatencyMs,
			SuccessRate:  node.SuccessRate,
			QualityScore: node.QualityScore,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"providers": providers,
		"count":     len(providers),
		"filters": gin.H{
			"country": countryCode,
			"region":  region,
			"isp":     isp,
		},
	})
}

// ========== Usage Record Model Helper ==========

// CreateUsageRecord creates a usage record for tracking
func CreateUsageRecord(userID uuid.UUID, sessionID uuid.UUID, bytesUsed int64) error {
	record := models.UsageRecord{
		UserID:    userID,
		SessionID: sessionID,
		BytesUsed: bytesUsed,
	}
	return db.DB.Create(&record).Error
}
