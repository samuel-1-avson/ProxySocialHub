package api

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	solanaGo "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/geo"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/prices"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/token"
)

// RegisterExplorerRoutes registers all public explorer endpoints
func RegisterExplorerRoutes(r *gin.RouterGroup) {
	// P2-07: IP-based rate limiting — 120 req/min for general endpoints.
	// The /nodes/geo endpoint has a tighter limit (20/min) because it returns
	// a large payload and is the most expensive query.
	explorer := r.Group("/explorer", RateLimitWithConfig(120, time.Minute))
	explorer.Use(enforceExplorerFullDecentralization())
	{
		// Dashboard metrics
		explorer.GET("/metrics", getExplorerMetrics)
		explorer.GET("/stats", getNetworkStats)

		// Transactions
		explorer.GET("/transactions", listTransactions)
		explorer.GET("/transactions/:hash", getTransactionByHash)

		// Wallets/Addresses
		explorer.GET("/wallets/:address", getWalletDetails)
		explorer.GET("/wallets/:address/transactions", getWalletTransactions)

		// Blocks
		explorer.GET("/blocks", listBlocks)
		explorer.GET("/blocks/:identifier", getBlockByIdentifier) // hash or number

		// Nodes & Validators
		explorer.GET("/nodes", listExplorerNodes)
		// /nodes/geo returns a large payload — tighter per-IP limit.
		explorer.GET("/nodes/geo", RateLimitWithConfig(20, time.Minute), getExplorerNodesGeo)
		explorer.GET("/nodes/:id", getExplorerNodeDetails)
		explorer.GET("/validators", listExplorerValidators)

		// Smart Contracts
		explorer.GET("/contracts", listContracts)
		explorer.GET("/contracts/:address", getContractDetails)

		// Bandwidth & Network
		explorer.GET("/bandwidth", getBandwidthStats)
		explorer.GET("/network/health", getNetworkHealth)
		explorer.GET("/decentralization/status", getExplorerDecentralizationStatus)
		explorer.GET("/decentralization/writers", getExplorerDecentralizationWriters)

		// Analytics & Leaderboard
		explorer.GET("/analytics", getExplorerAnalytics)
		explorer.GET("/leaderboard", getExplorerLeaderboard)

		// Sessions (disabled by default — set EXPLORER_PUBLIC_SESSIONS_ENABLED=true to expose)
		explorer.GET("/sessions", RateLimitWithConfig(30, time.Minute), enforceExplorerPublicSessions(), listExplorerSessions)

		// Provider earnings (disabled by default — set EXPLORER_PUBLIC_EARNINGS_ENABLED=true to expose)
		explorer.GET("/earnings", RateLimitWithConfig(60, time.Minute), enforceExplorerPublicEarnings(), getExplorerProviderEarnings)

		// Network Health History
		explorer.GET("/health/history", getHealthHistory)
	}
}

// ============================================================
// Response DTOs
// ============================================================

type ExplorerMetricsResponse struct {
	Chain                    string         `json:"chain"`
	TotalTransactions        uint64         `json:"total_transactions"`
	TotalVolume              float64        `json:"total_volume"`
	ActiveWallets            uint64         `json:"active_wallets"`
	ActiveNodes              uint64         `json:"active_nodes"`
	BlockHeight              uint64         `json:"block_height"`
	AvgBlockTime             float64        `json:"avg_block_time_ms"`
	TotalBandwidthGB         float64        `json:"total_bandwidth_gb"`
	TPS                      float64        `json:"transactions_per_second"`
	TpsWindowHours           int            `json:"tps_window_hours"` // hours used for transactions_per_second (live path)
	RegionDistribution       map[string]int `json:"region_distribution,omitempty"`
	LastUpdated              time.Time      `json:"last_updated"`
	DataSource               string         `json:"data_source"`                // "aggregated" | "live"
	TimeSeriesAvailable      bool           `json:"time_series_available"`      // hourly/daily explorer_metrics rows exist
	MetricsAggregatorEnabled bool           `json:"metrics_aggregator_enabled"` // EXPLORER_METRICS_ENABLED (default on)
	// Freshness of the index. Both are omitted when there is no indexed block, so "unknown" is never sent as 0.
	IndexedHeadTime   *time.Time `json:"indexed_head_time,omitempty"`   // chain time of the newest indexed block
	IndexedLagSeconds *int64     `json:"indexed_lag_seconds,omitempty"` // age of that block when this response was made
}

// explorerIndexLag reports how old the newest indexed block is. ok is false when the block has no
// time, so the caller can leave the lag out. A block time slightly ahead of this clock counts as 0.
func explorerIndexLag(head, now time.Time) (seconds int64, ok bool) {
	if head.IsZero() {
		return 0, false
	}
	lag := now.Sub(head)
	if lag < 0 {
		lag = 0
	}
	return int64(lag / time.Second), true
}

// applyExplorerIndexLag recomputes the lag from the head time. Cached responses carry the lag from
// when they were stored, so this runs on every response rather than trusting that value.
func applyExplorerIndexLag(response *ExplorerMetricsResponse, now time.Time) {
	response.IndexedLagSeconds = nil
	if response.IndexedHeadTime == nil {
		return
	}
	if seconds, ok := explorerIndexLag(*response.IndexedHeadTime, now); ok {
		response.IndexedLagSeconds = &seconds
	}
}

type TransactionListResponse struct {
	Transactions []TransactionSummary `json:"transactions"`
	Total        int64                `json:"total"`
	Page         int                  `json:"page"`
	PageSize     int                  `json:"page_size"`
}

type TransactionSummary struct {
	TxHash      string    `json:"tx_hash"`
	Chain       string    `json:"chain"`
	FromAddress string    `json:"from_address"`
	ToAddress   string    `json:"to_address"`
	Amount      float64   `json:"amount"`
	Currency    string    `json:"currency"`
	Status      string    `json:"status"`
	TxType      string    `json:"tx_type"`
	Timestamp   time.Time `json:"timestamp"`
	Fee         float64   `json:"fee"`
}

type TransactionDetailResponse struct {
	TxHash        string    `json:"tx_hash"`
	Chain         string    `json:"chain"`
	BlockHash     string    `json:"block_hash"`
	BlockNumber   uint64    `json:"block_number"`
	FromAddress   string    `json:"from_address"`
	ToAddress     string    `json:"to_address"`
	Amount        float64   `json:"amount"`
	Currency      string    `json:"currency"`
	Fee           float64   `json:"fee"`
	Status        string    `json:"status"`
	TxType        string    `json:"tx_type"`
	ProgramID     string    `json:"program_id,omitempty"`
	Timestamp     time.Time `json:"timestamp"`
	Confirmations int       `json:"confirmations"`
	// Raw chain payload is intentionally omitted from public explorer responses (EXP-P0-08).
}

type WalletDetailsResponse struct {
	Address          string    `json:"address"`
	Chain            string    `json:"chain"`
	BalanceSOL       float64   `json:"balance_sol"`
	BalancePlatform  float64   `json:"balance_platform"`
	SolPriceUSD      float64   `json:"sol_price_usd"` // current SOL/USD rate (0 if unavailable)
	TransactionCount int64     `json:"transaction_count"`
	FirstActivity    time.Time `json:"first_activity"`
	LastActivity     time.Time `json:"last_activity"`
	IsContract       bool      `json:"is_contract"`
	// LinkedUserID is intentionally omitted from public explorer responses (EXP-P0-04).
}

type BlockListResponse struct {
	Blocks   []BlockSummary `json:"blocks"`
	Total    int64          `json:"total"`
	Page     int            `json:"page"`
	PageSize int            `json:"page_size"`
}

type BlockSummary struct {
	BlockHash        string    `json:"block_hash"`
	BlockNumber      uint64    `json:"block_number"`
	Chain            string    `json:"chain"`
	Timestamp        time.Time `json:"timestamp"`
	TransactionCount int       `json:"transaction_count"`
	ValidatorPubkey  string    `json:"validator_pubkey,omitempty"`
}

type BlockDetailResponse struct {
	BlockHash        string               `json:"block_hash"`
	BlockNumber      uint64               `json:"block_number"`
	Chain            string               `json:"chain"`
	ParentHash       string               `json:"parent_hash"`
	Timestamp        time.Time            `json:"timestamp"`
	TransactionCount int                  `json:"transaction_count"`
	Slot             uint64               `json:"slot,omitempty"`
	ValidatorPubkey  string               `json:"validator_pubkey,omitempty"`
	Transactions     []TransactionSummary `json:"transactions,omitempty"`
}

type NodeListResponse struct {
	Nodes    []NodeSummary `json:"nodes"`
	Total    int64         `json:"total"`
	Active   int64         `json:"active"`
	Page     int           `json:"page"`
	PageSize int           `json:"page_size"`
}

type NodeSummary struct {
	NodeID string `json:"node_id"`
	// Provider identity fields are omitted from public explorer responses (EXP-P0-06); use publicNodeSummary.
	Name           string    `json:"name,omitempty"`
	Chain          string    `json:"chain"`
	Region         string    `json:"region"`
	Country        string    `json:"country"`
	City           string    `json:"city,omitempty"`
	ISP            string    `json:"isp,omitempty"`
	Latitude       float64   `json:"latitude"`
	Longitude      float64   `json:"longitude"`
	IsActive       bool      `json:"is_active"`
	IsValidator    bool      `json:"is_validator"`
	UptimePercent  float64   `json:"uptime_percent"`
	ActiveSessions int       `json:"active_sessions"`
	BandwidthGB    float64   `json:"bandwidth_gb"`
	LastHeartbeat  time.Time `json:"last_heartbeat"`
}

type NodeDetailResponse struct {
	NodeSummary
	StakeAmount    float64 `json:"stake_amount,omitempty"`
	CommissionRate float64 `json:"commission_rate,omitempty"`
	Version        string  `json:"version,omitempty"`
	TotalBandwidth uint64  `json:"total_bandwidth_bytes"`
	// Extended fields sourced from the nodes table (real telemetry)
	LatencyMs     int     `json:"latency_ms"`
	QualityScore  float64 `json:"quality_score"`
	SuccessRate   float64 `json:"success_rate"`
	TotalSessions int64   `json:"total_sessions"`
	BytesUp       int64   `json:"bytes_up"`
	BytesDown     int64   `json:"bytes_down"`
	// Validator hotkey is intentionally omitted from public node detail (EXP-P0-09).
}

// NodeGeoPoint is the lightweight payload returned by GET /nodes/geo.
// Only the fields the map engine actually needs are included to keep
// the response small at large node counts.
type NodeGeoPoint struct {
	NodeID         string          `json:"node_id"`
	Latitude       float64         `json:"lat"`
	Longitude      float64         `json:"lon"`
	IsActive       bool            `json:"is_active"`
	IsValidator    bool            `json:"is_validator"`
	UptimePercent  float64         `json:"uptime_percent"`
	ActiveSessions int             `json:"active_sessions"`
	Country        string          `json:"country"`
	Region         string          `json:"region"`
	City           string          `json:"city,omitempty"`
	ISP            string          `json:"isp,omitempty"`
	GeoSource      string          `json:"geo_source,omitempty"`
	Geo            *geo.MapGeoMeta `json:"geo,omitempty"`
}

type NodeGeoResponse struct {
	Nodes []NodeGeoPoint `json:"nodes"`
	Total int            `json:"total"`
}

type ContractListResponse struct {
	Contracts []ContractSummary `json:"contracts"`
	Total     int64             `json:"total"`
	Page      int               `json:"page"`
	PageSize  int               `json:"page_size"`
}

