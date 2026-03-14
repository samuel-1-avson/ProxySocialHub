package billing

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/proxyhubb/control-api/internal/logging"
)

var (
	cachedSOLPrice     float64
	cachedPriceTime    time.Time
	priceMu            sync.RWMutex
	priceCacheDuration = 5 * time.Minute
)

// GetSOLPriceUSD returns the current SOL/USD price, cached for 5 minutes.
// Falls back to 150.0 if the fetch fails and no cached value exists.
func GetSOLPriceUSD() float64 {
	priceMu.RLock()
	if cachedSOLPrice > 0 && time.Since(cachedPriceTime) < priceCacheDuration {
		p := cachedSOLPrice
		priceMu.RUnlock()
		return p
	}
	priceMu.RUnlock()

	price, err := fetchSOLPriceFromCoinGecko()
	if err != nil {
		logging.Warn().Err(err).Msg("SOL price fetch failed, using cached or fallback")
		priceMu.RLock()
		if cachedSOLPrice > 0 {
			p := cachedSOLPrice
			priceMu.RUnlock()
			return p
		}
		priceMu.RUnlock()
		return 150.0 // conservative devnet fallback
	}

	priceMu.Lock()
	cachedSOLPrice = price
	cachedPriceTime = time.Now()
	priceMu.Unlock()

	return price
}

func fetchSOLPriceFromCoinGecko() (float64, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd")
	if err != nil {
		return 0, fmt.Errorf("coingecko request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("coingecko status %d", resp.StatusCode)
	}

	var result map[string]map[string]float64
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, fmt.Errorf("coingecko parse: %w", err)
	}

	price, ok := result["solana"]["usd"]
	if !ok || price <= 0 {
		return 0, fmt.Errorf("invalid price data")
	}

	logging.Info().Float64("sol_usd", price).Msg("SOL price refreshed from CoinGecko")
	return price, nil
}

// USDToSOL converts a USDT/USD amount to SOL using the live price.
func USDToSOL(usd float64) float64 {
	price := GetSOLPriceUSD()
	if price <= 0 {
		return 0
	}
	return usd / price
}

// SOLToUSD converts a SOL amount to USD using the live price.
func SOLToUSD(sol float64) float64 {
	return sol * GetSOLPriceUSD()
}
