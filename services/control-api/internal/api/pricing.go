package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
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
	COINGECKO_API_URL  = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
	FIXED_GHS_USD_RATE = 15.5 // GHS is relatively stable, can be updated less frequently or fetched
)

type CoinGeckoResponse struct {
	Solana struct {
		USD float64 `json:"usd"`
	} `json:"solana"`
}

// GetSolToGhsRate returns the current exchange rate: How many GHS for 1 SOL
func GetSolToGhsRate() float64 {
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

var oracleClient = &http.Client{
	Timeout: 10 * time.Second,
}

func fetchPriceFromAPI() (float64, error) {
	// 1. Try CoinGecko
	rate, err := fetchCoinGecko()
	if err == nil {
		return rate, nil
	}
	logging.Warn().Err(err).Msg("CoinGecko failed, trying fallback...")

	// 2. Try Fallback (Binance or others - placeholder for now)
	// return fetchBinance()

	return 0, err
}

func fetchCoinGecko() (float64, error) {
	apiKey := os.Getenv("COINGECKO_API_KEY")
	url := COINGECKO_API_URL

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return 0, err
	}

	if apiKey != "" {
		req.Header.Set("x-cg-demo-api-key", apiKey)
	}

	resp, err := oracleClient.Do(req)
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

	solUsd := data.Solana.USD
	if solUsd == 0 {
		return 0, fmt.Errorf("Invalid price data returned")
	}

	ghsRate := getGhsUsdRate()
	rate := solUsd * ghsRate

	logging.Info().Float64("sol_usd", solUsd).Float64("ghs_rate", rate).Msg("Updated Exchange Rate via CoinGecko")
	return rate, nil
}

func getGhsUsdRate() float64 {
	val := os.Getenv("EXCHANGE_RATE_GHS_USD")
	if val != "" {
		if rate, err := strconv.ParseFloat(val, 64); err == nil && rate > 0 {
			return rate
		}
		logging.Warn().Str("val", val).Msg("Invalid EXCHANGE_RATE_GHS_USD env var, using default")
	}
	return FIXED_GHS_USD_RATE
}