type ContractSummary struct {
	Address      string    `json:"address"`
	Chain        string    `json:"chain"`
	Name         string    `json:"name"`
	ContractType string    `json:"contract_type"`
	IsVerified   bool      `json:"is_verified"`
	TotalCalls   uint64    `json:"total_calls"`
	DeployedAt   time.Time `json:"deployed_at"`
}

type BandwidthStatsResponse struct {
	TotalBandwidthGB      float64            `json:"total_bandwidth_gb"`
	Last24HoursBandwidth  float64            `json:"last_24h_bandwidth_gb"`
	ActiveConnections     int64              `json:"active_connections"`
	AverageThroughputMbps float64            `json:"avg_throughput_mbps"`
	BandwidthByRegion     map[string]float64 `json:"bandwidth_by_region"`
	TopProviders          []ProviderBWStats  `json:"top_providers"`
}

type ProviderBWStats struct {
	NodeID       string  `json:"node_id"`
	BandwidthGB  float64 `json:"bandwidth_gb"`
	SessionCount int     `json:"session_count"`
}

type NetworkHealthResponse struct {
	Status            string    `json:"status"` // "healthy", "degraded", "down"
	SolanaHealth      string    `json:"solana_health"`
	DatabaseHealth    string    `json:"database_health"`
	ActiveNodes       int64     `json:"active_nodes"`
	AvgResponseTimeMs float64   `json:"avg_response_time_ms"`
	LastChecked       time.Time `json:"last_checked"`
}

type ExplorerDecentralizationStatusResponse struct {
	Chain               string    `json:"chain"`
	WindowSlots         uint64    `json:"window_slots"`
	LatestAttestedSlot  uint64    `json:"latest_attested_slot"`
	RecentSlotsAnalyzed int64     `json:"recent_slots_analyzed"`
	UniqueWriters       int64     `json:"unique_writers"`
	MinWritersRequired  int64     `json:"min_writers_required"`
	SlotsMeetingQuorum  int64     `json:"slots_meeting_quorum"`
	ConflictingSlots    int64     `json:"conflicting_slots"`
	QuorumRatio         float64   `json:"quorum_ratio"`
	ExplorerMode        string    `json:"explorer_mode"`
	FullyDecentralized  bool      `json:"fully_decentralized"`
	LastUpdated         time.Time `json:"last_updated"`
}

type ExplorerDecentralizationWritersResponse struct {
	Chain               string                 `json:"chain"`
	WindowSlots         uint64                 `json:"window_slots"`
	LatestAttestedSlot  uint64                 `json:"latest_attested_slot"`
	RecentSlotsAnalyzed int64                  `json:"recent_slots_analyzed"`
	MinWritersRequired  int64                  `json:"min_writers_required"`
	Writers             []ExplorerWriterHealth `json:"writers"`
	LastUpdated         time.Time              `json:"last_updated"`
}

type ExplorerWriterHealth struct {
	WriterID                string    `json:"writer_id"`
	RPCEndpoint             string    `json:"rpc_endpoint,omitempty"` // always redacted on public explorer (EXP-P0-05)
	WriterPublicKey         string    `json:"writer_public_key,omitempty"`
	SignatureScheme         string    `json:"signature_scheme,omitempty"`
	HasAttestationSignature bool      `json:"has_attestation_signature"`
	IdentityVerified        bool      `json:"identity_verified"`
	LatestSlot              uint64    `json:"latest_slot"`
	LagSlots                uint64    `json:"lag_slots"`
	AttestationCount        int64     `json:"attestation_count"`
	SlotsCovered            int64     `json:"slots_covered"`
	ParticipationRatio      float64   `json:"participation_ratio"`
	ConflictingSlots        int64     `json:"conflicting_slots"`
	FirstAttestedAt         time.Time `json:"first_attested_at"`
	LastAttestedAt          time.Time `json:"last_attested_at"`
}

type explorerWriterRollupRow struct {
	WriterID         string
	RPCEndpoint      string
	LatestSlot       uint64
	AttestationCount int64
	SlotsCovered     int64
	FirstAttestedAt  time.Time
	LastAttestedAt   time.Time
}

type explorerWriterIdentityEvidence struct {
	WriterID             string
	Chain                string
	Slot                 uint64
	BlockHash            string
	ParentHash           string
	AttestedAt           time.Time
	WriterPublicKey      string
	SignatureScheme      string
	AttestationSignature string
}

var explorerDecentralizationStatusLoader = loadExplorerDecentralizationStatus
var explorerDecentralizationWritersLoader = loadExplorerDecentralizationWriters

var explorerDecentralizationStatusCache = struct {
	mu        sync.RWMutex
	window    uint64
	response  ExplorerDecentralizationStatusResponse
	fetchedAt time.Time
	cacheTTL  time.Duration
}{
	cacheTTL: 5 * time.Second,
}

func clearExplorerDecentralizationStatusCache() {
	explorerDecentralizationStatusCache.mu.Lock()
	defer explorerDecentralizationStatusCache.mu.Unlock()
	explorerDecentralizationStatusCache.window = 0
	explorerDecentralizationStatusCache.response = ExplorerDecentralizationStatusResponse{}
	explorerDecentralizationStatusCache.fetchedAt = time.Time{}
}

func setExplorerTrustHeaders(c *gin.Context, status ExplorerDecentralizationStatusResponse) {
	c.Header("X-ProxyHubb-Explorer-Mode", status.ExplorerMode)
	c.Header("X-ProxyHubb-Explorer-Quorum", fmt.Sprintf("%d/%d", status.SlotsMeetingQuorum, status.RecentSlotsAnalyzed))
	c.Header("X-ProxyHubb-Explorer-Confidence", fmt.Sprintf("%.4f", status.QuorumRatio))
}

func shouldBypassExplorerDecentralizationGate(c *gin.Context) bool {
	path := c.FullPath()
	if path == "" {
		return false
	}

	return strings.HasSuffix(path, "/decentralization/status") ||
		strings.HasSuffix(path, "/decentralization/writers") ||
		strings.HasSuffix(path, "/network/health")
}

func loadExplorerDecentralizationStatusCachedMemory(windowSlots uint64) (ExplorerDecentralizationStatusResponse, error) {
	if windowSlots == 0 {
		windowSlots = 256
	}

	now := time.Now()
	explorerDecentralizationStatusCache.mu.RLock()
	if explorerDecentralizationStatusCache.window == windowSlots &&
		!explorerDecentralizationStatusCache.fetchedAt.IsZero() &&
		now.Sub(explorerDecentralizationStatusCache.fetchedAt) < explorerDecentralizationStatusCache.cacheTTL {
		cached := explorerDecentralizationStatusCache.response
		explorerDecentralizationStatusCache.mu.RUnlock()
		return cached, nil
	}
	explorerDecentralizationStatusCache.mu.RUnlock()

	status, err := explorerDecentralizationStatusLoader(windowSlots)
	if err != nil {
		return status, err
	}

	explorerDecentralizationStatusCache.mu.Lock()
	explorerDecentralizationStatusCache.window = windowSlots
	explorerDecentralizationStatusCache.response = status
	explorerDecentralizationStatusCache.fetchedAt = now
	explorerDecentralizationStatusCache.mu.Unlock()

	if redisClient.Client != nil {
		redisKey := fmt.Sprintf("explorer:decentralization:status:%d", windowSlots)
		if jsonData, err := json.Marshal(status); err == nil {
			_ = redisClient.Client.Set(context.Background(), redisKey, jsonData, 15*time.Second).Err()
		}
	}

	return status, nil
}

func loadExplorerDecentralizationStatusCached(windowSlots uint64) (ExplorerDecentralizationStatusResponse, error) {
	if windowSlots == 0 {
		windowSlots = 256
	}

	redisKey := fmt.Sprintf("explorer:decentralization:status:%d", windowSlots)
	if redisClient.Client != nil {
		if cached, err := redisClient.Client.Get(context.Background(), redisKey).Result(); err == nil && cached != "" {
			var response ExplorerDecentralizationStatusResponse
			if err := json.Unmarshal([]byte(cached), &response); err == nil {
				return response, nil
			}
		}
	}

	return loadExplorerDecentralizationStatusCachedMemory(windowSlots)
}

// allowExplorerWebSocket applies the same full-decentralization gate as HTTP routes.
func allowExplorerWebSocket(c *gin.Context) bool {
	if !decentralization.FullModeEnabled() || shouldBypassExplorerDecentralizationGate(c) {
		return true
	}

	setAuthorityHeaders(c, authorityModeHybridAsyncChain, "indexed_reads_with_quorum_attestation", "mirror")

	status, err := loadExplorerDecentralizationStatusCached(256)
	if err != nil {
		logging.Error(err).Msg("[ProxyExplorer] WebSocket gate failed to evaluate quorum status")
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
			"error": "explorer full decentralization gate active; decentralization status unavailable",
		})
		return false
	}

	setExplorerTrustHeaders(c, status)

	if !status.FullyDecentralized {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
			"error":                 "explorer full decentralization gate active; quorum requirements not satisfied",
			"explorer_mode":         status.ExplorerMode,
			"min_writers_required":  status.MinWritersRequired,
			"unique_writers":        status.UniqueWriters,
			"recent_slots_analyzed": status.RecentSlotsAnalyzed,
			"slots_meeting_quorum":  status.SlotsMeetingQuorum,
			"conflicting_slots":     status.ConflictingSlots,
			"quorum_ratio":          status.QuorumRatio,
		})
		return false
	}

	return true
}

func enforceExplorerFullDecentralization() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !decentralization.FullModeEnabled() || shouldBypassExplorerDecentralizationGate(c) {
			c.Next()
			return
		}

		setAuthorityHeaders(c, authorityModeHybridAsyncChain, "indexed_reads_with_quorum_attestation", "mirror")

		status, err := loadExplorerDecentralizationStatusCached(256)
		if err != nil {
			logging.Error(err).Msg("[ProxyExplorer] Full decentralization gate failed to evaluate quorum status")
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error": "explorer full decentralization gate active; decentralization status unavailable",
			})
			return
		}

		setExplorerTrustHeaders(c, status)

		if !status.FullyDecentralized {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error":                 "explorer full decentralization gate active; quorum requirements not satisfied",
				"explorer_mode":         status.ExplorerMode,
				"min_writers_required":  status.MinWritersRequired,
				"unique_writers":        status.UniqueWriters,
				"recent_slots_analyzed": status.RecentSlotsAnalyzed,
				"slots_meeting_quorum":  status.SlotsMeetingQuorum,
				"conflicting_slots":     status.ConflictingSlots,
				"quorum_ratio":          status.QuorumRatio,
			})
			return
		}

		c.Next()
	}
}

// ============================================================
// Handler Implementations
// ============================================================

// explorerDistinctActiveWallets counts unique from/to addresses on non-orphaned txs in [since, now).
func explorerDistinctActiveWallets(chain string, since time.Time) uint64 {
	var count int64
	now := time.Now()
	db.GetReadDB().Raw(`
		SELECT COUNT(DISTINCT addr) FROM (
			SELECT from_address AS addr FROM explorer_transactions
			WHERE chain = ? AND is_orphaned = ? AND timestamp >= ? AND timestamp < ?
			UNION
			SELECT to_address AS addr FROM explorer_transactions
			WHERE chain = ? AND is_orphaned = ? AND timestamp >= ? AND timestamp < ?
		) AS wallets
	`, chain, false, since, now, chain, false, since, now).Scan(&count)
	return uint64(count)
}

