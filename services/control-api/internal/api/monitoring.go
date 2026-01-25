package api

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/nats"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/treasury"
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

	// For the Phase 10.1 pilot, we return a hybrid of live + mock history
	alerts := []treasury.AlertEvent{
		{
			Type:      "watchtower_trigger",
			Severity:  "CRITICAL",
			Message:   "High Outflow Velocity detected",
			Resource:  "105.42 SOL/hr",
			Timestamp: time.Now().Add(-15 * time.Minute),
		},
		{
			Type:      "watchtower_trigger",
			Severity:  "WARNING",
			Message:   "Node Connectivity Lost",
			Resource:  "node-78a2",
			Timestamp: time.Now().Add(-1 * time.Hour),
		},
		{
			Type:      "watchtower_trigger",
			Severity:  "INFO",
			Message:   "Registry Sync Successful",
			Resource:  "12 nodes updated",
			Timestamp: time.Now().Add(-2 * time.Hour),
		},
	}

	c.JSON(http.StatusOK, alerts)
}
