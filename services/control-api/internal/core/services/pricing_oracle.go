package services

import (
	"context"
	"strings"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/quality"
)

// PricingOracle provides intelligent price recommendations (USD per GB).
type PricingOracle struct{}

func NewPricingOracle() *PricingOracle {
	return &PricingOracle{}
}

// Absolute ceiling for seller-set listing prices (typo / abuse guard).
const ListingPriceHardCapUSD = 50.0

type PriceSuggestion struct {
	SuggestedPrice  float64 `json:"suggested_price"`
	MinMarketPrice  float64 `json:"min_market_price"`
	MaxMarketPrice  float64 `json:"max_market_price"`
	SoftCapPrice    float64 `json:"soft_cap_price"` // warn when seller exceeds
	HardCapPrice    float64 `json:"hard_cap_price"`
	Currency        string  `json:"currency"`
	ConfidenceScore float64 `json:"confidence_score"` // 0-1
}

// SuggestPrice calculates a recommended USD price per GB based on parameters.
// Bands are traffic-first: a bit under centralized mid-market (IPRoyal / Decodo / Bright
// entry), while staying above rock-bottom P2P floors so providers still earn.
func (o *PricingOracle) SuggestPrice(ctx context.Context, country string, proxyType string) (PriceSuggestion, error) {
	_ = ctx
	proxyType = strings.ToLower(strings.TrimSpace(proxyType))
	country = strings.ToUpper(strings.TrimSpace(country))

	// Type baselines (USD/GB) before light region multipliers.
	baseRate := quality.BaseResidential // residential — under IPRoyal ~$1.75 and Bright PAYG
	typeMin := 0.70
	typeMax := 1.75
	switch proxyType {
	case "mobile":
		baseRate = quality.BaseMobile // under typical $4–12 mobile
		typeMin = 2.50
		typeMax = 6.00
	case "datacenter":
		baseRate = quality.BaseDatacenter // under shared DC ~$0.40+/GB
		typeMin = 0.08
		typeMax = 0.35
	case "residential", "":
		baseRate = quality.BaseResidential
		typeMin = 0.70
		typeMax = 1.75
	}

	// Keep geo premium mild so premium geos stay cheap vs centrals.
	regionMultiplier := 1.0
	switch country {
	case "US", "GB", "DE", "FR", "JP", "CA", "AU", "NL", "SE", "CH":
		regionMultiplier = 1.05
	case "IN", "BR", "ID", "NG", "GH", "PH", "VN", "PK", "BD":
		regionMultiplier = 0.90
	}

	suggested := baseRate * regionMultiplier

	// Blend lightly with live averages; bias toward our undercut baseline (70/30)
	// so stale expensive listings cannot drag guidance back up.
	var avgPrice float64
	if db.DB != nil {
		q := db.DB.Model(&models.ProxyListing{}).
			Select("AVG(price_per_gb)").
			Where("proxy_type = ? AND status = ?", proxyType, models.ListingStatusActive)
		if country != "" {
			q = q.Where("country = ?", country)
		}
		_ = q.Scan(&avgPrice).Error
	}

	if avgPrice > 0 {
		if avgPrice > typeMax {
			avgPrice = typeMax
		}
		if avgPrice < typeMin*0.5 {
			avgPrice = typeMin
		}
		suggested = suggested*0.7 + avgPrice*0.3
	}

	if suggested < typeMin {
		suggested = typeMin
	}
	if suggested > typeMax {
		suggested = typeMax
	}

	minMarket := suggested * 0.80
	if minMarket < typeMin {
		minMarket = typeMin
	}
	maxMarket := suggested * 1.25
	if maxMarket > typeMax {
		maxMarket = typeMax
	}
	// Soft cap ~1.75× suggested so sellers get nudged before matching mid-market centrals.
	softCap := suggested * 1.75
	if softCap < typeMax {
		softCap = typeMax
	}

	return PriceSuggestion{
		SuggestedPrice:  roundPrice(suggested),
		MinMarketPrice:  roundPrice(minMarket),
		MaxMarketPrice:  roundPrice(maxMarket),
		SoftCapPrice:    roundPrice(softCap),
		HardCapPrice:    ListingPriceHardCapUSD,
		Currency:        "USD",
		ConfidenceScore: 0.9,
	}, nil
}

func roundPrice(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}

// ValidateListingPriceUSD returns a soft-cap warning message and whether the price is hard-rejected.
func ValidateListingPriceUSD(pricePerGB float64, country, proxyType string) (warn string, hardReject string) {
	if pricePerGB <= 0 {
		return "", "price_per_gb must be greater than 0"
	}
	if pricePerGB > ListingPriceHardCapUSD {
		return "", "price_per_gb exceeds the $50/GB hard limit"
	}
	suggestion, err := NewPricingOracle().SuggestPrice(context.Background(), country, proxyType)
	if err != nil {
		return "", ""
	}
	if pricePerGB > suggestion.SoftCapPrice {
		return "price_per_gb is above our traffic-first soft cap; lower rates attract more buyers", ""
	}
	return "", ""
}
