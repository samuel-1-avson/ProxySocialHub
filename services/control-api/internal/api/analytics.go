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

	// 1. Active active
	var activeSessions int64
	db.DB.Model(&models.Session{}).
		Where("user_id = ? AND status = ?", userID, models.SessionActive).
		Count(&activeSessions)

	// 2. Aggregate Usage Stats
	type UsageStats struct {
		TotalRequests      int64
		TotalBytes         int64
		SuccessCount       int64
		AvgLatency         float64
		UniqueDestinations int
	}
	var stats UsageStats

	// We use a raw query or Gorm aggregation
	// Note: UniqueDestinations needs Count(DISTINCT dest_host)
	db.DB.Model(&models.UsageRecord{}).
		Where("user_id = ?", userID).
		Select(`
			COUNT(*) as total_requests,
			COALESCE(SUM(bytes_used), 0) as total_bytes,
			COALESCE(SUM(CASE WHEN success THEN 1 ELSE 0 END), 0) as success_count,
			COALESCE(AVG(latency_ms), 0) as avg_latency,
			COUNT(DISTINCT dest_host) as unique_destinations
		`).
		Scan(&stats)

	totalBandwidthGB := float64(stats.TotalBytes) / (1024 * 1024 * 1024)
	successRate := 0.0
	if stats.TotalRequests > 0 {
		successRate = float64(stats.SuccessCount) / float64(stats.TotalRequests)
	}

	// 3. Top Country/ISP (based on Volume of usage per node location)
	type TopMetric struct {
		Name string
		Val  int64
	}
	var topCountry TopMetric
	// Join Usage -> Node to get country
	db.DB.Table("usage_records").
		Joins("JOIN provider_nodes ON usage_records.node_id = provider_nodes.id").
		Where("usage_records.user_id = ?", userID).
		Select("provider_nodes.country as name, SUM(usage_records.bytes_used) as val").
		Group("provider_nodes.country").
		Order("val DESC").
		Limit(1).
		Scan(&topCountry)

	var topISP TopMetric
	// Note: ProviderNode doesn't have ISP field in struct, but table might?
	// Features.go ProviderNode has: Name, IPAddress, Country, City, Status, TotalBandwidth, QualityScore, LastSeenAt, CreatedAt, IsRegistered, NetUID, Hotkey.
	// NO ISP field.
	// So we can't key by ISP anymore unless we add it or use Name/City.
	// For now, let's use City as proxy for "ISP" or just skip ISP.
	// Or we can assume Name contains ISP info?
	// Let's us City for now to avoid SQL error if ISP column doesn't exist.
	db.DB.Table("usage_records").
		Joins("JOIN provider_nodes ON usage_records.node_id = provider_nodes.id").
		Where("usage_records.user_id = ?", userID).
		Select("provider_nodes.city as name, SUM(usage_records.bytes_used) as val").
		Group("provider_nodes.city").
		Order("val DESC").
		Limit(1).
		Scan(&topISP)

	c.JSON(http.StatusOK, AnalyticsOverview{
		TotalRequests:      stats.TotalRequests,
		TotalBandwidthGB:   totalBandwidthGB,
		SuccessRate:        successRate,
		AvgLatencyMs:       int(stats.AvgLatency),
		ActiveSessions:     activeSessions,
		UniqueDestinations: stats.UniqueDestinations,
		TopCountry:         topCountry.Name,
		TopISP:             topISP.Name,
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

	// Retrieve grouped daily stats in one query
	type DailyStat struct {
		Date       string
		BytesTotal int64
		ReqTotal   int
	}
	var dbStats []DailyStat

	now := time.Now()
	startDate := now.AddDate(0, 0, -days)

	// Postgres dependent date grouping
	db.DB.Model(&models.UsageRecord{}).
		Where("user_id = ? AND created_at >= ?", userID, startDate).
		Select(`
			TO_CHAR(created_at, 'YYYY-MM-DD') as date, 
			SUM(bytes_used) as bytes_total,
			COUNT(*) as req_total
		`).
		Group("TO_CHAR(created_at, 'YYYY-MM-DD')").
		Order("date ASC").
		Scan(&dbStats)

	// Map to map for easy lookup
	statsMap := make(map[string]DailyStat)
	for _, s := range dbStats {
		statsMap[s.Date] = s
	}

	data := make([]DailyUsagePoint, days)
	for i := 0; i < days; i++ {
		// Fill in reverse order often preferred, but let's match loop logic: past -> now or now -> past?
		// "data" array usually is ordered. Let's do chronological: older -> newer
		// But the days loop usually goes 0..days. Let's make it chronological.
		// Wait, usage chart usually wants specific order. Let's do chronological.

		// Actually let's just stick to the previous logic of simple iteration
		// previous code did: date = now.AddDate(0, 0, -i) which is descending.
		// Let's do descending to match API expectation if any, but Charts usually want Ascending.
		// The previous implementation returned Descending (today, yesterday...).
		// Let's stick to Descending for consistency with previous file logic if generic,
		// BUT charts usually expect Ascending.
		// Looking at frontend `BarChart` logic: `data.map(...)`.
		// If data is [Today, Yesterday], chart draws Today on left? No, usually left is old.
		// Let's return Ascending (Old -> New).

		targetDay := now.AddDate(0, 0, -(days - 1 - i)) // i=0 -> -6 (oldest), i=6 -> 0 (today)
		dateStr := targetDay.Format("2006-01-02")

		stat, ok := statsMap[dateStr]
		bytes := int64(0)
		reqs := 0
		if ok {
			bytes = stat.BytesTotal
			reqs = stat.ReqTotal
		}

		gbUsed := float64(bytes) / (1024 * 1024 * 1024)

		data[i] = DailyUsagePoint{
			Date:      dateStr,
			BytesUsed: bytes,
			GBUsed:    gbUsed,
			Requests:  reqs,
			CostGHS:   gbUsed * 0.50,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"data":   data,
		"period": days,
	})
}

type HourlyUsagePoint struct {
	Hour      int   `json:"hour"`
	BytesUsed int64 `json:"bytes_used"`
	Requests  int   `json:"requests"`
}

func getHourlyUsage(c *gin.Context) {
	userID := c.GetString("userID")

	type HourlyStat struct {
		Hour       int
		BytesTotal int64
		ReqTotal   int
	}
	var dbStats []HourlyStat

	now := time.Now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	endOfDay := startOfDay.Add(24 * time.Hour)

	// Postgres specific: EXTRACT(HOUR from created_at)
	db.DB.Model(&models.UsageRecord{}).
		Where("user_id = ? AND created_at >= ? AND created_at < ?", userID, startOfDay, endOfDay).
		Select(`
			EXTRACT(HOUR from created_at) as hour,
			SUM(bytes_used) as bytes_total,
			COUNT(*) as req_total
		`).
		Group("EXTRACT(HOUR from created_at)").
		Scan(&dbStats)

	statsMap := make(map[int]HourlyStat)
	for _, s := range dbStats {
		statsMap[s.Hour] = s
	}

	data := make([]HourlyUsagePoint, 24)
	for hour := 0; hour < 24; hour++ {
		stat, ok := statsMap[hour]
		bytes := int64(0)
		reqs := 0
		if ok {
			bytes = stat.BytesTotal
			reqs = stat.ReqTotal
		}

		data[hour] = HourlyUsagePoint{
			Hour:      hour,
			BytesUsed: bytes,
			Requests:  reqs,
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
	userID := c.GetString("userID")

	type GeoAgg struct {
		CountryCode  string
		ReqCount     int
		BytesTotal   int64
		SuccessCount int64
	}
	var results []GeoAgg

	db.DB.Table("usage_records").
		Joins("JOIN nodes ON usage_records.node_id = nodes.id").
		Where("usage_records.user_id = ?", userID).
		Select(`
			nodes.country_code,
			COUNT(usage_records.id) as req_count,
			SUM(usage_records.bytes_used) as bytes_total,
			SUM(CASE WHEN usage_records.success THEN 1 ELSE 0 END) as success_count
		`).
		Group("nodes.country_code").
		Order("req_count DESC").
		Limit(10).
		Scan(&results)

	// Helper to map codes to names (simplified)
	countryNames := map[string]string{
		"GH": "Ghana", "NG": "Nigeria", "US": "United States", "GB": "United Kingdom",
		"DE": "Germany", "ZA": "South Africa", "KE": "Kenya", "FR": "France",
	}

	data := make([]GeoStats, len(results))
	for i, r := range results {
		name := countryNames[r.CountryCode]
		if name == "" {
			name = r.CountryCode
		}

		rate := 0.0
		if r.ReqCount > 0 {
			rate = float64(r.SuccessCount) / float64(r.ReqCount)
		}

		data[i] = GeoStats{
			CountryCode:  r.CountryCode,
			CountryName:  name,
			RequestCount: r.ReqCount,
			BytesUsed:    r.BytesTotal,
			SuccessRate:  rate,
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": data})
}

type DestinationStats struct {
	Domain       string `json:"domain"`
	RequestCount int    `json:"request_count"`
	BytesUsed    int64  `json:"bytes_used"`
	AvgLatency   int    `json:"avg_latency_ms"`
}

func getTopDestinations(c *gin.Context) {
	userID := c.GetString("userID")

	type DestAgg struct {
		DestHost   string
		ReqCount   int
		BytesTotal int64
		AvgLat     float64
	}
	var results []DestAgg

	db.DB.Model(&models.UsageRecord{}).
		Where("user_id = ? AND dest_host != ''", userID).
		Select(`
			dest_host,
			COUNT(*) as req_count,
			SUM(bytes_used) as bytes_total,
			AVG(latency_ms) as avg_lat
		`).
		Group("dest_host").
		Order("req_count DESC").
		Limit(10).
		Scan(&results)

	data := make([]DestinationStats, len(results))
	for i, r := range results {
		data[i] = DestinationStats{
			Domain:       r.DestHost,
			RequestCount: r.ReqCount,
			BytesUsed:    r.BytesTotal,
			AvgLatency:   int(r.AvgLat),
		}
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
	ID           string  `json:"id"`
	CountryCode  string  `json:"country_code"`
	Region       string  `json:"region"`
	City         string  `json:"city"`
	ISP          string  `json:"isp"`
	LatencyMs    int     `json:"latency_ms"`
	SuccessRate  float64 `json:"success_rate"`
	QualityScore float64 `json:"quality_score"`
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
