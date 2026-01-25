package services

import (
	"context"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// PricingOracle provides intelligent price recommendations
type PricingOracle struct{}

func NewPricingOracle() *PricingOracle {
	return &PricingOracle{}
}

type PriceSuggestion struct {
	SuggestedPrice  float64 `json:"suggested_price"`
	MinMarketPrice  float64 `json:"min_market_price"`
	MaxMarketPrice  float64 `json:"max_market_price"`
	ConfidenceScore float64 `json:"confidence_score"` // 0-1
}

// SuggestPrice calculates a recommended price per GB based on parameters
func (o *PricingOracle) SuggestPrice(ctx context.Context, country string, proxyType string) (PriceSuggestion, error) {
	// Base rate in USD (equivalent)
	baseRate := 0.50 // $0.50 per GB baseline

	// 1. Apply Region Multipliers
	regionMultiplier := 1.0
	switch country {
	case "US", "GB", "DE", "FR", "JP":
		regionMultiplier = 1.5 // Premium regions
	case "IN", "BR", "ID":
		regionMultiplier = 0.8 // Lower cost regions
	}

	// 2. Apply Proxy Type Multipliers
	typeMultiplier := 1.0
	switch proxyType {
	case "residential":
		typeMultiplier = 2.0 // Most expensive
	case "mobile":
		typeMultiplier = 3.0 // High scarcity
	case "datacenter":
		typeMultiplier = 0.5 // Bulk capacity
	}

	suggested := baseRate * regionMultiplier * typeMultiplier

	// 3. Fetch Real Market Data from DB for refinement
	var avgPrice float64
	db.DB.Model(&models.ProxyListing{}).
		Where("country = ? AND proxy_type = ? AND is_active = ?", country, proxyType, true).
		Select("AVG(price_per_gb)").
		Scan(&avgPrice)

	if avgPrice > 0 {
		// Blend the algorithm with actual market data (weighted 50/50)
		suggested = (suggested + avgPrice) / 2
	}

	return PriceSuggestion{
		SuggestedPrice:  suggested,
		MinMarketPrice:  suggested * 0.8,
		MaxMarketPrice:  suggested * 1.5,
		ConfidenceScore: 0.85,
	}, nil
}
