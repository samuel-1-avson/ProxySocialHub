package api

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/nats"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/treasury"
	"github.com/proxyhubb/control-api/internal/worker"
)

type OperationalMetrics struct {
	NATS struct {
		StreamName    string `json:"stream_name"`
		MessageCount  uint64 `json:"message_count"`
		ByteCount     uint64 `json:"byte_count"`
		ConsumerCount int    `json:"consumer_count"`
	} `json:"nats"`
	Treasury struct {
		SolBalance float64 `json:"sol_balance"`
		Network    string  `json:"network"`
	} `json:"treasury"`
	Watchtower struct {
		IsPaused bool `json:"is_paused"`
	} `json:"watchtower"`
	Timestamp time.Time `json:"timestamp"`
}

func RegisterMonitoringRoutes(r *gin.RouterGroup) {
	r.GET("/monitoring/operational", getOperationalMetrics)
	r.GET("/monitoring/alerts", getWatchtowerAlerts)
	r.GET("/monitoring/treasury", getTreasuryStats)
	
	// Admin-only treasury operations
	admin := r.Group("/admin/treasury")
	{
		admin.POST("/topup", triggerManualTopup)
		admin.GET("/thresholds", getTreasuryThresholds)
	}
}

func getOperationalMetrics(c *gin.Context) {
	metrics := OperationalMetrics{
		Timestamp: time.Now(),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 1. Fetch NATS Stats
	if info, err := nats.GetStreamInfo(ctx); err == nil {
		metrics.NATS.StreamName = info.Config.Name
		metrics.NATS.MessageCount = info.State.Msgs
		metrics.NATS.ByteCount = info.State.Bytes
		metrics.NATS.ConsumerCount = info.State.Consumers
	}

	// 2. Fetch Treasury Balance via Oracle Client (if available)
	if solana.IsOracleConfigured() {
		oracle := solana.GetOracle()
		metrics.Treasury.Network = oracle.GetNetwork()
		if balance, err := oracle.GetBalance(ctx, oracle.GetOraclePublicKey()); err == nil {
			metrics.Treasury.SolBalance = float64(balance) / 1e9
		}
	} else {
		metrics.Treasury.Network = "not configured"
		metrics.Treasury.SolBalance = 0
	}

	// 3. Fetch Watchtower status
	wt := treasury.NewWatchtower()
	isPaused, _ := wt.IsPaused(ctx)
	metrics.Watchtower.IsPaused = isPaused

	c.JSON(http.StatusOK, metrics)
}

func getWatchtowerAlerts(c *gin.Context) {
	// In production, this would query JetStream for the latest messages
	// in the "TELEMETRY" stream under "proxy.telemetry.v1.alerts"
	// For now, we return empty list to remain 'well connected' without fake noise.
	alerts := []treasury.AlertEvent{}

	c.JSON(http.StatusOK, alerts)
}

// getTreasuryStats returns current treasury status and balance information
func getTreasuryStats(c *gin.Context) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	tm := treasury.GetManager()
	stats, err := tm.GetTreasuryStats(ctx)
	if err != nil {
		logging.Error(err).Msg("Failed to get treasury stats")
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "Failed to retrieve treasury statistics",
			"details": err.Error(),
		})
		return
	}
	depth, oldestAge := worker.QueueDepthStats()
	stats.AttachQueueMetrics(depth, oldestAge)

	c.JSON(http.StatusOK, stats)
}

// getTreasuryThresholds returns the current threshold configuration
func getTreasuryThresholds(c *gin.Context) {
	tm := treasury.GetManager()
	thresholds := tm.GetThresholds()

	c.JSON(http.StatusOK, gin.H{
		"thresholds": thresholds,
		"network":    getNetworkFromThresholds(thresholds),
	})
}

// triggerManualTopup allows admin to manually trigger a treasury topup
func triggerManualTopup(c *gin.Context) {
	userRole, _ := c.Get("userRole")
	if userRole != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only admin can trigger topup"})
		return
	}

	var req struct {
		AmountSOL float64 `json:"amount_sol" binding:"required,gt=0"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	logging.Info().
		Float64("amount_sol", req.AmountSOL).
		Str("triggered_by", c.GetString("user_id")).
		Msg("Manual treasury topup triggered")

	// In production, this would initiate a transfer from reserve wallet
	// For now, we just log and return success
	c.JSON(http.StatusOK, gin.H{
		"status":     "initiated",
		"amount_sol": req.AmountSOL,
		"message":    "Topup request logged. Manual transfer required.",
	})
}

// getNetworkFromThresholds determines network based on threshold values
func getNetworkFromThresholds(thresholds treasury.TreasuryThresholds) string {
	if thresholds.MinSOLLamports >= 100*1_000_000_000 {
		return "mainnet-beta"
	}
	if thresholds.MinSOLLamports >= 5*1_000_000_000 {
		return "staging"
	}
	return "devnet"
}
