package billing

import (
	"context"
	"fmt"
	"math"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
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
	// ORACLE-002: Bounds-check the emergency price against the stale in-process
	// cache (if present). A ±20% deviation from the last seen live price indicates
	// the env var may be stale or manipulated — refuse it and return 0 so callers
	// circuit-break rather than transact at a bad price.
	emergency := getEmergencyFallback()
	if emergency <= 0 {
		logging.Warn().Msg("CRITICAL: All SOL price sources unavailable and EMERGENCY_SOL_PRICE_USD not set — returning 0 (callers must handle)")
		return 0
	}
	priceMu.RLock()
	staleCache := cachedSOLPrice
	priceMu.RUnlock()
	if staleCache > 0 {
		deviation := abs64(emergency-staleCache) / staleCache
		if deviation > 0.20 {
			logging.Warn().
				Float64("emergency_price", emergency).
				Float64("stale_cache", staleCache).
				Float64("deviation_pct", deviation*100).
				Msg("CRITICAL: Emergency SOL price deviates >20% from last in-process cached price — refusing emergency fallback, returning 0")
			return 0
		}
	}
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

const bytesPerGB = 1024 * 1024 * 1024

// solPriceNow resolves the live SOL/USD price. It is a variable so tests
// can simulate feed outages deterministically (same pattern as
// globalSendSOL).
var solPriceNow = GetSOLPriceUSD

// ErrSOLPriceUnavailable marks a settlement that cannot be priced. It is
// always retryable: metering data must be retained, never charged as 0.
var ErrSOLPriceUnavailable = fmt.Errorf("billing: SOL price unavailable")

// CostFromBytesUSD computes usage cost with lamports as money SoT (Sprint I / DB-02 lite).
// costUSD remains float for display/limits; costSOL is derived from rounded lamports.
func CostFromBytesUSD(totalBytes int64, pricePerGBUSD float64) (costLamports int64, costUSD, costSOL float64) {
	return CostFromBytesUSDAtSOLPrice(totalBytes, pricePerGBUSD, GetSOLPriceUSD())
}

// CostFromBytesUSDAtSOLPrice is CostFromBytesUSD with an explicit SOL/USD
// price (e.g. the consumption-time snapshot taken by the aggregator, P0-7).
// A non-positive solPrice yields zero lamports with a positive costUSD —
// callers must treat that combination as ErrSOLPriceUnavailable, not free.
func CostFromBytesUSDAtSOLPrice(totalBytes int64, pricePerGBUSD, solPrice float64) (costLamports int64, costUSD, costSOL float64) {
	if totalBytes <= 0 || pricePerGBUSD <= 0 {
		return 0, 0, 0
	}
	costUSD = float64(totalBytes) / float64(bytesPerGB) * pricePerGBUSD
	if solPrice <= 0 {
		return 0, costUSD, 0
	}
	numer := float64(totalBytes) * pricePerGBUSD * models.LamportsPerSOL
	denom := float64(bytesPerGB) * solPrice
	costLamports = int64(math.Round(numer / denom))
	if costLamports < 0 {
		costLamports = 0
	}
	costSOL = models.LamportsToSOL(uint64(costLamports))
	return
}
