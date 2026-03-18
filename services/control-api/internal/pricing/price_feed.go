// Package pricing provides real-time cryptocurrency price feeds
// Multi-source implementation with automatic failover for resilience
package pricing

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/proxyhubb/control-api/internal/logging"
)

// PriceFeed provides real-time exchange rates for supported currencies
type PriceFeed struct {
	client      *http.Client
	sources     []PriceSource
	cache       *PriceCache
	mu          sync.RWMutex
	subscribers []chan PriceUpdate
	metrics     *SourceMetrics
}

// PriceSource represents a single price feed source
type PriceSource struct {
	Name        string
	Priority    int           // Lower = higher priority (1 = primary)
	Timeout     time.Duration
	Enabled     bool
	LastSuccess time.Time
	LastFailure time.Time
	FailCount   int
	client      *http.Client
}

// PriceCache stores cached prices with TTL
type PriceCache struct {
	prices      map[string]float64
	lastUpdated time.Time
	ttl         time.Duration
	mu          sync.RWMutex
}

// PriceUpdate represents a price change notification
type PriceUpdate struct {
	CurrencyPair string    `json:"currency_pair"`
	Price        float64   `json:"price"`
	Source       string    `json:"source"`
	Timestamp    time.Time `json:"timestamp"`
}

// SourceMetrics tracks health of price sources
type SourceMetrics struct {
	mu          sync.RWMutex
	sourceStats map[string]*SourceStat
}

// SourceStat tracks individual source performance
type SourceStat struct {
	Name           string
	SuccessCount   int64
	FailureCount   int64
	LastSuccess    time.Time
	LastFailure    time.Time
	AvgLatencyMs   float64
	IsHealthy      bool
}

// Supported currency pairs - SOL only
const (
	SOLUSD = "SOL/USD"
)

// Default exchange rates as fallback (DevNet only)
// These should NOT be used in production
var defaultRates = map[string]float64{
	SOLUSD: 200.0, // Approximate SOL price (fallback only)
}

// Source configurations
const (
	// Maximum failures before marking source as unhealthy
	maxSourceFailures = 3
	// Time before a failed source can be retried
	sourceRetryDelay = 5 * time.Minute
	// Maximum sources to try per request
	maxSourceAttempts = 3
)

// NewPriceFeed creates a new price feed service with multiple sources
func NewPriceFeed() *PriceFeed {
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	pf := &PriceFeed{
		client: client,
		sources: []PriceSource{
			{
				Name:     "coingecko",
				Priority: 1,
				Timeout:  10 * time.Second,
				Enabled:  true,
				client:   client,
			},
			{
				Name:     "binance",
				Priority: 2,
				Timeout:  10 * time.Second,
				Enabled:  true,
				client:   client,
			},
			{
				Name:     "coinmarketcap",
				Priority: 3,
				Timeout:  10 * time.Second,
				Enabled:  os.Getenv("COINMARKETCAP_API_KEY") != "",
				client:   client,
			},
		},
		cache: &PriceCache{
			prices:      make(map[string]float64),
			ttl:         5 * time.Minute,
			lastUpdated: time.Time{},
		},
		subscribers: make([]chan PriceUpdate, 0),
		metrics: &SourceMetrics{
			sourceStats: make(map[string]*SourceStat),
		},
	}

	// Initialize source stats
	for _, src := range pf.sources {
		pf.metrics.sourceStats[src.Name] = &SourceStat{
			Name:      src.Name,
			IsHealthy: true,
		}
	}

	return pf
}

