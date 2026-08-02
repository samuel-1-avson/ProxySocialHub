package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// Network status payload consumed by apps/web dashboard analytics
// (src/app/dashboard/analytics/page.tsx). Field names must stay in sync with
// the frontend NetworkStatus interface.
type networkStatusNodeScore struct {
	ID      string  `json:"id"`
	Country string  `json:"country"`
	Region  string  `json:"region"`
	Score   float64 `json:"score"`
}

type networkStatusResponse struct {
	TotalNodes   int64                    `json:"total_nodes"`
	HealthyNodes int64                    `json:"healthy_nodes"`
	AvgLatency   float64                  `json:"avg_latency"`
	TopCountries []string                 `json:"top_countries"`
	NodeScores   []networkStatusNodeScore `json:"node_scores"`
}

// RegisterNetworkRoutes mounts network-wide status endpoints.
func RegisterNetworkRoutes(rg *gin.RouterGroup) {
	rg.GET("/network/status", getNetworkStatus)
}

// GET /v1/network/status — aggregate node health for the analytics dashboard.
func getNetworkStatus(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "read_only", "source_of_truth")

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database unavailable"})
		return
	}

	resp := networkStatusResponse{
		TopCountries: []string{},
		NodeScores:   []networkStatusNodeScore{},
	}

	db.DB.Model(&models.Node{}).Count(&resp.TotalNodes)
	db.DB.Model(&models.Node{}).Where("is_healthy = ?", true).Count(&resp.HealthyNodes)

	var avgLatency *float64
	db.DB.Model(&models.Node{}).
		Where("is_healthy = ? AND latency_ms > 0", true).
		Select("AVG(latency_ms)").
		Scan(&avgLatency)
	if avgLatency != nil {
		resp.AvgLatency = *avgLatency
	}

	type countryCount struct {
		CountryCode string
		Count       int64
	}
	var countries []countryCount
	db.DB.Model(&models.Node{}).
		Select("country_code, COUNT(*) AS count").
		Where("country_code <> ''").
		Group("country_code").
		Order("count DESC").
		Limit(5).
		Scan(&countries)
	for _, cc := range countries {
		resp.TopCountries = append(resp.TopCountries, cc.CountryCode)
	}

	var nodes []models.Node
	if err := db.DB.
		Select("id, country_code, region, quality_score").
		Where("is_healthy = ?", true).
		Order("quality_score DESC").
		Limit(20).
		Find(&nodes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load node scores"})
		return
	}
	for _, n := range nodes {
		resp.NodeScores = append(resp.NodeScores, networkStatusNodeScore{
			ID:      n.ID.String(),
			Country: n.CountryCode,
			Region:  n.Region,
			Score:   n.QualityScore,
		})
	}

	c.JSON(http.StatusOK, resp)
}
