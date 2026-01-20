package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/proxyhubb/control-api/internal/logging"
)

// PriceCache to avoid hitting rate limits
type PriceCache struct {
	Rate      float64
	LastFetch time.Time
	Mutex     sync.RWMutex
}

var globalPriceCache = PriceCache{
	Rate: 6750.0, // Fallback default
}

const (
	CACHE_DURATION     = 1 * time.Minute // Update every minute
	COINGECKO_API_URL  = "https://api.coingecko.com/api/v3/simple/price?ids=bittensor&vs_currencies=usd"
	FIXED_GHS_USD_RATE = 15.5 // GHS is relatively stable, can be updated less frequently or fetched
)

type CoinGeckoResponse struct {
	Bittensor struct {
		USD float64 `json:"usd"`
	} `json:"bittensor"`
}

// GetTaoToGhsRate returns the current exchange rate: How many GHS for 1 TAO
func GetTaoToGhsRate() float64 {
	globalPriceCache.Mutex.RLock()
	// If cache is valid (less than 1 min old), return it
	if time.Since(globalPriceCache.LastFetch) < CACHE_DURATION && globalPriceCache.Rate > 0 {
		defer globalPriceCache.Mutex.RUnlock()
		return globalPriceCache.Rate
	}
	globalPriceCache.Mutex.RUnlock()

	// Cache expired or empty, fetch new price
	newRate, err := fetchPriceFromAPI()
	if err != nil {
		logging.Error(err).Msg("Failed to fetch real-time price, using fallback")
		return globalPriceCache.Rate // Return last known good rate
	}

	// Update Cache
	globalPriceCache.Mutex.Lock()
	globalPriceCache.Rate = newRate
	globalPriceCache.LastFetch = time.Now()
	globalPriceCache.Mutex.Unlock()

	return newRate
}

func fetchPriceFromAPI() (float64, error) {
	client := http.Client{
		Timeout: 5 * time.Second,
	}

	resp, err := client.Get(COINGECKO_API_URL)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("API returned non-200 status: %d", resp.StatusCode)
	}

	var data CoinGeckoResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return 0, err
	}

	taoUsd := data.Bittensor.USD
	if taoUsd == 0 {
		return 0, fmt.Errorf("Invalid price data returned")
	}

	// Calculate TAO -> GHS
	// 1 TAO = $X USD
	// $1 USD = $Y GHS
	// 1 TAO = X * Y GHS
	rate := taoUsd * FIXED_GHS_USD_RATE

	logging.Info().Float64("tao_usd", taoUsd).Float64("ghs_rate", rate).Msg("Updated Real-Time Exchange Rate")
	return rate, nil
}
