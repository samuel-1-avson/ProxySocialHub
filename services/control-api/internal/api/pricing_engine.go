package api

import (
	"github.com/proxyhubb/control-api/internal/models"
)

// Base Prices (in TAO)
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