// explorerCompute24hTPS returns confirmed non-orphaned tx count in the last 24h divided by 86400.
func explorerCompute24hTPS(chain string) float64 {
	var tpsWindow int64
	since := time.Now().Add(-24 * time.Hour)
	db.GetReadDB().Model(&models.ExplorerTransaction{}).
		Where("chain = ? AND is_orphaned = ? AND timestamp > ?", chain, false, since).
		Count(&tpsWindow)
	return float64(tpsWindow) / (24 * 3600)
}

func getExplorerMetrics(c *gin.Context) {
	chain := c.DefaultQuery("chain", "all")

	// Default to solana if 'all' is requested, as we only want proxy blockchain now
	if chain == "all" || chain == "" {
		chain = "solana"
	}

	cacheKey := fmt.Sprintf("explorer:metrics:%s", chain)

	// Try Redis cache first
	if redisClient.Client != nil {
		cached, err := redisClient.Client.Get(c, cacheKey).Result()
		if err == nil && cached != "" {
			var response ExplorerMetricsResponse
			if err := json.Unmarshal([]byte(cached), &response); err == nil {
				// Reject stale/empty aggregated snapshots that look like "network is dead"
				// while live tables still have activity (hourly buckets are per-window, not totals).
				if response.DataSource != "aggregated" || response.BlockHeight > 0 || response.TotalTransactions > 0 || response.ActiveNodes > 0 {
					if response.TpsWindowHours == 24 && response.TPS == 0 {
						response.TPS = explorerCompute24hTPS(chain)
					}
					ts, agg := explorerMetricsResponseExtras(chain)
					response.TimeSeriesAvailable = ts
					response.MetricsAggregatorEnabled = agg
					applyExplorerIndexLag(&response, time.Now())
					c.JSON(http.StatusOK, response)
					return
				}
			}
		}
	}

	// NOTE: explorer_metrics hourly/daily rows are per-window rollups for charts.
	// They must NOT be used as lifetime network totals — a quiet hour would zero the
	// whole dashboard. Always compute live totals from explorer_* tables.
	var txCount int64
	var nodeCount int64
	var totalVolume float64
	var totalBandwidthBytes int64

	db.GetReadDB().Model(&models.ExplorerTransaction{}).Where("chain = ? AND is_orphaned = ?", "solana", false).Count(&txCount)
	db.GetReadDB().Model(&models.ExplorerTransaction{}).Where("chain = ? AND status = ? AND is_orphaned = ?", "solana", "confirmed", false).Select("COALESCE(SUM(amount), 0)").Scan(&totalVolume)
	explorerPrivacyQuery(db.DB.Model(&models.ExplorerNode{})).Where("is_active = ? AND chain = ?", true, "solana").Count(&nodeCount)
	// Bandwidth is cumulative telemetry from active provider nodes (lifetime counter).
	explorerPrivacyQuery(db.DB.Model(&models.ExplorerNode{})).Where("is_active = ? AND chain = ?", true, "solana").Select("COALESCE(SUM(total_bandwidth), 0)").Scan(&totalBandwidthBytes)
	activeWallets := explorerDistinctActiveWallets("solana", time.Now().Add(-24*time.Hour))

	// Compute avg block time from the last 1000 indexed blocks (real chain data)
	var avgBlockTimeMs float64
	var blockTimes []struct {
		BlockNumber uint64
		Timestamp   time.Time
	}
	if err := db.GetReadDB().Model(&models.ExplorerBlock{}).
		Where("is_orphaned = ?", false).
		Order("block_number DESC").Limit(1000).
		Select("block_number, timestamp").Scan(&blockTimes).Error; err == nil && len(blockTimes) >= 2 {
		totalMs := blockTimes[0].Timestamp.Sub(blockTimes[len(blockTimes)-1].Timestamp).Milliseconds()
		if totalMs > 0 {
			avgBlockTimeMs = float64(totalMs) / float64(len(blockTimes)-1)
		}
	}

	tps := explorerCompute24hTPS("solana")

	// Block height from latest indexed block (real Solana chain height)
	blockHeight := uint64(0)
	var indexedHeadTime *time.Time
	var latestBlock models.ExplorerBlock
	if err := db.GetReadDB().Where("is_orphaned = ?", false).Order("block_number DESC").First(&latestBlock).Error; err == nil {
		blockHeight = latestBlock.BlockNumber
		if !latestBlock.Timestamp.IsZero() {
			headTime := latestBlock.Timestamp
			indexedHeadTime = &headTime
		}
	}

	// Regional distribution of active provider nodes
	var regionStats []struct {
		Region string
		Count  int
	}
	explorerPrivacyQuery(db.DB.Model(&models.ExplorerNode{})).Where("is_active = ? AND chain = ?", true, "solana").
		Select("region, count(*) as count").Group("region").Scan(&regionStats)

	regionDist := make(map[string]int)
	for _, s := range regionStats {
		rname := s.Region
		if rname == "" {
			rname = "Other"
		}
		regionDist[rname] = s.Count
	}

	response := ExplorerMetricsResponse{
		Chain:                    chain,
		TotalTransactions:        uint64(txCount),
		TotalVolume:              totalVolume,
		ActiveWallets:            activeWallets,
		ActiveNodes:              uint64(nodeCount),
		BlockHeight:              blockHeight,
		AvgBlockTime:             avgBlockTimeMs,
		TotalBandwidthGB:         float64(totalBandwidthBytes) / (1024 * 1024 * 1024),
		TPS:                      tps,
		TpsWindowHours:           24,
		RegionDistribution:       regionDist,
		LastUpdated:              time.Now(),
		DataSource:               "live",
		TimeSeriesAvailable:      explorerTimeSeriesAvailable(chain),
		MetricsAggregatorEnabled: explorerMetricsAggregatorEnabled(),
		IndexedHeadTime:          indexedHeadTime,
	}
	applyExplorerIndexLag(&response, response.LastUpdated)

	// Cache in Redis
	cacheResponse(c, cacheKey, response, 30*time.Second)

	c.JSON(http.StatusOK, response)
}

func getNetworkStats(c *gin.Context) {
	// Aggregate stats from multiple sources
	var stats struct {
		TotalTx     int64
		TotalVolume float64
		ActiveNodes int64
	}

	db.GetReadDB().Model(&models.ExplorerTransaction{}).Where("chain = ? AND is_orphaned = ?", "solana", false).Count(&stats.TotalTx)
	db.GetReadDB().Model(&models.ExplorerTransaction{}).Where("chain = ? AND is_orphaned = ?", "solana", false).Select("COALESCE(SUM(amount), 0)").Scan(&stats.TotalVolume)
	explorerPrivacyQuery(db.DB.Model(&models.ExplorerNode{})).Where("is_active = ? AND chain = ?", true, "solana").Count(&stats.ActiveNodes)

	c.JSON(http.StatusOK, gin.H{
		"total_transactions": stats.TotalTx,
		"total_volume":       stats.TotalVolume,
		"active_nodes":       stats.ActiveNodes,
		"timestamp":          time.Now(),
	})
}

func listTransactions(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	chain := c.Query("chain")
	txType := c.Query("type")
	status := c.Query("status")
	address := c.Query("address")

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	query := db.GetReadDB().Model(&models.ExplorerTransaction{}).Where("is_orphaned = ?", false)

	if chain != "" {
		query = query.Where("chain = ?", chain)
	}
	if txType != "" {
		query = query.Where("tx_type = ?", txType)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if address != "" {
		query = query.Where("from_address = ? OR to_address = ?", address, address)
	}

	var total int64
	query.Count(&total)

	var transactions []models.ExplorerTransaction
	if err := query.Order("timestamp DESC").Offset(offset).Limit(pageSize).Find(&transactions).Error; err != nil {
		explorerPublicError(c, http.StatusInternalServerError, "Failed to fetch transactions", err)
		return
	}

	summaries := make([]TransactionSummary, len(transactions))
	for i, tx := range transactions {
		summaries[i] = TransactionSummary{
			TxHash:      tx.TxHash,
			Chain:       tx.Chain,
			FromAddress: tx.FromAddress,
			ToAddress:   tx.ToAddress,
			Amount:      tx.Amount,
			Currency:    tx.Currency,
			Status:      tx.Status,
			TxType:      tx.TxType,
			Timestamp:   tx.Timestamp,
			Fee:         tx.Fee,
		}
	}

	c.JSON(http.StatusOK, TransactionListResponse{
		Transactions: summaries,
		Total:        total,
		Page:         page,
		PageSize:     pageSize,
	})
}

func getTransactionByHash(c *gin.Context) {
	hash := c.Param("hash")

	if hash == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Transaction hash required"})
		return
	}

	// Try database cache first
	var tx models.ExplorerTransaction
	if err := db.GetReadDB().Where("tx_hash = ? AND is_orphaned = ?", hash, false).First(&tx).Error; err == nil {
		c.JSON(http.StatusOK, TransactionDetailResponse{
			TxHash:        tx.TxHash,
			Chain:         tx.Chain,
			BlockHash:     tx.BlockHash,
			BlockNumber:   tx.BlockNumber,
			FromAddress:   tx.FromAddress,
			ToAddress:     tx.ToAddress,
			Amount:        tx.Amount,
			Currency:      tx.Currency,
			Fee:           tx.Fee,
			Status:        tx.Status,
			TxType:        tx.TxType,
			ProgramID:     tx.ProgramID,
			Timestamp:     tx.Timestamp,
			Confirmations: tx.Confirmations,
		})
		return
	}

	// For cache miss, query Solana RPC directly
	if oracle := solana.GetOracle(); oracle != nil {
		rpcTx, err := oracle.GetTransaction(c.Request.Context(), hash)
		if err == nil && rpcTx != nil && rpcTx.Transaction != nil {
			// Use actual block time from RPC response
			txTime := time.Now()
			if rpcTx.BlockTime != nil {
				txTime = rpcTx.BlockTime.Time()
			}
			status := "confirmed"
			if rpcTx.Meta != nil && rpcTx.Meta.Err != nil {
				status = "failed"
			}
			c.JSON(http.StatusOK, TransactionDetailResponse{
				TxHash:        hash,
				Chain:         "solana",
				BlockNumber:   rpcTx.Slot,
				Confirmations: 1, // Finalized
				Status:        status,
				Timestamp:     txTime,
			})
			return
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "Transaction not found"})
}