// GetPrice returns the current price for a currency pair
// Tries multiple sources with automatic failover
func (pf *PriceFeed) GetPrice(currencyPair string) (float64, error) {
	// Check cache first
	if price, ok := pf.cache.Get(currencyPair); ok {
		return price, nil
	}

	// Try sources in priority order
	var lastErr error
	attempts := 0

	for _, source := range pf.getSourcesByPriority() {
		if !source.Enabled || !pf.isSourceHealthy(source.Name) {
			continue
		}

		if attempts >= maxSourceAttempts {
			break
		}
		attempts++

		price, err := pf.fetchFromSource(source, currencyPair)
		if err == nil {
			pf.recordSuccess(source.Name)
			pf.cache.Update(map[string]float64{currencyPair: price})
			return price, nil
		}

		lastErr = err
		pf.recordFailure(source.Name, err)
		logging.Warn().
			Str("source", source.Name).
			Err(err).
			Msg("Price source failed, trying next")
	}

	// All sources failed, try fallback
	logging.Error(lastErr).Msg("All price sources failed, using fallback")
	if rate, ok := defaultRates[currencyPair]; ok {
		return rate, nil
	}

	return 0, fmt.Errorf("no price available for %s: %w", currencyPair, lastErr)
}

// GetSOLPriceUSD returns the current SOL price in USD
func (pf *PriceFeed) GetSOLPriceUSD() (float64, error) {
	return pf.GetPrice(SOLUSD)
}

// ConvertUSDTOSOL converts USD amount to SOL
func (pf *PriceFeed) ConvertUSDTOSOL(usdAmount float64) (float64, error) {
	solPrice, err := pf.GetSOLPriceUSD()
	if err != nil {
		return 0, err
	}
	return usdAmount / solPrice, nil
}

// ConvertSOLToUSD converts SOL amount to USD
func (pf *PriceFeed) ConvertSOLToUSD(solAmount float64) (float64, error) {
	solPrice, err := pf.GetSOLPriceUSD()
	if err != nil {
		return 0, err
	}
	return solAmount * solPrice, nil
}

// fetchFromSource fetches price from a specific source
func (pf *PriceFeed) fetchFromSource(source PriceSource, currencyPair string) (float64, error) {
	switch source.Name {
	case "coingecko":
		return pf.fetchFromCoinGecko(source)
	case "binance":
		return pf.fetchFromBinance(source)
	case "coinmarketcap":
		return pf.fetchFromCoinMarketCap(source)
	default:
		return 0, fmt.Errorf("unknown source: %s", source.Name)
	}
}

// fetchFromCoinGecko fetches prices from CoinGecko API
func (pf *PriceFeed) fetchFromCoinGecko(source PriceSource) (float64, error) {
	baseURL := os.Getenv("COINGECKO_API_URL")
	if baseURL == "" {
		baseURL = "https://api.coingecko.com/api/v3"
	}
	url := fmt.Sprintf("%s/simple/price?ids=solana&vs_currencies=usd", baseURL)

	ctx, cancel := context.WithTimeout(context.Background(), source.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return 0, err
	}

	if apiKey := os.Getenv("COINGECKO_API_KEY"); apiKey != "" {
		req.Header.Add("x-cg-pro-api-key", apiKey)
	}

	start := time.Now()
	resp, err := source.client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var data map[string]map[string]float64
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return 0, fmt.Errorf("failed to decode response: %w", err)
	}

	// Update latency metrics
	pf.updateLatencyMetrics(source.Name, time.Since(start))

	if solData, ok := data["solana"]; ok {
		if usdPrice, ok := solData["usd"]; ok {
			return usdPrice, nil
		}
	}

	return 0, fmt.Errorf("SOL price not found in response")
}

// fetchFromBinance fetches prices from Binance API
func (pf *PriceFeed) fetchFromBinance(source PriceSource) (float64, error) {
	url := "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT"

	ctx, cancel := context.WithTimeout(context.Background(), source.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return 0, err
	}

	start := time.Now()
	resp, err := source.client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var data struct {
		Symbol string `json:"symbol"`
		Price  string `json:"price"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return 0, fmt.Errorf("failed to decode response: %w", err)
	}

	pf.updateLatencyMetrics(source.Name, time.Since(start))

	var price float64
	if _, err := fmt.Sscanf(data.Price, "%f", &price); err != nil {
		return 0, fmt.Errorf("failed to parse price: %w", err)
	}

	return price, nil
}

// fetchFromCoinMarketCap fetches prices from CoinMarketCap API
func (pf *PriceFeed) fetchFromCoinMarketCap(source PriceSource) (float64, error) {
	apiKey := os.Getenv("COINMARKETCAP_API_KEY")
	if apiKey == "" {
		return 0, fmt.Errorf("COINMARKETCAP_API_KEY not set")
	}

	url := "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?id=5426" // 5426 = SOL

	ctx, cancel := context.WithTimeout(context.Background(), source.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return 0, err
	}

	req.Header.Add("X-CMC_PRO_API_KEY", apiKey)
	req.Header.Add("Accept", "application/json")

	start := time.Now()
	resp, err := source.client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var data struct {
		Data map[string]struct {
			Quote struct {
				USD struct {
					Price float64 `json:"price"`
				} `json:"USD"`
			} `json:"quote"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return 0, fmt.Errorf("failed to decode response: %w", err)
	}

	pf.updateLatencyMetrics(source.Name, time.Since(start))

	if solData, ok := data.Data["5426"]; ok {
		return solData.Quote.USD.Price, nil
	}

	return 0, fmt.Errorf("SOL price not found in response")
}

