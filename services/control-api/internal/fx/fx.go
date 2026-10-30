// Package fx converts USD to Ghana cedis for fiat checkout quotes.
//
// Tiers, like billing.GetSOLPriceUSD:
//  1. FX_USD_GHS_OVERRIDE (dev / emergency, used as-is)
//  2. Live rate from open.er-api.com (cached 10 min in-process)
//  3. Redis last-known-good (48 h)
//
// A live rate that moves more than 15% from the last-known-good is rejected.
// With no usable rate, USDToGHS returns an error: no rate, no quote.
package fx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/proxyhubb/control-api/internal/logging"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

const (
	cacheDuration      = 10 * time.Minute
	lastKnownGoodKey   = "fx:usd_ghs:last_known_good"
	lastKnownGoodTTL   = 48 * time.Hour
	sanityDeviationMax = 0.15
	// GHS has traded between roughly 5 and 20 per USD in recent years; anything
	// far outside that is a bad feed, not a market move.
	minPlausibleRate = 1.0
	maxPlausibleRate = 100.0
)

// ErrNoRate means no USD/GHS rate could be obtained.
var ErrNoRate = errors.New("fx: USD/GHS rate unavailable")

// SourceURL is the live rate endpoint; tests point it at an httptest server.
var SourceURL = "https://open.er-api.com/v6/latest/USD"

var (
	mu         sync.RWMutex
	cachedRate float64
	cachedAt   time.Time
	httpClient = &http.Client{Timeout: 8 * time.Second}
)

// USDToGHS returns how many cedis one US dollar buys.
func USDToGHS(ctx context.Context) (float64, error) {
	if v := strings.TrimSpace(os.Getenv("FX_USD_GHS_OVERRIDE")); v != "" {
		f, err := strconv.ParseFloat(v, 64)
		if err != nil || !plausible(f) {
			return 0, fmt.Errorf("fx: FX_USD_GHS_OVERRIDE %q is not a plausible rate", v)
		}
		return f, nil
	}

	mu.RLock()
	if cachedRate > 0 && time.Since(cachedAt) < cacheDuration {
		r := cachedRate
		mu.RUnlock()
		return r, nil
	}
	mu.RUnlock()

	live, err := fetchLive(ctx)
	lastKnown := getLastKnownGood(ctx)
	if err == nil {
		if lastKnown > 0 && math.Abs(live-lastKnown)/lastKnown > sanityDeviationMax {
			logging.Warn().Float64("live", live).Float64("last_known", lastKnown).
				Msg("fx: USD/GHS moved >15% from last known good; using last known good")
			return lastKnown, nil
		}
		mu.Lock()
		cachedRate, cachedAt = live, time.Now()
		mu.Unlock()
		persistLastKnownGood(ctx, live)
		return live, nil
	}

	logging.Warn().Err(err).Msg("fx: live USD/GHS fetch failed")
	if lastKnown > 0 {
		return lastKnown, nil
	}
	return 0, ErrNoRate
}

func plausible(r float64) bool { return r >= minPlausibleRate && r <= maxPlausibleRate }

func fetchLive(ctx context.Context) (float64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, SourceURL, nil)
	if err != nil {
		return 0, err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("fx: source returned HTTP %d", resp.StatusCode)
	}
	var body struct {
		Result string             `json:"result"`
		Rates  map[string]float64 `json:"rates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return 0, fmt.Errorf("fx: decode: %w", err)
	}
	rate := body.Rates["GHS"]
	if body.Result != "success" || !plausible(rate) {
		return 0, fmt.Errorf("fx: source gave no plausible GHS rate (result=%q rate=%v)", body.Result, rate)
	}
	return rate, nil
}

func getLastKnownGood(ctx context.Context) float64 {
	if redisClient.Client == nil {
		return 0
	}
	v, err := redisClient.Client.Get(ctx, lastKnownGoodKey).Float64()
	if err != nil || !plausible(v) {
		return 0
	}
	return v
}

func persistLastKnownGood(ctx context.Context, rate float64) {
	if redisClient.Client == nil {
		return
	}
	redisClient.Client.Set(ctx, lastKnownGoodKey, rate, lastKnownGoodTTL)
}

// resetCache clears the in-process cache (tests).
func resetCache() {
	mu.Lock()
	cachedRate, cachedAt = 0, time.Time{}
	mu.Unlock()
}