func getWalletDetails(c *gin.Context) {
	address := c.Param("address")

	if address == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Address required"})
		return
	}

	cacheKey := fmt.Sprintf("explorer:wallet:%s", address)
	if redisClient.Client != nil {
		if cached, err := redisClient.Client.Get(c, cacheKey).Result(); err == nil && cached != "" {
			var response WalletDetailsResponse
			if err := json.Unmarshal([]byte(cached), &response); err == nil {
				c.JSON(http.StatusOK, response)
				return
			}
		}
	}

	walletTxWhere := "is_orphaned = ? AND (from_address = ? OR to_address = ?)"
	walletTxArgs := []interface{}{false, address, address}

	var txCount int64
	db.GetReadDB().Model(&models.ExplorerTransaction{}).Where(walletTxWhere, walletTxArgs...).Count(&txCount)

	var firstTx, lastTx models.ExplorerTransaction
	db.GetReadDB().Where(walletTxWhere, walletTxArgs...).Order("timestamp ASC").First(&firstTx)
	db.GetReadDB().Where(walletTxWhere, walletTxArgs...).Order("timestamp DESC").First(&lastTx)

	// Get SOL balance and PHB platform token balance from Solana RPC
	var balanceSOL, balancePlatform float64
	if oracle := solana.GetOracle(); oracle != nil {
		pubkey, err := solanaGo.PublicKeyFromBase58(address)
		if err == nil {
			// SOL balance (lamports → SOL)
			if bal, err := oracle.GetBalance(c.Request.Context(), pubkey); err == nil {
				balanceSOL = float64(bal) / 1e9
			}
			// PHB platform token balance
			if mintStr := os.Getenv("PHB_TOKEN_MINT"); mintStr != "" {
				if mintKey, err := solanaGo.PublicKeyFromBase58(mintStr); err == nil {
					if rawBal, err := oracle.GetTokenBalance(c.Request.Context(), pubkey, mintKey); err == nil {
						balancePlatform = token.PHBFromRaw(rawBal)
					}
				}
			}
		}
	}

	// Fetch live SOL/USD price (5-min cached via CoinGecko)
	solPriceUSD, _ := prices.GetSOLPrice(c.Request.Context())

	response := WalletDetailsResponse{
		Address:          address,
		Chain:            "solana",
		BalanceSOL:       balanceSOL,
		BalancePlatform:  balancePlatform,
		SolPriceUSD:      solPriceUSD,
		TransactionCount: txCount,
		FirstActivity:    firstTx.Timestamp,
		LastActivity:     lastTx.Timestamp,
	}

	cacheResponse(c, cacheKey, response, 45*time.Second)
	c.JSON(http.StatusOK, response)
}

func getWalletTransactions(c *gin.Context) {
	address := c.Param("address")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	var total int64
	query := db.GetReadDB().Model(&models.ExplorerTransaction{}).
		Where("is_orphaned = ? AND (from_address = ? OR to_address = ?)", false, address, address)
	query.Count(&total)

	var transactions []models.ExplorerTransaction
	if err := query.Order("timestamp DESC").Offset(offset).Limit(pageSize).Find(&transactions).Error; err != nil {
		explorerPublicError(c, http.StatusInternalServerError, "Failed to fetch wallet transactions", err)
		return
	}

	summaries := make([]TransactionSummary, len(transactions))
	for i, tx := range transactions {
		summaries[i] = TransactionSummary{
			TxHash:      tx.TxHash,
			Chain:       tx.Chain,
			FromAddress: tx.FromAddress,
			ToAddress:   tx.ToAddress,
			Amount:      tx.Amount,
			Currency:    tx.Currency,
			Status:      tx.Status,
			TxType:      tx.TxType,
			Timestamp:   tx.Timestamp,
			Fee:         tx.Fee,
		}
	}

	c.JSON(http.StatusOK, TransactionListResponse{
		Transactions: summaries,
		Total:        total,
		Page:         page,
		PageSize:     pageSize,
	})
}

func listBlocks(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	chain := c.DefaultQuery("chain", "solana")

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	query := db.GetReadDB().Model(&models.ExplorerBlock{}).Where("chain = ? AND is_orphaned = ?", chain, false)

	// Exact COUNT(*) on multi-million explorer_blocks is multi-second and makes
	// overview/blocks pages look dead. Prefer planner estimate; refine when small.
	var total int64
	_ = db.GetReadDB().Raw(`
		SELECT COALESCE((
			SELECT reltuples::bigint FROM pg_class WHERE oid = 'public.explorer_blocks'::regclass
		), 0)
	`).Scan(&total).Error
	if total < 10_000 {
		query.Count(&total)
	}

	var blocks []models.ExplorerBlock
	if err := query.Order("block_number DESC").Offset(offset).Limit(pageSize).Find(&blocks).Error; err != nil {
		explorerPublicError(c, http.StatusInternalServerError, "Failed to fetch blocks", err)
		return
	}

	summaries := make([]BlockSummary, len(blocks))
	for i, b := range blocks {
		summaries[i] = BlockSummary{
			BlockHash:        b.BlockHash,
			BlockNumber:      b.BlockNumber,
			Chain:            b.Chain,
			Timestamp:        b.Timestamp,
			TransactionCount: b.TransactionCount,
			ValidatorPubkey:  b.ValidatorPubkey,
		}
	}

	c.JSON(http.StatusOK, BlockListResponse{
		Blocks:   summaries,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
}

func getBlockByIdentifier(c *gin.Context) {
	identifier := c.Param("identifier")

	if identifier == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Block identifier required"})
		return
	}

	var block models.ExplorerBlock

	// Try as block number first
	if blockNum, err := strconv.ParseUint(identifier, 10, 64); err == nil {
		if err := db.GetReadDB().Where("block_number = ? AND is_orphaned = ?", blockNum, false).First(&block).Error; err == nil {
			returnBlockDetail(c, block)
			return
		}
	}

	// Try as block hash
	if err := db.GetReadDB().Where("block_hash = ? AND is_orphaned = ?", identifier, false).First(&block).Error; err == nil {
		returnBlockDetail(c, block)
		return
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "Block not found"})
}

func returnBlockDetail(c *gin.Context, block models.ExplorerBlock) {
	// Get transactions in this block
	var transactions []models.ExplorerTransaction
	db.GetReadDB().Where("block_hash = ? AND is_orphaned = ?", block.BlockHash, false).Limit(100).Find(&transactions)

	txSummaries := make([]TransactionSummary, len(transactions))
	for i, tx := range transactions {
		txSummaries[i] = TransactionSummary{
			TxHash:      tx.TxHash,
			FromAddress: tx.FromAddress,
			ToAddress:   tx.ToAddress,
			Amount:      tx.Amount,
			Currency:    tx.Currency,
			Status:      tx.Status,
			TxType:      tx.TxType,
			Timestamp:   tx.Timestamp,
		}
	}

	c.JSON(http.StatusOK, BlockDetailResponse{
		BlockHash:        block.BlockHash,
		BlockNumber:      block.BlockNumber,
		Chain:            block.Chain,
		ParentHash:       block.ParentHash,
		Timestamp:        block.Timestamp,
		TransactionCount: block.TransactionCount,
		Slot:             block.Slot,
		ValidatorPubkey:  block.ValidatorPubkey,
		Transactions:     txSummaries,
	})
}

func listExplorerNodes(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	activeOnly := c.DefaultQuery("active", "true") == "true"
	validatorOnly := c.DefaultQuery("validator", "false") == "true"
	region := c.Query("region")
	searchQ := strings.TrimSpace(c.Query("q"))

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	query := explorerPrivacyQuery(db.DB.Model(&models.ExplorerNode{})).Where("chain = ?", "solana")
	if activeOnly {
		query = query.Where("is_active = ?", true)
	}
	if validatorOnly {
		query = query.Where("is_validator = ?", true)
	}
	if region != "" {
		query = query.Where("region = ?", region)
	}
	if searchQ != "" {
		pattern := explorerNodeSearchPattern(searchQ)
		query = query.Where(
			"node_id ILIKE ? OR COALESCE(name, '') ILIKE ? OR COALESCE(region, '') ILIKE ? OR COALESCE(country, '') ILIKE ? OR COALESCE(city, '') ILIKE ? OR COALESCE(isp, '') ILIKE ?",
			pattern, pattern, pattern, pattern, pattern, pattern,
		)
	}

	var total, activeCount int64
	query.Count(&total)
	explorerPrivacyQuery(db.DB.Model(&models.ExplorerNode{})).Where("is_active = ? AND chain = ?", true, "solana").Count(&activeCount)

	var nodes []models.ExplorerNode
	if err := query.Order("uptime_percent DESC").Offset(offset).Limit(pageSize).Find(&nodes).Error; err != nil {
		explorerPublicError(c, http.StatusInternalServerError, "Failed to fetch nodes", err)
		return
	}

	summaries := make([]NodeSummary, len(nodes))
	for i, n := range nodes {
		summaries[i] = publicNodeSummary(n)
	}

	c.JSON(http.StatusOK, NodeListResponse{
		Nodes:    summaries,
		Total:    total,
		Active:   activeCount,
		Page:     page,
		PageSize: pageSize,
	})
}

// getExplorerNodesGeo returns a lightweight list of all nodes with their
// geographic coordinates plus minimal status fields — used exclusively by
// the map engine to avoid fetching full NodeSummary objects.
func getExplorerNodesGeo(c *gin.Context) {
	activeOnly := c.DefaultQuery("active", "false") == "true"
	validatorOnly := c.DefaultQuery("validator", "false") == "true"

	c.Header("Cache-Control", "no-store")

	query := explorerPrivacyQuery(db.DB.Model(&models.ExplorerNode{}))
	if activeOnly {
		query = query.Where("is_active = ?", true)
	}
	if validatorOnly {
		query = query.Where("is_validator = ?", true)
	}

	var nodes []models.ExplorerNode
	if err := query.
		Select("node_id, latitude, longitude, geo_source, is_active, is_validator, uptime_percent, active_sessions, country, region, city, isp").
		Order("is_active DESC, uptime_percent DESC").
		Limit(5000).
		Find(&nodes).Error; err != nil {
		explorerPublicError(c, http.StatusInternalServerError, "Failed to fetch node geo data", err)
		return
	}

	points := make([]NodeGeoPoint, 0, len(nodes))
	for _, n := range nodes {
		anchor := geo.MapGeoAnchor(n.NodeID, "", "")
		lat, lon, fallbackGeo := publicMapCoords(0, 0, n.Country, "", "", anchor, "country")
		if fallbackGeo == "unknown" {
			continue
		}
		geoSource := fallbackGeo
		if geoSource == "" || geoSource == "unknown" {
			geoSource = nodeMapGeoSource(n.GeoSource, n.Country, n.City, n.Region, n.Latitude, n.Longitude, fallbackGeo)
		}
		meta := geo.BuildMapGeoMeta(geoSource)
		points = append(points, NodeGeoPoint{
			NodeID:         mapOpaqueID("node", n.NodeID),
			Latitude:       lat,
			Longitude:      lon,
			IsActive:       n.IsActive,
			IsValidator:    n.IsValidator,
			UptimePercent:  n.UptimePercent,
			ActiveSessions: 0,
			Country:        n.Country,
			Region:         "",
			City:           "",
			ISP:            "",
			GeoSource:      geoSource,
			Geo:            &meta,
		})
	}

	resp := NodeGeoResponse{Nodes: points, Total: len(points)}

	c.JSON(http.StatusOK, resp)
}

func getExplorerNodeDetails(c *gin.Context) {
	nodeID := c.Param("id")

	var node models.ExplorerNode
	if err := db.GetReadDB().Where("node_id = ? OR "+opaqueNodeSQL()+" = ?", nodeID, nodeID).First(&node).Error; err != nil {
		explorerNotFound(c, "Node not found")
		return
	}

	if !publicExplorerNodeVisible(node.NodeID) {
		c.JSON(404, gin.H{"error": "Node not found"})
		return
	}

	// Enrich with real telemetry from the source nodes table.
	// ExplorerNode.NodeID == Node.ID (UUID string) — set by NodeSync.
	var latencyMs int
	var qualityScore, successRate float64
	var srcNode models.Node
	if err := db.GetReadDB().Where("id = ?", node.NodeID).First(&srcNode).Error; err == nil {
		latencyMs = srcNode.LatencyMs
		qualityScore = srcNode.QualityScore
		successRate = explorerSuccessRatePercent(srcNode.SuccessRate)
	}
	c.JSON(http.StatusOK, NodeDetailResponse{
		NodeSummary:    publicNodeSummary(node),
		StakeAmount:    node.StakeAmount,
		CommissionRate: node.CommissionRate,
		Version:        node.Version,
		TotalBandwidth: 0,
		LatencyMs:      latencyMs,
		QualityScore:   qualityScore,
		SuccessRate:    successRate,
		TotalSessions:  0,
		BytesUp:        0,
		BytesDown:      0,
	})
}

