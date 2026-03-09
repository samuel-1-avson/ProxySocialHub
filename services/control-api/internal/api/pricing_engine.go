package api

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/redis"
)

// Base Prices (in SOL)
const (
	BasePriceResidential = 0.50
	BasePriceMobile      = 0.80
	BasePriceDatacenter  = 0.20
)

// Multipliers
const (
	QualityMultiplierTopTier = 1.2 // > 95 score
	QualityMultiplierMidTier = 1.0 // 80-95 score
	QualityMultiplierLowTier = 0.8 // < 80 score
)

// AdjustDynamicPricing iterates over service configs and adjusts prices based on utilization
// This should be triggered by a Cron job every 15-60 minutes
func AdjustDynamicPricing() {
	var configs []models.ServiceConfiguration
	if err := db.DB.Where("dynamic_pricing_enabled = ? AND is_active = ?", true, true).Preload("Node").Find(&configs).Error; err != nil {
		logging.Error(err).Msg("Failed to fetch configs for dynamic pricing")
		return
	}

	logging.Info().Msgf("Adjusting pricing for %d configs", len(configs))

	for _, config := range configs {
		// Calculate current utilization
		// For MVP, we use Concurrent Connections relative to Max
		// Query actual utilization from Redis
		limit := float64(config.MaxConcurrentConnections)
		if limit <= 0 {
			limit = 100 // Default reference
		}

		// Get actual active connections from Redis
		currentUsage := getActiveConnections(config.NodeID)
		if currentUsage <= 0 {
			currentUsage = limit * 0.5 // Assume 50% if no data
		}

		utilization := currentUsage / limit
		target := config.TargetUtilization

		// Dampening factor
		step := config.AdjustmentStep
		if step <= 0 {
			step = 0.05
		}

		newMultiplier := config.PriceMultiplierHTTP // Base adjustment on HTTP multiplier

		if utilization > target+0.1 {
			// Overloaded -> Increase Price
			newMultiplier *= (1 + step)
		} else if utilization < target-0.1 {
			// Underloaded -> Decrease Price
			newMultiplier *= (1 - step)
		} else {
			continue // Within acceptable range
		}

		// Clamp
		minMult := config.MinPriceMultiplier
		if minMult <= 0 {
			minMult = 0.5
		}
		maxMult := config.MaxPriceMultiplier
		if maxMult <= 0 {
			maxMult = 3.0
		}

		newMultiplier = math.Max(minMult, math.Min(maxMult, newMultiplier))

		// Update if changed
		if newMultiplier != config.PriceMultiplierHTTP {
			db.DB.Model(&config).Updates(map[string]interface{}{
				"price_multiplier_http":  newMultiplier,
				"price_multiplier_https": newMultiplier, // Keep in sync
				"updated_at":             time.Now(),
			})
		}
	}
}

// CalculateFairPrice determines the price per GB based on proxy metrics
func CalculateFairPrice(listing models.ProxyListing) float64 {
	basePrice := 0.0
	switch listing.ProxyType {
	case models.ProxyTypeResidential:
		basePrice = BasePriceResidential
	case models.ProxyTypeMobile:
		basePrice = BasePriceMobile
	case models.ProxyTypeDatacenter:
		basePrice = BasePriceDatacenter
	default:
		basePrice = 0.10 // Fallback
	}

	// 1. Uptime Factor (0.0 - 1.0)
	// If uptime is below 50%, price drops drastically
	uptimeFactor := listing.UptimePercent / 100.0
	if uptimeFactor < 0.5 {
		uptimeFactor = 0.2
	}

	// 2. Quality Score Factor
	// Based on latency and success rate primarily
	qualityFactor := 1.0
	if listing.QualityScore >= 95 {
		qualityFactor = QualityMultiplierTopTier
	} else if listing.QualityScore >= 80 {
		qualityFactor = QualityMultiplierMidTier
	} else {
		qualityFactor = QualityMultiplierLowTier
	}

	// 3. Latency Penalty
	// > 1000ms latency reduces price
	if listing.AvgLatencyMs > 1000 {
		qualityFactor *= 0.8
	}

	finalPrice := basePrice * uptimeFactor * qualityFactor

	// Ensure strict minimum price
	if finalPrice < 0.01 {
		finalPrice = 0.01
	}

	return finalPrice
}

// getActiveConnections retrieves the current active connection count for a node from Redis
func getActiveConnections(nodeID uuid.UUID) float64 {
	if redis.Client == nil {
		return 0
	}
	
	ctx := context.Background()
	key := fmt.Sprintf("node:%s:active_connections", nodeID.String())
	
	val, err := redis.Client.Get(ctx, key).Float64()
	if err != nil {
		return 0
	}
	
	return val
}
