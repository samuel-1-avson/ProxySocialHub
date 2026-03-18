package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/pricing"
)

// RegisterPricingRoutes registers pricing-related routes
func RegisterPricingRoutes(r *gin.RouterGroup) {
	pricing := r.Group("/pricing")
	{
		pricing.GET("/sol", getSOLPrice)
		pricing.GET("/convert", convertPrice)
	}

	// Admin routes for monitoring
	admin := r.Group("/admin/pricing")
	{
		admin.GET("/sources", getPriceSources)
		admin.GET("/health", getPriceFeedHealth)
	}
}

// getSOLPrice returns the current SOL price in USD
func getSOLPrice(c *gin.Context) {
	pf := pricing.GetPriceFeed()
	price, err := pf.GetSOLPriceUSD()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "Failed to get price",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"currency_pair": "SOL/USD",
		"price":         price,
		"timestamp":     time.Now().UTC(),
	})
}

// convertPrice handles price conversions
func convertPrice(c *gin.Context) {
	from := c.Query("from")
	to := c.Query("to")
	amountStr := c.Query("amount")

	if from == "" || to == "" || amountStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Missing required parameters: from, to, amount",
		})
		return
	}

	var amount float64
	if _, err := parseFloat(amountStr, &amount); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid amount",
		})
		return
	}

	pf := pricing.GetPriceFeed()
	var result float64
	var err error

	// Handle SOL <-> USD conversions
	if from == "SOL" && to == "USD" {
		result, err = pf.ConvertSOLTUSD(amount)
	} else if from == "USD" && to == "SOL" {
		result, err = pf.ConvertUSDTOSOL(amount)
	} else {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Unsupported conversion pair. Only SOL<->USD supported.",
		})
		return
	}

	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "Conversion failed",
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"from":      from,
		"to":        to,
		"amount":    amount,
		"result":    result,
		"timestamp": time.Now().UTC(),
	})
}

// getPriceSources returns the status of all price sources
func getPriceSources(c *gin.Context) {
	pf := pricing.GetPriceFeed()
	metrics := pf.GetSourceMetrics()

	sources := make([]gin.H, 0, len(metrics))
	for name, stat := range metrics {
		sources = append(sources, gin.H{
			"name":            name,
			"healthy":         stat.IsHealthy,
			"success_count":   stat.SuccessCount,
			"failure_count":   stat.FailureCount,
			"last_success":    stat.LastSuccess,
			"last_failure":    stat.LastFailure,
			"avg_latency_ms":  stat.AvgLatencyMs,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"sources":   sources,
		"count":     len(sources),
		"timestamp": time.Now().UTC(),
	})
}

// getPriceFeedHealth returns overall health status
func getPriceFeedHealth(c *gin.Context) {
	pf := pricing.GetPriceFeed()
	metrics := pf.GetSourceMetrics()

	healthyCount := 0
	totalCount := len(metrics)

	for _, stat := range metrics {
		if stat.IsHealthy {
			healthyCount++
		}
	}

	status := "healthy"
	if healthyCount == 0 {
		status = "critical"
	} else if healthyCount < totalCount {
		status = "degraded"
	}

	// Test current price fetch
	start := time.Now()
	price, err := pf.GetSOLPriceUSD()
	latency := time.Since(start)

	c.JSON(http.StatusOK, gin.H{
		"status":         status,
		"healthy_sources": healthyCount,
		"total_sources":  totalCount,
		"current_price":  price,
		"price_error":    err != nil,
		"fetch_latency_ms": latency.Milliseconds(),
		"timestamp":      time.Now().UTC(),
	})
}

func parseFloat(s string, v *float64) (int, error) {
	var n int
	_, err := fmt.Sscanf(s, "%f", v)
	if err == nil {
		n = len(s)
	}
	return n, err
}