func listExplorerValidators(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	var total int64
	query := explorerPrivacyQuery(db.DB.Model(&models.ExplorerNode{})).Where("is_validator = ? AND is_active = ? AND chain = ?", true, true, "solana")
	query.Count(&total)

	var maxStake float64
	explorerPrivacyQuery(db.DB.Model(&models.ExplorerNode{})).
		Where("is_validator = ? AND is_active = ? AND chain = ?", true, true, "solana").
		Select("COALESCE(MAX(stake_amount), 0)").
		Scan(&maxStake)
	orderClause := "last_heartbeat DESC"
	if maxStake > 0 {
		orderClause = "stake_amount DESC"
	}

	var validators []models.ExplorerNode
	if err := query.Order(orderClause).Offset(offset).Limit(pageSize).Find(&validators).Error; err != nil {
		explorerPublicError(c, http.StatusInternalServerError, "Failed to fetch validators", err)
		return
	}

	summaries := make([]NodeSummary, len(validators))
	for i, v := range validators {
		summaries[i] = publicNodeSummary(v)
	}

	c.JSON(http.StatusOK, NodeListResponse{
		Nodes:    summaries,
		Total:    total,
		Active:   total,
		Page:     page,
		PageSize: pageSize,
	})
}

func listContracts(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	contractType := c.Query("type")
	verifiedOnly := c.DefaultQuery("verified", "false") == "true"

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	query := db.GetReadDB().Model(&models.ExplorerContract{}).Where("chain = ?", "solana")
	if contractType != "" {
		query = query.Where("contract_type = ?", contractType)
	}
	if verifiedOnly {
		query = query.Where("is_verified = ?", true)
	}

	var total int64
	query.Count(&total)

	var contracts []models.ExplorerContract
	if err := query.Order("total_calls DESC").Offset(offset).Limit(pageSize).Find(&contracts).Error; err != nil {
		explorerPublicError(c, http.StatusInternalServerError, "Failed to fetch contracts", err)
		return
	}

	summaries := make([]ContractSummary, len(contracts))
	for i, ct := range contracts {
		summaries[i] = ContractSummary{
			Address:      ct.Address,
			Chain:        ct.Chain,
			Name:         ct.Name,
			ContractType: ct.ContractType,
			IsVerified:   ct.IsVerified,
			TotalCalls:   ct.TotalCalls,
			DeployedAt:   ct.DeployedAt,
		}
	}

	c.JSON(http.StatusOK, ContractListResponse{
		Contracts: summaries,
		Total:     total,
		Page:      page,
		PageSize:  pageSize,
	})
}

// ContractDetailResponse is a safe DTO for contract details — excludes internal GORM fields.
type ContractDetailResponse struct {
	Address         string    `json:"address"`
	Chain           string    `json:"chain"`
	Name            string    `json:"name"`
	ContractType    string    `json:"contract_type"`
	IsVerified      bool      `json:"is_verified"`
	DeployerAddress string    `json:"deployer_address,omitempty"`
	TotalCalls      uint64    `json:"total_calls"`
	TotalVolume     float64   `json:"total_volume"`
	DeployedAt      time.Time `json:"deployed_at"`
}

func getContractDetails(c *gin.Context) {
	address := c.Param("address")

	var contract models.ExplorerContract
	if err := db.GetReadDB().Where("address = ?", address).First(&contract).Error; err != nil {
		explorerNotFound(c, "Contract not found")
		return
	}

	c.JSON(http.StatusOK, ContractDetailResponse{
		Address:         contract.Address,
		Chain:           contract.Chain,
		Name:            contract.Name,
		ContractType:    contract.ContractType,
		IsVerified:      contract.IsVerified,
		DeployerAddress: contract.DeployerAddress,
		TotalCalls:      contract.TotalCalls,
		TotalVolume:     contract.TotalVolume,
		DeployedAt:      contract.DeployedAt,
	})
}

// explorerPeriodSince maps public explorer period query values to a window start time.
func explorerPeriodSince(period string) time.Time {
	switch period {
	case "1h":
		return time.Now().Add(-1 * time.Hour)
	case "7d":
		return time.Now().Add(-7 * 24 * time.Hour)
	case "30d":
		return time.Now().Add(-30 * 24 * time.Hour)
	default: // 24h
		return time.Now().Add(-24 * time.Hour)
	}
}

func getBandwidthStats(c *gin.Context) {
	period := c.DefaultQuery("period", "24h")
	since := explorerPeriodSince(period)

	periodDuration := time.Since(since)
	if periodDuration < time.Minute {
		periodDuration = 24 * time.Hour
	}

	// Lifetime cumulative bandwidth across all indexed nodes.
	var totalBandwidth uint64
	explorerPrivacyQuery(db.DB.Model(&models.ExplorerNode{})).Where("chain = ?", "solana").
		Select("COALESCE(SUM(total_bandwidth), 0)").Scan(&totalBandwidth)

	// Period bandwidth from proxy usage records (bytes in window).
	var periodBandwidthBytes int64
	db.GetReadDB().Model(&models.UsageRecord{}).
		Where("created_at >= ?", since).
		Select("COALESCE(SUM(bytes_used), 0)").Scan(&periodBandwidthBytes)

	// Active connections count
	var activeConnections int64
	explorerPrivacyQuery(db.DB.Model(&models.ExplorerNode{})).
		Where("is_active = ? AND active_sessions > 0", true).
		Select("COALESCE(SUM(active_sessions), 0)").
		Scan(&activeConnections)

	// Bandwidth by region
	type RegionBW struct {
		Region    string  `json:"region"`
		Bandwidth float64 `json:"bandwidth"`
	}
	var regionStats []RegionBW
	explorerPrivacyQuery(db.DB.Model(&models.ExplorerNode{})).
		Select("region, SUM(total_bandwidth) as bandwidth").
		Group("region").
		Scan(&regionStats)

	bandwidthByRegion := make(map[string]float64)
	for _, r := range regionStats {
		region := strings.TrimSpace(r.Region)
		if region == "" {
			region = "Other"
		}
		gb := r.Bandwidth / (1024 * 1024 * 1024)
		bandwidthByRegion[region] += gb
	}

	// Top providers
	var topProviders []models.ExplorerNode
	explorerPrivacyQuery(db.DB.Model(&models.ExplorerNode{})).Order("total_bandwidth DESC").Limit(10).Find(&topProviders)

	providerStats := make([]ProviderBWStats, len(topProviders))
	for i, p := range topProviders {
		providerStats[i] = ProviderBWStats{
			NodeID:       mapOpaqueID("node", p.NodeID),
			BandwidthGB:  float64(p.TotalBandwidth) / (1024 * 1024 * 1024),
			SessionCount: 0,
		}
	}

	periodGB := float64(periodBandwidthBytes) / (1024 * 1024 * 1024)
	avgThroughputMbps := 0.0
	if periodBandwidthBytes > 0 && periodDuration > 0 {
		avgThroughputMbps = (float64(periodBandwidthBytes) * 8) / (periodDuration.Seconds() * 1_000_000)
	}

	c.JSON(http.StatusOK, BandwidthStatsResponse{
		TotalBandwidthGB:      float64(totalBandwidth) / (1024 * 1024 * 1024),
		Last24HoursBandwidth:  periodGB,
		ActiveConnections:     activeConnections,
		AverageThroughputMbps: avgThroughputMbps,
		BandwidthByRegion:     bandwidthByRegion,
		TopProviders:          providerStats,
	})
}

func getNetworkHealth(c *gin.Context) {
	cacheKey := "explorer:network:health"
	if redisClient.Client != nil {
		if cached, err := redisClient.Client.Get(c, cacheKey).Result(); err == nil && cached != "" {
			var health NetworkHealthResponse
			if err := json.Unmarshal([]byte(cached), &health); err == nil {
				c.JSON(http.StatusOK, health)
				return
			}
		}
	}

	health := NetworkHealthResponse{
		Status:      "healthy",
		LastChecked: time.Now(),
	}

	// Check Solana by calling the RPC getHealth method
	rpcURL := os.Getenv("SOLANA_RPC_ENDPOINT")
	if rpcURL == "" {
		health.SolanaHealth = "unavailable"
	} else {
		rpcBody := []byte(`{"jsonrpc":"2.0","id":1,"method":"getHealth"}`)
		rpcCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(rpcCtx, "POST", rpcURL, bytes.NewReader(rpcBody))
		if err != nil {
			health.SolanaHealth = "degraded"
			health.Status = "degraded"
		} else {
			req.Header.Set("Content-Type", "application/json")
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				health.SolanaHealth = "degraded"
				health.Status = "degraded"
			} else {
				body, _ := io.ReadAll(resp.Body)
				resp.Body.Close()
				if bytes.Contains(body, []byte(`"ok"`)) {
					health.SolanaHealth = "healthy"
				} else {
					health.SolanaHealth = "degraded"
					health.Status = "degraded"
				}
			}
		}
	}

	// Check Database (ping latency exposed as avg_response_time_ms for dashboards)
	sqlDB, err := db.GetReadDB().DB()
	if err == nil {
		pingStart := time.Now()
		if err = sqlDB.Ping(); err == nil {
			health.DatabaseHealth = "healthy"
			health.AvgResponseTimeMs = float64(time.Since(pingStart).Milliseconds())
		} else {
			health.DatabaseHealth = "down"
			health.Status = "degraded"
		}
	} else {
		health.DatabaseHealth = "down"
		health.Status = "down"
	}

	// Active nodes
	explorerPrivacyQuery(db.DB.Model(&models.ExplorerNode{})).Where("is_active = ?", true).Count(&health.ActiveNodes)

	cacheResponse(c, cacheKey, health, 10*time.Second)
	c.JSON(http.StatusOK, health)
}

func getExplorerDecentralizationStatus(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeHybridAsyncChain, "indexed_reads_with_quorum_attestation", "mirror")

	const (
		defaultWindowSlots uint64 = 256
		maxWindowSlots     uint64 = 4096
	)

	windowSlots := defaultWindowSlots
	if raw := c.Query("window_slots"); raw != "" {
		if parsed, err := strconv.ParseUint(raw, 10, 64); err == nil && parsed > 0 {
			if parsed > maxWindowSlots {
				parsed = maxWindowSlots
			}
			windowSlots = parsed
		}
	}

	response, err := loadExplorerDecentralizationStatusCached(windowSlots)
	if err != nil {
		explorerPublicError(c, http.StatusInternalServerError, "Failed to compute decentralization status", err)
		return
	}

	setExplorerTrustHeaders(c, response)
	c.JSON(http.StatusOK, response)
}

