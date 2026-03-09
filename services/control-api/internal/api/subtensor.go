package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/reputation"
)

// ReportMetricsRequest is sent by the Edge Gateway to report provider performance
type ReportMetricsRequest struct {
	ProviderID       string  `json:"provider_id" binding:"required"`
	NodeID           string  `json:"node_id" binding:"required"`
	UptimePercentage float64 `json:"uptime_percentage" binding:"required"`
	AvgLatencyMs     int     `json:"avg_latency_ms" binding:"required"`
	TotalBytesServed int64   `json:"total_bytes_served" binding:"required"`
	TotalRequests    int64   `json:"total_requests" binding:"required"`
	SuccessRate      float64 `json:"success_rate" binding:"required"`
	UniqueIPsServed  int     `json:"unique_ips_served"`
	GeoDiversity     float64 `json:"geo_diversity"`
	PeriodStart      int64   `json:"period_start" binding:"required"` // Unix timestamp
	PeriodEnd        int64   `json:"period_end" binding:"required"`   // Unix timestamp
}

// RegisterSubtensorRoutes registers all Subtensor/incentivization routes
func RegisterSubtensorRoutes(r *gin.RouterGroup) {
	r.POST("/metrics/report", reportMetrics)
	r.GET("/metrics/provider/:provider_id", getProviderMetrics)
	r.GET("/metrics/leaderboard", getMetricsLeaderboard)
	r.POST("/weights/submit", submitWeights)
}

// reportMetrics handles metrics reporting from Edge Gateway
func reportMetrics(c *gin.Context) {
	var req ReportMetricsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	providerID, err := uuid.Parse(req.ProviderID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid provider_id"})
		return
	}

	nodeID, err := uuid.Parse(req.NodeID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node_id"})
		return
	}

	proof := models.ProofOfService{
		ProviderID:       providerID,
		NodeID:           nodeID,
		UptimePercentage: req.UptimePercentage,
		AvgLatencyMs:     req.AvgLatencyMs,
		TotalBytesServed: req.TotalBytesServed,
		TotalRequests:    req.TotalRequests,
		SuccessRate:      req.SuccessRate,
		UniqueIPsServed:  req.UniqueIPsServed,
		GeoDiversity:     req.GeoDiversity,
		PeriodStart:      time.Unix(req.PeriodStart, 0),
		PeriodEnd:        time.Unix(req.PeriodEnd, 0),
	}

	// Calculate quality score
	proof.CalculateQualityScore()

	if err := db.DB.Create(&proof).Error; err != nil {
		logging.Error(err).Msg("Failed to save proof of service")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save metrics"})
		return
	}

	// Update provider node's quality score
	db.DB.Model(&models.ProviderNode{}).Where("id = ?", nodeID).Update("quality_score", proof.QualityScore)

	// Update Reputation / Awards
	go reputation.CheckAndAwardBadges(providerID)

	logging.Info().
		Str("provider_id", req.ProviderID).
		Str("node_id", req.NodeID).
		Float64("quality_score", proof.QualityScore).
		Msg("Proof of service recorded")

	c.JSON(http.StatusOK, gin.H{
		"status":        "success",
		"proof_id":      proof.ID,
		"quality_score": proof.QualityScore,
	})
}

// getProviderMetrics returns metrics history for a provider
func getProviderMetrics(c *gin.Context) {
	providerID := c.Param("provider_id")

	var proofs []models.ProofOfService
	if err := db.DB.Where("provider_id = ?", providerID).
		Order("created_at DESC").
		Limit(100).
		Find(&proofs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch metrics"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"metrics": proofs})
}

// LeaderboardEntry represents a provider's ranking
type LeaderboardEntry struct {
	ProviderID   string  `json:"provider_id"`
	NodeID       string  `json:"node_id"`
	QualityScore float64 `json:"quality_score"`
	TotalBytes   int64   `json:"total_bytes_served"`
	AvgUptime    float64 `json:"avg_uptime"`
	Rank         int     `json:"rank"`
}

// getMetricsLeaderboard returns top providers by quality score
func getMetricsLeaderboard(c *gin.Context) {
	var results []struct {
		ProviderID uuid.UUID
		NodeID     uuid.UUID
		AvgScore   float64
		TotalBytes int64
		AvgUptime  float64
	}

	// Aggregate latest metrics per provider
	db.DB.Model(&models.ProofOfService{}).
		Select(`
			provider_id, 
			node_id,
			AVG(quality_score) as avg_score, 
			SUM(total_bytes_served) as total_bytes,
			AVG(uptime_percentage) as avg_uptime
		`).
		Where("created_at > ?", time.Now().AddDate(0, 0, -7)). // Last 7 days
		Group("provider_id, node_id").
		Order("avg_score DESC").
		Limit(50).
		Find(&results)

	leaderboard := make([]LeaderboardEntry, len(results))
	for i, r := range results {
		leaderboard[i] = LeaderboardEntry{
			ProviderID:   r.ProviderID.String(),
			NodeID:       r.NodeID.String(),
			QualityScore: r.AvgScore,
			TotalBytes:   r.TotalBytes,
			AvgUptime:    r.AvgUptime,
			Rank:         i + 1,
		}
	}

	c.JSON(http.StatusOK, gin.H{"leaderboard": leaderboard})
}

// SubmitWeightsRequest is sent by validators to submit miner weights
type SubmitWeightsRequest struct {
	ValidatorID string             `json:"validator_id" binding:"required"`
	NetUID      int                `json:"net_uid" binding:"required"`
	EpochNumber int                `json:"epoch_number" binding:"required"`
	Weights     map[string]float64 `json:"weights" binding:"required"` // miner_id -> weight
}

// submitWeights handles weight submission from validators
func submitWeights(c *gin.Context) {
	var req SubmitWeightsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	validatorID, err := uuid.Parse(req.ValidatorID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid validator_id"})
		return
	}

	// Store weights
	for minerIDStr, weight := range req.Weights {
		minerID, err := uuid.Parse(minerIDStr)
		if err != nil {
			continue
		}

		mw := models.MinerWeight{
			ValidatorID: validatorID,
			MinerID:     minerID,
			Weight:      weight,
		}

		// Upsert: update if exists, create if not
		db.DB.Where("validator_id = ? AND miner_id = ?", validatorID, minerID).
			Assign(mw).
			FirstOrCreate(&mw)
	}

	logging.Info().
		Str("validator_id", req.ValidatorID).
		Int("net_uid", req.NetUID).
		Int("epoch", req.EpochNumber).
		Int("num_weights", len(req.Weights)).
		Msg("Weights submitted")

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Weights recorded",
	})
}
