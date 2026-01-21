package prices

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/proxyhubb/control-api/internal/logging"
)

// CoinGecko free API (no key required for basic usage)
const coinGeckoAPI = "https://api.coingecko.com/api/v3"

// PriceCache holds cached price data
type PriceCache struct {
	prices    map[string]float64
	lastFetch time.Time
	mu        sync.RWMutex
	ttl       time.Duration
}

var (
	cache = &PriceCache{
		prices: make(map[string]float64),
		ttl:    5 * time.Minute, // Cache for 5 minutes
	}
)

// CoinGeckoPriceResponse represents the API response
type coinGeckoPriceResponse map[string]map[string]float64

// GetPrice fetches the price of a token in USD
func GetPrice(ctx context.Context, tokenID string) (float64, error) {
	// Check cache first
	cache.mu.RLock()
	if price, ok := cache.prices[tokenID]; ok && time.Since(cache.lastFetch) < cache.ttl {
		cache.mu.RUnlock()
		return price, nil
	}
	cache.mu.RUnlock()

	// Fetch fresh prices
	return fetchAndCachePrice(ctx, tokenID)
}

func fetchAndCachePrice(ctx context.Context, tokenID string) (float64, error) {
	cache.mu.Lock()
	defer cache.mu.Unlock()

	// Double-check after acquiring lock
	if price, ok := cache.prices[tokenID]; ok && time.Since(cache.lastFetch) < cache.ttl {
		return price, nil
	}

	url := fmt.Sprintf("%s/simple/price?ids=%s&vs_currencies=usd", coinGeckoAPI, tokenID)

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return 0, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("CoinGecko request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("CoinGecko returned status %d", resp.StatusCode)
	}

	var priceResp coinGeckoPriceResponse
	if err := json.NewDecoder(resp.Body).Decode(&priceResp); err != nil {
		return 0, fmt.Errorf("failed to decode response: %w", err)
	}

	tokenData, ok := priceResp[tokenID]
	if !ok {
		return 0, fmt.Errorf("token %s not found in response", tokenID)
	}

	price, ok := tokenData["usd"]
	if !ok {
		return 0, fmt.Errorf("USD price not found for %s", tokenID)
	}

	// Cache the price
	cache.prices[tokenID] = price
	cache.lastFetch = time.Now()

	logging.Info().
		Str("token", tokenID).
		Float64("price_usd", price).
		Msg("Fetched price from CoinGecko")

	return price, nil
}

// Token IDs for CoinGecko
const (
	TokenSolana    = "solana"
	TokenBittensor = "bittensor"
)

// GetSOLPrice returns the current SOL price in USD
func GetSOLPrice(ctx context.Context) (float64, error) {
	return GetPrice(ctx, TokenSolana)
}

// GetTAOPrice returns the current TAO price in USD
func GetTAOPrice(ctx context.Context) (float64, error) {
	return GetPrice(ctx, TokenBittensor)
}

// GetExchangeRate calculates the exchange rate between two tokens
// Returns how many of targetToken you get for 1 sourceToken
func GetExchangeRate(ctx context.Context, sourceToken, targetToken string) (float64, error) {
	sourcePrice, err := GetPrice(ctx, sourceToken)
	if err != nil {
		return 0, fmt.Errorf("failed to get %s price: %w", sourceToken, err)
	}

	targetPrice, err := GetPrice(ctx, targetToken)
	if err != nil {
		return 0, fmt.Errorf("failed to get %s price: %w", targetToken, err)
	}

	if targetPrice == 0 {
		return 0, fmt.Errorf("target token price is zero")
	}

	return sourcePrice / targetPrice, nil
}

// GetSOLToTAORate returns how many TAO you get for 1 SOL
func GetSOLToTAORate(ctx context.Context) (float64, error) {
	return GetExchangeRate(ctx, TokenSolana, TokenBittensor)
}

// ConvertSOLToTAO converts a SOL amount to TAO
func ConvertSOLToTAO(ctx context.Context, solAmount float64) (float64, error) {
	rate, err := GetSOLToTAORate(ctx)
	if err != nil {
		return 0, err
	}
	return solAmount * rate, nil
}

// GetAllPrices fetches multiple token prices at once
func GetAllPrices(ctx context.Context) (map[string]float64, error) {
	url := fmt.Sprintf("%s/simple/price?ids=solana,bittensor&vs_currencies=usd", coinGeckoAPI)

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var priceResp coinGeckoPriceResponse
	if err := json.NewDecoder(resp.Body).Decode(&priceResp); err != nil {
		return nil, err
	}

	result := make(map[string]float64)
	for token, data := range priceResp {
		if price, ok := data["usd"]; ok {
			result[token] = price
		}
	}

	// Update cache
	cache.mu.Lock()
	for token, price := range result {
		cache.prices[token] = price
	}
	cache.lastFetch = time.Now()
	cache.mu.Unlock()

	return result, nil
}