func loadExplorerDecentralizationStatus(windowSlots uint64) (ExplorerDecentralizationStatusResponse, error) {
	minWriters := explorerMinWritersRequired()
	response := ExplorerDecentralizationStatusResponse{
		Chain:              "solana",
		WindowSlots:        windowSlots,
		MinWritersRequired: minWriters,
		LastUpdated:        time.Now(),
	}

	var latestSlot uint64
	if err := db.GetReadDB().Model(&models.ExplorerBlockAttestation{}).
		Where("chain = ?", "solana").
		Select("COALESCE(MAX(slot), 0)").
		Scan(&latestSlot).Error; err != nil {
		// Before migration rollout this table may not exist on some environments.
		if strings.Contains(strings.ToLower(err.Error()), "does not exist") {
			response.ExplorerMode = "legacy_no_attestation_schema"
			return response, nil
		}
		return response, fmt.Errorf("latest slot query failed: %w", err)
	}

	response.LatestAttestedSlot = latestSlot
	if latestSlot == 0 {
		response.ExplorerMode = "bootstrap_no_attestations"
		return response, nil
	}

	fromSlot := uint64(1)
	if latestSlot >= windowSlots {
		fromSlot = latestSlot - windowSlots + 1
	}

	if err := db.GetReadDB().Model(&models.ExplorerBlockAttestation{}).
		Where("chain = ? AND slot >= ?", "solana", fromSlot).
		Distinct("slot").
		Count(&response.RecentSlotsAnalyzed).Error; err != nil {
		return response, fmt.Errorf("recent slot count failed: %w", err)
	}

	if err := db.GetReadDB().Model(&models.ExplorerBlockAttestation{}).
		Where("chain = ? AND slot >= ?", "solana", fromSlot).
		Distinct("writer_id").
		Count(&response.UniqueWriters).Error; err != nil {
		return response, fmt.Errorf("unique writer count failed: %w", err)
	}

	if err := db.GetReadDB().Raw(`
		SELECT COUNT(*)
		FROM (
			SELECT slot, MAX(writer_count) AS max_count
			FROM (
				SELECT slot, block_hash, COUNT(DISTINCT writer_id) AS writer_count
				FROM explorer_block_attestations
				WHERE chain = ? AND slot >= ?
				GROUP BY slot, block_hash
			) grouped
			GROUP BY slot
			HAVING MAX(writer_count) >= ?
		) quorum_slots
	`, "solana", fromSlot, minWriters).Scan(&response.SlotsMeetingQuorum).Error; err != nil {
		return response, fmt.Errorf("quorum slot count failed: %w", err)
	}

	if err := db.GetReadDB().Raw(`
		SELECT COUNT(*)
		FROM (
			SELECT slot
			FROM explorer_block_attestations
			WHERE chain = ? AND slot >= ?
			GROUP BY slot
			HAVING COUNT(DISTINCT block_hash) > 1
		) conflicting
	`, "solana", fromSlot).Scan(&response.ConflictingSlots).Error; err != nil {
		return response, fmt.Errorf("conflicting slot count failed: %w", err)
	}

	if response.RecentSlotsAnalyzed > 0 {
		response.QuorumRatio = float64(response.SlotsMeetingQuorum) / float64(response.RecentSlotsAnalyzed)
	}

	response.ExplorerMode = classifyExplorerDecentralizationMode(
		response.UniqueWriters,
		response.MinWritersRequired,
		response.RecentSlotsAnalyzed,
		response.SlotsMeetingQuorum,
		response.ConflictingSlots,
	)
	response.FullyDecentralized = isExplorerFullyDecentralized(response)

	return response, nil
}

func getExplorerDecentralizationWriters(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeHybridAsyncChain, "indexed_reads_with_quorum_attestation", "mirror")

	const (
		defaultWindowSlots uint64 = 256
		maxWindowSlots     uint64 = 4096
	)

	windowSlots := defaultWindowSlots
	if raw := c.Query("window_slots"); raw != "" {
		if parsed, err := strconv.ParseUint(raw, 10, 64); err == nil && parsed > 0 {
			if parsed > maxWindowSlots {
				parsed = maxWindowSlots
			}
			windowSlots = parsed
		}
	}

	response, err := explorerDecentralizationWritersLoader(windowSlots)
	if err != nil {
		logging.Error(err).Msg("[ProxyExplorer] Failed to compute writer health")
		explorerPublicError(c, http.StatusInternalServerError, "Failed to compute writer health", err)
		return
	}

	c.JSON(http.StatusOK, response)
}

func loadExplorerDecentralizationWriters(windowSlots uint64) (ExplorerDecentralizationWritersResponse, error) {
	response := ExplorerDecentralizationWritersResponse{
		Chain:              "solana",
		WindowSlots:        windowSlots,
		MinWritersRequired: explorerMinWritersRequired(),
		LastUpdated:        time.Now(),
		Writers:            make([]ExplorerWriterHealth, 0),
	}

	var latestSlot uint64
	if err := db.GetReadDB().Model(&models.ExplorerBlockAttestation{}).
		Where("chain = ?", "solana").
		Select("COALESCE(MAX(slot), 0)").
		Scan(&latestSlot).Error; err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "does not exist") {
			return response, nil
		}
		return response, fmt.Errorf("latest slot query failed: %w", err)
	}

	response.LatestAttestedSlot = latestSlot
	if latestSlot == 0 {
		return response, nil
	}

	fromSlot := uint64(1)
	if latestSlot >= windowSlots {
		fromSlot = latestSlot - windowSlots + 1
	}

	if err := db.GetReadDB().Model(&models.ExplorerBlockAttestation{}).
		Where("chain = ? AND slot >= ?", "solana", fromSlot).
		Distinct("slot").
		Count(&response.RecentSlotsAnalyzed).Error; err != nil {
		return response, fmt.Errorf("recent slot count failed: %w", err)
	}

	var writerRows []explorerWriterRollupRow
	if err := db.GetReadDB().Raw(`
		SELECT
			writer_id,
			MAX(rpc_endpoint) AS rpc_endpoint,
			MAX(slot) AS latest_slot,
			COUNT(*) AS attestation_count,
			COUNT(DISTINCT slot) AS slots_covered,
			MIN(attested_at) AS first_attested_at,
			MAX(attested_at) AS last_attested_at
		FROM explorer_block_attestations
		WHERE chain = ? AND slot >= ?
		GROUP BY writer_id
		ORDER BY slots_covered DESC, writer_id ASC
	`, "solana", fromSlot).Scan(&writerRows).Error; err != nil {
		return response, fmt.Errorf("writer rollup query failed: %w", err)
	}

	conflictsByWriter := make(map[string]int64)
	type conflictRow struct {
		WriterID         string
		ConflictingSlots int64
	}
	var conflictRows []conflictRow
	if err := db.GetReadDB().Raw(`
		WITH slot_majority AS (
			SELECT
				slot,
				block_hash,
				ROW_NUMBER() OVER (
					PARTITION BY slot
					ORDER BY COUNT(*) DESC, block_hash ASC
				) AS rn
			FROM explorer_block_attestations
			WHERE chain = ? AND slot >= ?
			GROUP BY slot, block_hash
		), canonical AS (
			SELECT slot, block_hash
			FROM slot_majority
			WHERE rn = 1
		)
		SELECT
			a.writer_id,
			COUNT(*) AS conflicting_slots
		FROM explorer_block_attestations a
		JOIN canonical c ON c.slot = a.slot
		WHERE a.chain = ? AND a.slot >= ? AND a.block_hash <> c.block_hash
		GROUP BY a.writer_id
	`, "solana", fromSlot, "solana", fromSlot).Scan(&conflictRows).Error; err != nil {
		return response, fmt.Errorf("writer conflict query failed: %w", err)
	}

	for _, row := range conflictRows {
		conflictsByWriter[row.WriterID] = row.ConflictingSlots
	}

	identityByWriter, err := loadLatestWriterIdentityEvidence(fromSlot)
	if err != nil {
		return response, err
	}

	response.Writers = buildWriterHealthRows(response, latestSlot, writerRows, conflictsByWriter, identityByWriter)
	return response, nil
}

func loadLatestWriterIdentityEvidence(fromSlot uint64) (map[string]explorerWriterIdentityEvidence, error) {
	var rows []explorerWriterIdentityEvidence
	if err := db.GetReadDB().Raw(`
		SELECT DISTINCT ON (writer_id)
			writer_id,
			chain,
			slot,
			block_hash,
			parent_hash,
			attested_at,
			writer_public_key,
			signature_scheme,
			attestation_signature
		FROM explorer_block_attestations
		WHERE chain = ? AND slot >= ?
		ORDER BY writer_id ASC, slot DESC, attested_at DESC
	`, "solana", fromSlot).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("writer identity query failed: %w", err)
	}

	out := make(map[string]explorerWriterIdentityEvidence, len(rows))
	for _, row := range rows {
		out[row.WriterID] = row
	}
	return out, nil
}

func buildWriterHealthRows(
	response ExplorerDecentralizationWritersResponse,
	latestSlot uint64,
	writerRows []explorerWriterRollupRow,
	conflictsByWriter map[string]int64,
	identityByWriter map[string]explorerWriterIdentityEvidence,
) []ExplorerWriterHealth {
	writers := make([]ExplorerWriterHealth, 0, len(writerRows))
	for _, row := range writerRows {
		evidence := identityByWriter[row.WriterID]

		health := ExplorerWriterHealth{
			WriterID:                row.WriterID,
			RPCEndpoint:             "", // redacted on public explorer (EXP-P0-05)
			WriterPublicKey:         evidence.WriterPublicKey,
			SignatureScheme:         evidence.SignatureScheme,
			HasAttestationSignature: strings.TrimSpace(evidence.AttestationSignature) != "",
			IdentityVerified:        verifyWriterIdentityEvidence(evidence),
			LatestSlot:              row.LatestSlot,
			AttestationCount:        row.AttestationCount,
			SlotsCovered:            row.SlotsCovered,
			ConflictingSlots:        conflictsByWriter[row.WriterID],
			FirstAttestedAt:         row.FirstAttestedAt,
			LastAttestedAt:          row.LastAttestedAt,
		}

		if latestSlot >= row.LatestSlot {
			health.LagSlots = latestSlot - row.LatestSlot
		}
		if response.RecentSlotsAnalyzed > 0 {
			health.ParticipationRatio = float64(row.SlotsCovered) / float64(response.RecentSlotsAnalyzed)
		}

		writers = append(writers, health)
	}
	return writers
}

func verifyWriterIdentityEvidence(evidence explorerWriterIdentityEvidence) bool {
	if strings.ToLower(strings.TrimSpace(evidence.SignatureScheme)) != "ed25519" {
		return false
	}

	pubKeyBytes, err := decodeAttestationIdentityBytes(evidence.WriterPublicKey)
	if err != nil || len(pubKeyBytes) != ed25519.PublicKeySize {
		return false
	}

	sigBytes, err := decodeAttestationIdentityBytes(evidence.AttestationSignature)
	if err != nil || len(sigBytes) != ed25519.SignatureSize {
		return false
	}

	payload := []byte(fmt.Sprintf(
		"%s|%d|%s|%s|%d|%s",
		evidence.Chain,
		evidence.Slot,
		evidence.BlockHash,
		evidence.ParentHash,
		evidence.AttestedAt.UTC().UnixNano(),
		evidence.WriterID,
	))

	return ed25519.Verify(ed25519.PublicKey(pubKeyBytes), payload, sigBytes)
}

func decodeAttestationIdentityBytes(raw string) ([]byte, error) {
	v := strings.TrimSpace(raw)
	if v == "" {
		return nil, fmt.Errorf("empty value")
	}

	if b, err := base64.StdEncoding.DecodeString(v); err == nil {
		return b, nil
	}
	if b, err := base64.RawStdEncoding.DecodeString(v); err == nil {
		return b, nil
	}
	if b, err := hex.DecodeString(v); err == nil {
		return b, nil
	}

	return nil, fmt.Errorf("unsupported encoding")
}

