package api

import (
	"database/sql"
	"net/http"
	"os"
	"strconv"
	"time"

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
	AvgLatency   *float64                 `json:"avg_latency"`
	TopCountries []string                 `json:"top_countries"`
	NodeScores   []networkStatusNodeScore `json:"node_scores"`
	// Freshness/coverage metadata (F12): when this snapshot was taken, how
	// recent a heartbeat must be to count as observed, when any node was
	// last actually seen, how many healthy-flagged nodes were seen inside
	// that window, and how many latency samples the average rests on.
	// avg_latency is null (not 0) when no node has reported latency.
	ObservedAt                   time.Time  `json:"observed_at"`
	StaleAfterSeconds            int64      `json:"stale_after_seconds"`
	LastObservedAt               *time.Time `json:"last_observed_at"`
	HealthyRecentlyObservedNodes int64      `json:"healthy_recently_observed_nodes"`
	LatencySampleSize            int64      `json:"latency_sample_size"`
}

// networkStaleAfter mirrors worker.providerNodeStaleAfter: same env var
// (PROVIDER_NODE_STALE_AFTER) and same 5-minute default, so the summary's
// "recently observed" window matches the heartbeat monitor's offline rule.
func networkStaleAfter() time.Duration {
	if raw := os.Getenv("PROVIDER_NODE_STALE_AFTER"); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil && d > 0 {
			return d
		}
		if mins, err := strconv.Atoi(raw); err == nil && mins > 0 {
			return time.Duration(mins) * time.Minute
		}
	}
	return 5 * time.Minute
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

	now := time.Now().UTC()
	staleAfter := networkStaleAfter()
	resp := networkStatusResponse{
		TopCountries:      []string{},
		NodeScores:        []networkStatusNodeScore{},
		ObservedAt:        now,
		StaleAfterSeconds: int64(staleAfter.Seconds()),
	}

	// Every aggregate is checked: a source failure must surface as an
	// error, never as credible-looking zeros (F12).
	fail := func(msg string) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": msg})
	}
	if err := db.DB.Model(&models.Node{}).Count(&resp.TotalNodes).Error; err != nil {
		fail("failed to count nodes")
		return
	}
	if err := db.DB.Model(&models.Node{}).Where("is_healthy = ?", true).
		Count(&resp.HealthyNodes).Error; err != nil {
		fail("failed to count healthy nodes")
		return
	}
	if err := db.DB.Model(&models.Node{}).
		Where("is_healthy = ? AND last_seen_at >= ?", true, now.Add(-staleAfter)).
		Count(&resp.HealthyRecentlyObservedNodes).Error; err != nil {
		fail("failed to count recently observed nodes")
		return
	}

	var lastObserved sql.NullTime
	if err := db.DB.Model(&models.Node{}).
		Where("last_seen_at > ?", time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)).
		Select("MAX(last_seen_at)").
		Scan(&lastObserved).Error; err != nil {
		fail("failed to load last observation time")
		return
	}
	if lastObserved.Valid {
		observed := lastObserved.Time.UTC()
		resp.LastObservedAt = &observed
	}

	if err := db.DB.Model(&models.Node{}).
		Where("is_healthy = ? AND latency_ms > 0", true).
		Count(&resp.LatencySampleSize).Error; err != nil {
		fail("failed to count latency samples")
		return
	}
	var avgLatency *float64
	if err := db.DB.Model(&models.Node{}).
		Where("is_healthy = ? AND latency_ms > 0", true).
		Select("AVG(latency_ms)").
		Scan(&avgLatency).Error; err != nil {
		fail("failed to load average latency")
		return
	}
	resp.AvgLatency = avgLatency

	type countryCount struct {
		CountryCode string
		Count       int64
	}
	var countries []countryCount
	if err := db.DB.Model(&models.Node{}).
		Select("country_code, COUNT(*) AS count").
		Where("country_code <> ''").
		Group("country_code").
		Order("count DESC").
		Limit(5).
		Scan(&countries).Error; err != nil {
		fail("failed to load country coverage")
		return
	}
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
