package billing

import (
	"context"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/pricing"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

const (
	priceCacheDuration    = 5 * time.Minute
	lastKnownGoodRedisKey = "pricing:sol:last_known_good"
	lastKnownGoodTTL      = 25 * time.Hour // Slightly over 24h so the key survives overnight
	sanityDeviationMax    = 0.30           // Reject prices deviating >30% from last known good
	hardcodedLastResort   = 0.0            // P0-20: removed stale $150 hardcoded price — callers must set EMERGENCY_SOL_PRICE_USD
)

var (
	cachedSOLPrice  float64
	cachedPriceTime time.Time
	priceMu         sync.RWMutex
)

// GetSOLPriceUSD returns the current SOL/USD price with a three-tier fallback:
//
//  1. Live price from CoinGecko / CoinMarketCap (cached 5 min in-process)
//  2. Last known good price persisted in Redis (up to 24 h old)
//  3. EMERGENCY_SOL_PRICE_USD env var (manually maintained)
//
// An alert is logged when falling back to tier 2 or 3.
func GetSOLPriceUSD() float64 {
	// --- Tier 1: in-process 5-minute cache ---
	priceMu.RLock()
	if cachedSOLPrice > 0 && time.Since(cachedPriceTime) < priceCacheDuration {
		p := cachedSOLPrice
		priceMu.RUnlock()
		return p
	}
	priceMu.RUnlock()

	// Fetch from live sources (multi-source with automatic failover)
	pf := pricing.GetPriceFeed()
	price, err := pf.GetSOLPriceUSD()
	if err == nil && price > 0 {
		// Sanity check: reject if the new price deviates >30% from last known good
		if lastKnown := getLastKnownGood(); lastKnown > 0 {
			deviation := abs64(price-lastKnown) / lastKnown
			if deviation > sanityDeviationMax {
				logging.Warn().
					Float64("fetched_price", price).
					Float64("last_known", lastKnown).
					Float64("deviation_pct", deviation*100).
					Msg("SOL price sanity check failed — price swing >30%, using last known good")
				return lastKnown
			}
		}

		// Good price — update both caches
		priceMu.Lock()
		cachedSOLPrice = price
		cachedPriceTime = time.Now()
		priceMu.Unlock()
		persistLastKnownGood(price)
		return price
	}

	logging.Warn().Err(err).Msg("SOL price fetch failed from all live sources")

	// --- Tier 2: Redis last known good (up to 24h old) ---
	if lastKnown := getLastKnownGood(); lastKnown > 0 {
		logging.Warn().
			Float64("cached_price", lastKnown).
			Msg("Using Redis-cached SOL price — live feeds unavailable")
		return lastKnown
	}

	// --- Tier 3: Emergency env var fallback ---
	emergency := getEmergencyFallback()
	logging.Warn().
		Float64("emergency_price", emergency).
		Msg("CRITICAL: All SOL price sources unavailable and no Redis cache — using EMERGENCY_SOL_PRICE_USD")
	return emergency
}

// getLastKnownGood fetches the last successfully fetched price from Redis.
func getLastKnownGood() float64 {
	if redisClient.Client == nil {
		return 0
	}
	ctx := context.Background()
	val, err := redisClient.Client.Get(ctx, lastKnownGoodRedisKey).Float64()
	if err != nil {
		return 0
	}
	return val
}

// persistLastKnownGood saves a good price to Redis with a 25h TTL.
func persistLastKnownGood(price float64) {
	if redisClient.Client == nil {
		return
	}
	ctx := context.Background()
	redisClient.Client.Set(ctx, lastKnownGoodRedisKey, price, lastKnownGoodTTL)
}

// getEmergencyFallback reads EMERGENCY_SOL_PRICE_USD from env, falling back to
// the hardcoded last-resort value if the env var is absent or invalid.
func getEmergencyFallback() float64 {
	if v := os.Getenv("EMERGENCY_SOL_PRICE_USD"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f > 0 {
			return f
		}
	}
	return hardcodedLastResort
}

func abs64(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

// USDToSOL converts a USD amount to SOL using the live price.
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