// getSourcesByPriority returns enabled sources sorted by priority
func (pf *PriceFeed) getSourcesByPriority() []PriceSource {
	var sources []PriceSource
	for _, src := range pf.sources {
		if src.Enabled {
			sources = append(sources, src)
		}
	}

	// Simple bubble sort by priority
	for i := 0; i < len(sources); i++ {
		for j := i + 1; j < len(sources); j++ {
			if sources[j].Priority < sources[i].Priority {
				sources[i], sources[j] = sources[j], sources[i]
			}
		}
	}

	return sources
}

// isSourceHealthy checks if a source is healthy
func (pf *PriceFeed) isSourceHealthy(sourceName string) bool {
	pf.metrics.mu.RLock()
	stat, ok := pf.metrics.sourceStats[sourceName]
	pf.metrics.mu.RUnlock()

	if !ok {
		return false
	}

	// Check if we've had too many recent failures
	if stat.FailureCount > maxSourceFailures {
		// Check if enough time has passed to retry
		if time.Since(stat.LastFailure) < sourceRetryDelay {
			return false
		}
	}

	return true
}

// recordSuccess records a successful fetch
func (pf *PriceFeed) recordSuccess(sourceName string) {
	pf.metrics.mu.Lock()
	defer pf.metrics.mu.Unlock()

	if stat, ok := pf.metrics.sourceStats[sourceName]; ok {
		stat.SuccessCount++
		stat.LastSuccess = time.Now()
		stat.IsHealthy = true
		stat.FailureCount = 0
	}
}

// recordFailure records a failed fetch
func (pf *PriceFeed) recordFailure(sourceName string, err error) {
	pf.metrics.mu.Lock()
	defer pf.metrics.mu.Unlock()

	if stat, ok := pf.metrics.sourceStats[sourceName]; ok {
		stat.FailureCount++
		stat.LastFailure = time.Now()

		if stat.FailureCount > maxSourceFailures {
			stat.IsHealthy = false
			logging.Warn().
				Str("source", sourceName).
				Int64("failures", stat.FailureCount).
				Msg("Price source marked as unhealthy")
		}
	}
}

// updateLatencyMetrics updates latency tracking
func (pf *PriceFeed) updateLatencyMetrics(sourceName string, latency time.Duration) {
	pf.metrics.mu.Lock()
	defer pf.metrics.mu.Unlock()

	if stat, ok := pf.metrics.sourceStats[sourceName]; ok {
		// Exponential moving average for latency
		latencyMs := float64(latency.Milliseconds())
		if stat.AvgLatencyMs == 0 {
			stat.AvgLatencyMs = latencyMs
		} else {
			stat.AvgLatencyMs = stat.AvgLatencyMs*0.7 + latencyMs*0.3
		}
	}
}

// GetSourceMetrics returns current health metrics for all sources
func (pf *PriceFeed) GetSourceMetrics() map[string]*SourceStat {
	pf.metrics.mu.RLock()
	defer pf.metrics.mu.RUnlock()

	result := make(map[string]*SourceStat)
	for name, stat := range pf.metrics.sourceStats {
		result[name] = &SourceStat{
			Name:         stat.Name,
			SuccessCount: stat.SuccessCount,
			FailureCount: stat.FailureCount,
			LastSuccess:  stat.LastSuccess,
			LastFailure:  stat.LastFailure,
			AvgLatencyMs: stat.AvgLatencyMs,
			IsHealthy:    stat.IsHealthy,
		}
	}
	return result
}