func explorerMinWritersRequired() int64 {
	const defaultMinWriters = int64(2)
	raw := os.Getenv("EXPLORER_MIN_WRITERS")
	if raw == "" {
		return defaultMinWriters
	}
	parsed, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || parsed < 1 {
		return defaultMinWriters
	}
	if parsed > 50 {
		return 50
	}
	return parsed
}

func classifyExplorerDecentralizationMode(uniqueWriters, minWriters, slotsAnalyzed, slotsMeetingQuorum, conflictingSlots int64) string {
	switch {
	case slotsAnalyzed == 0:
		return "bootstrap_no_attestations"
	case uniqueWriters < 2:
		return "centralized_single_writer"
	case uniqueWriters < minWriters:
		return "multi_writer_below_threshold"
	case conflictingSlots > 0:
		return "multi_writer_conflicting_views"
	case slotsMeetingQuorum < slotsAnalyzed:
		return "multi_writer_partial_quorum"
	default:
		return "multi_writer_quorum"
	}
}

// explorerNodeSearchPattern builds a safe ILIKE pattern for node list search (?q=).
func explorerNodeSearchPattern(q string) string {
	q = strings.ReplaceAll(q, `\`, `\\`)
	q = strings.ReplaceAll(q, `%`, `\%`)
	q = strings.ReplaceAll(q, `_`, `\_`)
	return "%" + q + "%"
}

// explorerSuccessRatePercent normalizes nodes.success_rate to API percent (0–100).
// Source rows use a 0–1 fraction; values already above 1 are treated as legacy percent.
func explorerSuccessRatePercent(raw float64) float64 {
	if raw <= 0 {
		return 0
	}
	if raw > 1 {
		if raw > 100 {
			return 100
		}
		return raw
	}
	return raw * 100
}

// publicNodeSummary maps an explorer node row to a public DTO without provider identity fields.
func publicNodeSummary(n models.ExplorerNode) NodeSummary {
	lat, lon, _ := publicMapCoords(0, 0, n.Country, "", "", "", "country")
	return NodeSummary{
		NodeID:         mapOpaqueID("node", n.NodeID),
		Name:           privacyNodeTitle("", n.Country, "proxy"),
		Chain:          n.Chain,
		Region:         "",
		Country:        n.Country,
		City:           "",
		ISP:            "",
		Latitude:       lat,
		Longitude:      lon,
		IsActive:       n.IsActive,
		IsValidator:    n.IsValidator,
		UptimePercent:  n.UptimePercent,
		ActiveSessions: 0,
		BandwidthGB:    0,
		LastHeartbeat:  n.LastHeartbeat,
	}
}

func isExplorerFullyDecentralized(resp ExplorerDecentralizationStatusResponse) bool {
	if resp.MinWritersRequired < 1 {
		return false
	}
	return resp.ExplorerMode == "multi_writer_quorum" &&
		resp.UniqueWriters >= resp.MinWritersRequired &&
		resp.ConflictingSlots == 0 &&
		resp.RecentSlotsAnalyzed > 0 &&
		resp.SlotsMeetingQuorum == resp.RecentSlotsAnalyzed
}

// explorerPublicSessionsEnabled gates the public sessions feed (EXP-P0-07).
// Default off: operational session lists are not exposed unless explicitly enabled.
func explorerPublicSessionsEnabled() bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("EXPLORER_PUBLIC_SESSIONS_ENABLED")))
	return raw == "1" || raw == "true" || raw == "yes"
}

func enforceExplorerPublicSessions() gin.HandlerFunc {
	return func(c *gin.Context) {
		if explorerPublicSessionsEnabled() {
			c.Next()
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
		c.Abort()
	}
}

// explorerPublicEarningsEnabled gates the public provider earnings feed (EXP-P0-07).
// Default off: aggregated payout data is not exposed unless explicitly enabled.
func explorerPublicEarningsEnabled() bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("EXPLORER_PUBLIC_EARNINGS_ENABLED")))
	return raw == "1" || raw == "true" || raw == "yes"
}

func enforceExplorerPublicEarnings() gin.HandlerFunc {
	return func(c *gin.Context) {
		if explorerPublicEarningsEnabled() {
			c.Next()
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
		c.Abort()
	}
}

// explorerPublicError logs internal details and returns a stable public message.
func explorerPublicError(c *gin.Context, status int, publicMessage string, err error) {
	if err != nil {
		logging.Error(err).Str("path", c.FullPath()).Msg(publicMessage)
	}
	c.JSON(status, gin.H{"error": publicMessage})
}

// cacheResponse caches a response in Redis
func cacheResponse(c *gin.Context, key string, data interface{}, ttl time.Duration) {
	if redisClient.Client == nil {
		return
	}

	jsonData, err := json.Marshal(data)
	if err != nil {
		logging.Error(err).Msg("[Explorer] Failed to marshal cache data")
		return
	}

	if err := redisClient.Client.Set(c, key, jsonData, ttl).Err(); err != nil {
		logging.Error(err).Msg("[Explorer] Failed to cache response")
	}
}

// invalidateExplorerCache deletes all Redis keys matching the given glob pattern.
func invalidateExplorerCache(pattern string) {
	if redisClient.Client == nil {
		return
	}

	ctx := context.Background()
	var cursor uint64
	var deleted int64
	for {
		keys, nextCursor, err := redisClient.Client.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			logging.Error(err).Str("pattern", pattern).Msg("[Explorer] Cache scan failed")
			return
		}
		if len(keys) > 0 {
			n, err := redisClient.Client.Del(ctx, keys...).Result()
			if err != nil {
				logging.Error(err).Msg("[Explorer] Cache delete failed")
			}
			deleted += n
		}
		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}
	logging.Debug().Str("pattern", pattern).Int64("deleted", deleted).Msg("[Explorer] Cache invalidated")
}

// ============================================================
// Analytics & Leaderboard Handlers
// ============================================================

type AnalyticsPoint struct {
	Timestamp time.Time `json:"timestamp"`
	Value     float64   `json:"value"`
}

type AnalyticsResponse struct {
	Period            string           `json:"period"`
	TransactionVolume []AnalyticsPoint `json:"transaction_volume"`
	BandwidthGB       []AnalyticsPoint `json:"bandwidth_gb"`
	ActiveNodes       []AnalyticsPoint `json:"active_nodes"`
	ActiveWallets     []AnalyticsPoint `json:"active_wallets"`
	MetricsAvailable  bool             `json:"metrics_available"`
	Message           string           `json:"message,omitempty"`
}

type ExplorerLeaderboardEntry struct {
	Rank           int     `json:"rank"`
	NodeID         string  `json:"node_id"`
	Name           string  `json:"name,omitempty"`
	Region         string  `json:"region"`
	Country        string  `json:"country"`
	UptimePercent  float64 `json:"uptime_percent"`
	BandwidthGB    float64 `json:"bandwidth_gb"`
	ActiveSessions int     `json:"active_sessions"`
	QualityScore   float64 `json:"quality_score"`
	IsValidator    bool    `json:"is_validator"`
}

type ExplorerLeaderboardResponse struct {
	Entries       []ExplorerLeaderboardEntry `json:"entries"`
	Category      string                     `json:"category"`
	Period        string                     `json:"period"`
	DataSource    string                     `json:"data_source"`    // "indexed_nodes"
	PeriodApplied bool                       `json:"period_applied"` // false until time-windowed MV exists
	Note          string                     `json:"note,omitempty"`
}

func getExplorerAnalytics(c *gin.Context) {
	period := c.DefaultQuery("period", "24h")
	fromStr := c.Query("from") // ISO date e.g. "2024-01-15"
	toStr := c.Query("to")     // ISO date e.g. "2024-01-31" (inclusive)

	// Parse custom date range when both params are present
	var useCustomRange bool
	var fromTime, toTime time.Time
	if fromStr != "" && toStr != "" {
		var err1, err2 error
		fromTime, err1 = time.Parse("2006-01-02", fromStr)
		toTime, err2 = time.Parse("2006-01-02", toStr)
		if err1 == nil && err2 == nil && !fromTime.After(toTime) {
			toTime = toTime.Add(24 * time.Hour) // make end date inclusive
			useCustomRange = true
		}
	}

	cacheKey := fmt.Sprintf("explorer:analytics:%s", period)
	if useCustomRange {
		cacheKey = fmt.Sprintf("explorer:analytics:custom:%s:%s", fromStr, toStr)
	}
	if redisClient.Client != nil {
		if cached, err := redisClient.Client.Get(c, cacheKey).Result(); err == nil && cached != "" {
			var response AnalyticsResponse
			if err := json.Unmarshal([]byte(cached), &response); err == nil {
				c.JSON(http.StatusOK, response)
				return
			}
		}
	}

	// Determine DB period string and bucket interval
	var dbPeriod string
	var bucketCount int
	if useCustomRange {
		rangeDays := int(toTime.Sub(fromTime).Hours() / 24)
		if rangeDays <= 2 {
			dbPeriod = "hourly"
		} else {
			dbPeriod = "daily"
		}
		bucketCount = 0 // no LIMIT when using a custom range
	} else {
		switch period {
		case "1h":
			dbPeriod = "hourly"
			bucketCount = 12
		case "7d":
			dbPeriod = "daily"
			bucketCount = 7
		case "30d":
			dbPeriod = "daily"
			bucketCount = 30
		default: // 24h
			dbPeriod = "hourly"
			bucketCount = 24
		}
	}

	var records []models.ExplorerMetrics
	query := db.GetReadDB().Where("chain = ? AND period = ?", "solana", dbPeriod)
	if useCustomRange {
		query = query.Where("period_start >= ? AND period_start < ?", fromTime, toTime)
	}
	query = query.Order("period_start DESC")
	if bucketCount > 0 {
		query = query.Limit(bucketCount)
	}
	query.Find(&records)

	// Reverse so oldest first (chronological order for charts)
	for i, j := 0, len(records)-1; i < j; i, j = i+1, j-1 {
		records[i], records[j] = records[j], records[i]
	}

	response := AnalyticsResponse{
		Period:            period,
		TransactionVolume: make([]AnalyticsPoint, 0, len(records)),
		BandwidthGB:       make([]AnalyticsPoint, 0, len(records)),
		ActiveNodes:       make([]AnalyticsPoint, 0, len(records)),
		ActiveWallets:     make([]AnalyticsPoint, 0, len(records)),
	}

	for _, r := range records {
		ts := r.PeriodStart
		response.TransactionVolume = append(response.TransactionVolume, AnalyticsPoint{Timestamp: ts, Value: r.TotalVolume})
		response.BandwidthGB = append(response.BandwidthGB, AnalyticsPoint{Timestamp: ts, Value: float64(r.TotalBandwidthBytes) / (1024 * 1024 * 1024)})
		response.ActiveNodes = append(response.ActiveNodes, AnalyticsPoint{Timestamp: ts, Value: float64(r.ActiveNodes)})
		response.ActiveWallets = append(response.ActiveWallets, AnalyticsPoint{Timestamp: ts, Value: float64(r.ActiveWallets)})
	}

	response.MetricsAvailable = len(records) > 0
	if !response.MetricsAvailable {
		response.Message = explorerMetricsUnavailableMessage(useCustomRange)
	}

	cacheResponse(c, cacheKey, response, 2*time.Minute)
	c.JSON(http.StatusOK, response)
}

func getExplorerLeaderboard(c *gin.Context) {
	category := c.DefaultQuery("category", "uptime")
	period := c.DefaultQuery("period", "24h")

	c.Header("Cache-Control", "no-store")

	const leaderboardLimit = 20
	since := explorerPeriodSince(period)

	var (
		entries       []ExplorerLeaderboardEntry
		dataSource    string
		periodApplied bool
		note          string
	)

	switch category {
	case "bandwidth":
		entries = explorerLeaderboardByPeriodBandwidth(since, leaderboardLimit)
		dataSource = "usage_records"
		periodApplied = true
	case "sessions":
		entries = explorerLeaderboardByPeriodSessions(since, leaderboardLimit)
		dataSource = "sessions"
		periodApplied = true
	default:
		var nodes []models.ExplorerNode
		explorerPrivacyQuery(db.DB.Model(&models.ExplorerNode{})).Where("is_active = ?", true).
			Order("uptime_percent DESC").
			Limit(leaderboardLimit).
			Find(&nodes)
		entries = explorerLeaderboardEntriesFromNodes(nodes)
		dataSource = "indexed_nodes"
		periodApplied = false
		note = "Uptime rankings use current indexed node counters. Bandwidth and sessions categories honor the selected period."
	}

	response := ExplorerLeaderboardResponse{
		Entries:       entries,
		Category:      category,
		Period:        period,
		DataSource:    dataSource,
		PeriodApplied: periodApplied,
		Note:          note,
	}

	c.JSON(http.StatusOK, response)
}

type explorerLeaderboardAggRow struct {
	NodeID string
	Score  int64
}

func explorerLeaderboardByPeriodBandwidth(since time.Time, limit int) []ExplorerLeaderboardEntry {
	var rows []explorerLeaderboardAggRow
	db.GetReadDB().Model(&models.UsageRecord{}).
		Select("node_id::text AS node_id, COALESCE(SUM(bytes_used), 0) AS score").
		Where("created_at >= ? AND node_id IS NOT NULL", since).
		Group("node_id").
		Order("score DESC").
		Limit(limit).
		Scan(&rows)
	return explorerLeaderboardEntriesFromAgg(rows, func(n models.ExplorerNode, score int64) ExplorerLeaderboardEntry {
		bwGB := float64(score) / (1024 * 1024 * 1024)
		return explorerLeaderboardEntryFromNode(n, bwGB, n.ActiveSessions)
	})
}

func explorerLeaderboardByPeriodSessions(since time.Time, limit int) []ExplorerLeaderboardEntry {
	var rows []explorerLeaderboardAggRow
	db.GetReadDB().Model(&models.Session{}).
		Select("node_id::text AS node_id, COUNT(*) AS score").
		Where("created_at >= ? AND node_id IS NOT NULL", since).
		Group("node_id").
		Order("score DESC").
		Limit(limit).
		Scan(&rows)
	return explorerLeaderboardEntriesFromAgg(rows, func(n models.ExplorerNode, score int64) ExplorerLeaderboardEntry {
		bwGB := float64(n.TotalBandwidth) / (1024 * 1024 * 1024)
		return explorerLeaderboardEntryFromNode(n, bwGB, int(score))
	})
}

func explorerLeaderboardEntriesFromAgg(
	rows []explorerLeaderboardAggRow,
	build func(models.ExplorerNode, int64) ExplorerLeaderboardEntry,
) []ExplorerLeaderboardEntry {
	if len(rows) == 0 {
		return nil
	}
	nodeIDs := make([]string, 0, len(rows))
	for _, r := range rows {
		if r.NodeID != "" {
			nodeIDs = append(nodeIDs, r.NodeID)
		}
	}
	var nodes []models.ExplorerNode
	explorerPrivacyQuery(db.DB.Model(&models.ExplorerNode{})).Where("node_id IN ?", nodeIDs).Find(&nodes)
	byID := make(map[string]models.ExplorerNode, len(nodes))
	for _, n := range nodes {
		byID[n.NodeID] = n
	}

	entries := make([]ExplorerLeaderboardEntry, 0, len(rows))
	rank := 1
	for _, row := range rows {
		n, ok := byID[row.NodeID]
		if !ok {
			continue
		}
		entry := build(n, row.Score)
		entry.Rank = rank
		entries = append(entries, entry)
		rank++
	}
	return entries
}

func explorerLeaderboardEntriesFromNodes(nodes []models.ExplorerNode) []ExplorerLeaderboardEntry {
	entries := make([]ExplorerLeaderboardEntry, 0, len(nodes))
	for i, n := range nodes {
		bwGB := float64(n.TotalBandwidth) / (1024 * 1024 * 1024)
		entry := explorerLeaderboardEntryFromNode(n, bwGB, n.ActiveSessions)
		entry.Rank = i + 1
		entries = append(entries, entry)
	}
	return entries
}

func explorerLeaderboardEntryFromNode(n models.ExplorerNode, bwGB float64, activeSessions int) ExplorerLeaderboardEntry {
	qualityScore := (n.UptimePercent * 0.5) + (float64(activeSessions) / 10.0 * 0.25) + (bwGB / 100.0 * 0.25)
	if qualityScore > 100 {
		qualityScore = 100
	}
	return ExplorerLeaderboardEntry{
		NodeID:         mapOpaqueID("node", n.NodeID),
		Name:           privacyNodeTitle("", n.Country, "proxy"),
		Region:         "",
		Country:        n.Country,
		UptimePercent:  n.UptimePercent,
		BandwidthGB:    bwGB,
		ActiveSessions: 0,
		QualityScore:   qualityScore,
		IsValidator:    n.IsValidator,
	}
}

// ============================================================
// Sessions Explorer
// ============================================================

type ExplorerSessionSummary struct {
	SessionID   string    `json:"session_id"`
	SessionType string    `json:"session_type"`
	Status      string    `json:"status"`
	BytesUsed   int64     `json:"bytes_used"`
	StartTime   time.Time `json:"start_time"`
	EndTime     time.Time `json:"end_time"`
}

type ExplorerSessionsResponse struct {
	Sessions    []ExplorerSessionSummary `json:"sessions"`
	Total       int64                    `json:"total"`
	ActiveCount int64                    `json:"active_count"`
	Page        int                      `json:"page"`
	PageSize    int                      `json:"page_size"`
}

func listExplorerSessions(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(410, gin.H{"error": "Individual traffic sessions are private. Use the authenticated sessions dashboard."})
}

// ============================================================
// Provider Earnings
// ============================================================

type ProviderEarningSummary struct {
	NodeID          string    `json:"node_id"`
	ProviderAddress string    `json:"provider_address"`
	SessionCount    int64     `json:"session_count"`
	BandwidthGB     float64   `json:"bandwidth_gb"`
	TotalEarned     float64   `json:"total_earned"`
	LastPayout      time.Time `json:"last_payout"`
}

type EarningsSummary struct {
	TotalPaid       float64 `json:"total_paid"`
	ActiveProviders int64   `json:"active_providers"`
	AvgEarning      float64 `json:"avg_earning"`
	TxCount         int64   `json:"tx_count"`
}

type ProviderEarningsResponse struct {
	Providers   []ProviderEarningSummary `json:"providers"`
	Total       int64                    `json:"total"`
	Summary     EarningsSummary          `json:"summary"`
	VolumeChart []AnalyticsPoint         `json:"volume_chart"`
	Page        int                      `json:"page"`
	PageSize    int                      `json:"page_size"`
}

func getExplorerProviderEarnings(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(410, gin.H{"error": "Individual provider earnings are private. Use the authenticated earnings dashboard."})
}

type HealthHistoryPoint struct {
	Timestamp     time.Time `json:"timestamp"`
	Status        string    `json:"status"`
	ActiveNodes   int64     `json:"active_nodes"`
	AvgResponseMs float64   `json:"avg_response_ms"`
}

type HealthEvent struct {
	Timestamp time.Time `json:"timestamp"`
	Status    string    `json:"status"`
	Subsystem string    `json:"subsystem"`
	Message   string    `json:"message"`
}

type HealthHistoryResponse struct {
	History          []HealthHistoryPoint `json:"history"`
	UptimePercent    float64              `json:"uptime_percent"`
	Events           []HealthEvent        `json:"events"`
	MetricsAvailable bool                 `json:"metrics_available"`
	Message          string               `json:"message,omitempty"`
}

func getHealthHistory(c *gin.Context) {
	period := c.DefaultQuery("period", "24h")

	cacheKey := fmt.Sprintf("explorer:health:history:%s", period)
	if redisClient.Client != nil {
		if cached, err := redisClient.Client.Get(c, cacheKey).Result(); err == nil && cached != "" {
			var response HealthHistoryResponse
			if err := json.Unmarshal([]byte(cached), &response); err == nil {
				c.JSON(http.StatusOK, response)
				return
			}
		}
	}

	var dbPeriod string
	var bucketCount int
	switch period {
	case "7d":
		dbPeriod = "daily"
		bucketCount = 7
	case "30d":
		dbPeriod = "daily"
		bucketCount = 30
	default:
		dbPeriod = "hourly"
		bucketCount = 24
	}

	var records []models.ExplorerMetrics
	db.GetReadDB().Where("chain = ? AND period = ?", "solana", dbPeriod).
		Order("period_start DESC").Limit(bucketCount).Find(&records)
	for i, j := 0, len(records)-1; i < j; i, j = i+1, j-1 {
		records[i], records[j] = records[j], records[i]
	}

	history := make([]HealthHistoryPoint, 0, len(records))
	healthyCount := 0
	for _, r := range records {
		status := "healthy"
		if r.ActiveNodes == 0 {
			status = "degraded"
		}
		if status == "healthy" {
			healthyCount++
		}
		history = append(history, HealthHistoryPoint{
			Timestamp:   r.PeriodStart,
			Status:      status,
			ActiveNodes: int64(r.ActiveNodes),
		})
	}

	uptimePct := 0.0
	if len(records) > 0 {
		uptimePct = float64(healthyCount) / float64(len(records)) * 100
	}

	response := HealthHistoryResponse{
		History:       history,
		UptimePercent: uptimePct,
		Events:        []HealthEvent{},
	}
	response.MetricsAvailable = len(records) > 0
	if !response.MetricsAvailable {
		response.Message = explorerMetricsUnavailableMessage(false)
	}

	cacheResponse(c, cacheKey, response, 2*time.Minute)
	c.JSON(http.StatusOK, response)
}

func explorerMetricsAggregatorEnabled() bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("EXPLORER_METRICS_ENABLED")))
	return raw != "false" && raw != "0" && raw != "no"
}

func explorerTimeSeriesAvailable(chain string) bool {
	var count int64
	db.GetReadDB().Model(&models.ExplorerMetrics{}).
		Where("chain = ? AND period IN ?", chain, []string{"hourly", "daily"}).
		Count(&count)
	return count > 0
}

func explorerMetricsResponseExtras(chain string) (timeSeriesAvailable, aggregatorEnabled bool) {
	return explorerTimeSeriesAvailable(chain), explorerMetricsAggregatorEnabled()
}

func explorerMetricsUnavailableMessage(customRange bool) string {
	if customRange {
		return "No aggregated metrics exist for the selected date range. Try a wider range or wait for the metrics job to backfill."
	}
	return "Time-series metrics are not available yet. The metrics aggregator runs periodically; charts populate after indexing activity exists."
}

func explorerNotFound(c *gin.Context, message string) {
	c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": message})
}
