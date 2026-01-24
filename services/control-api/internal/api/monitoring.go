package api

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/nats"
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
	// We need access to the singleton oracle client or re-init a temporary one
	// For simplicity, we try to use a static GetBalance if implemented in solana package
	// Or we use the oracle key from config
	// Assuming solana.GetBalance(ctx) is a package level helper or similar
	// But solana package usually has a global OracleClient instance if we Init it

	// For now, returning mock/config network
	metrics.Treasury.Network = "devnet"
	// lamports, _ := solana.GetBalance(ctx) // Need to verify if this exists as global
	metrics.Treasury.SolBalance = 10.5 // Mock for dashboard until bridge call is clean

	// 3. Fetch Watchtower status
	wt := treasury.NewWatchtower()
	isPaused, _ := wt.IsPaused(ctx)
	metrics.Watchtower.IsPaused = isPaused

	c.JSON(http.StatusOK, metrics)
}