// Cache methods

// Get retrieves a cached price if not expired
func (pc *PriceCache) Get(currencyPair string) (float64, bool) {
	pc.mu.RLock()
	defer pc.mu.RUnlock()

	if time.Since(pc.lastUpdated) > pc.ttl {
		return 0, false
	}

	price, ok := pc.prices[currencyPair]
	return price, ok
}

// Update updates the cache with new prices
func (pc *PriceCache) Update(prices map[string]float64) {
	pc.mu.Lock()
	defer pc.mu.Unlock()

	for pair, price := range prices {
		pc.prices[pair] = price
	}
	pc.lastUpdated = time.Now()
}

// Subscribe returns a channel for price updates
func (pf *PriceFeed) Subscribe() chan PriceUpdate {
	pf.mu.Lock()
	defer pf.mu.Unlock()

	ch := make(chan PriceUpdate, 10)
	pf.subscribers = append(pf.subscribers, ch)
	return ch
}

// Unsubscribe removes a subscriber
func (pf *PriceFeed) Unsubscribe(ch chan PriceUpdate) {
	pf.mu.Lock()
	defer pf.mu.Unlock()

	for i, sub := range pf.subscribers {
		if sub == ch {
			pf.subscribers = append(pf.subscribers[:i], pf.subscribers[i+1:]...)
			close(ch)
			break
		}
	}
}

// notifySubscribers sends price updates to all subscribers
func (pf *PriceFeed) notifySubscribers(update PriceUpdate) {
	pf.mu.RLock()
	defer pf.mu.RUnlock()

	for _, ch := range pf.subscribers {
		select {
		case ch <- update:
		default:
			// Channel full, skip
		}
	}
}

// StartPriceUpdater begins a background goroutine to update prices periodically
func (pf *PriceFeed) StartPriceUpdater(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			logging.Info().Msg("Price updater shutting down")
			return
		case <-ticker.C:
			price, source, err := pf.fetchWithTracking()
			if err != nil {
				logging.Error(err).Msg("Failed to update prices from all sources")
				continue
			}

			// Notify about price changes
			pf.notifySubscribers(PriceUpdate{
				CurrencyPair: SOLUSD,
				Price:        price,
				Source:       source,
				Timestamp:    time.Now().UTC(),
			})

			pf.cache.Update(map[string]float64{SOLUSD: price})
			logging.Debug().
				Float64("price", price).
				Str("source", source).
				Msg("Prices updated")
		}
	}
}

// fetchWithTracking fetches price and returns which source succeeded
func (pf *PriceFeed) fetchWithTracking() (float64, string, error) {
	for _, source := range pf.getSourcesByPriority() {
		if !source.Enabled || !pf.isSourceHealthy(source.Name) {
			continue
		}

		price, err := pf.fetchFromSource(source, SOLUSD)
		if err == nil {
			pf.recordSuccess(source.Name)
			return price, source.Name, nil
		}

		pf.recordFailure(source.Name, err)
	}

	// All sources failed
	if rate, ok := defaultRates[SOLUSD]; ok {
		logging.Warn().Float64("fallback_price", rate).Msg("Using fallback price")
		return rate, "fallback", nil
	}

	return 0, "", fmt.Errorf("all price sources failed and no fallback available")
}

// Global price feed instance
var globalPriceFeed *PriceFeed

// InitPriceFeed initializes the global price feed
func InitPriceFeed() {
	globalPriceFeed = NewPriceFeed()
}

// GetPriceFeed returns the global price feed instance
func GetPriceFeed() *PriceFeed {
	if globalPriceFeed == nil {
		InitPriceFeed()
	}
	return globalPriceFeed
}

// GetSOLPrice is a convenience function to get SOL price in USD
func GetSOLPrice() (float64, error) {
	return GetPriceFeed().GetSOLPriceUSD()
}
