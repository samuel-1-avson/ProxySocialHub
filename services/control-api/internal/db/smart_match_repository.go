package db

import (
	"context"
	"math"

	"github.com/proxyhubb/control-api/internal/models"
)

// SmartMatchRepository handles smart-match queries against proxy_listings and provider_nodes.
type SmartMatchRepository struct{}

// NewSmartMatchRepository creates a SmartMatchRepository.
func NewSmartMatchRepository() *SmartMatchRepository {
	return &SmartMatchRepository{}
}

// FindProvidersRequest carries the filters for smart provider selection.
type FindProvidersRequest struct {
	GeoCountry       string
	MaxPricePerGB    float64
	MinUptimePercent float64
	MaxLatencyMs     int
	RequiredTier     string // empty = any tier
	SessionType      string
	Limit            int
}

// ScoredListing is a proxy listing enriched with provider node metrics and a match score.
type ScoredListing struct {
	models.ProxyListing
	ProviderTier  string  `json:"provider_tier"`
	UptimePercent float64 `json:"uptime_percent"`
	AvgLatencyMs  int     `json:"avg_latency_ms"`
	MatchScore    float64 `json:"match_score"` // 0–100
}

// tierRank maps tier names to a numeric rank used for filtering and scoring.
var tierRank = map[string]int{
	"unverified": 0,
	"basic":      1,
	"verified":   2,
	"premium":    3,
	"enterprise": 4,
}

// rawRow is used to scan the raw SQL results.
type rawRow struct {
	// proxy_listings columns
	models.ProxyListing

	// provider_nodes columns (aliased)
	NodeTier            string  `gorm:"column:node_tier"`
	NodeUptimePercent   float64 `gorm:"column:node_uptime_percent"`
	NodeAvgLatencyMs    int     `gorm:"column:node_avg_latency_ms"`
	NodeTotalSessions   int     `gorm:"column:node_total_sessions"`
}

// FindBestProviders returns the top N listings scored by the smart match algorithm.
// Scoring: latency(30%) + uptime(25%) + price(20%) + tier(15%) + experience(10%)
func (r *SmartMatchRepository) FindBestProviders(ctx context.Context, req FindProvidersRequest) ([]ScoredListing, error) {
	if req.Limit <= 0 {
		req.Limit = 10
	}

	// Build base query joining proxy_listings with provider_nodes
	query := DB.WithContext(ctx).
		Table("proxy_listings").
		Select(`
			proxy_listings.*,
			COALESCE(pn.tier, 'unverified') AS node_tier,
			COALESCE(pn.uptime_percent, 0)  AS node_uptime_percent,
			COALESCE(pn.avg_latency_ms, 0)  AS node_avg_latency_ms,
			COALESCE(pn.total_sessions_served, 0) AS node_total_sessions
		`).
		Joins("LEFT JOIN provider_nodes pn ON pn.user_id = proxy_listings.seller_id").
		Where("proxy_listings.status = ?", models.ListingStatusActive)

	// Geo filter
	if req.GeoCountry != "" {
		query = query.Where(models.ListingCountrySQL+" = ?", req.GeoCountry)
	}

	// Price filter (price_per_gb)
	if req.MaxPricePerGB > 0 {
		query = query.Where("proxy_listings.price_per_gb <= ?", req.MaxPricePerGB)
	}

	// Uptime filter (from provider_nodes)
	if req.MinUptimePercent > 0 {
		query = query.Where("COALESCE(pn.uptime_percent, 0) >= ?", req.MinUptimePercent)
	}

	// Latency filter (from provider_nodes)
	if req.MaxLatencyMs > 0 {
		query = query.Where("COALESCE(pn.avg_latency_ms, 0) <= ?", req.MaxLatencyMs)
	}

	// Tier filter: required tier rank >= specified rank
	if req.RequiredTier != "" {
		minRank, ok := tierRank[req.RequiredTier]
		if ok && minRank > 0 {
			// Build CASE expression for tier ordering
			query = query.Where(`
				CASE COALESCE(pn.tier, 'unverified')
					WHEN 'enterprise'  THEN 4
					WHEN 'premium'     THEN 3
					WHEN 'verified'    THEN 2
					WHEN 'basic'       THEN 1
					ELSE 0
				END >= ?`, minRank)
		}
	}

	// Session type filter (rotation_type on proxy_listings)
	if req.SessionType != "" {
		query = query.Where("proxy_listings.rotation_type = ?", req.SessionType)
	}

	// Fetch a larger pool to score and sort in Go (avoids complex SQL scoring)
	var rows []rawRow
	if err := query.Limit(req.Limit * 5).Scan(&rows).Error; err != nil {
		return nil, err
	}

	// Score each row
	scored := make([]ScoredListing, 0, len(rows))
	for _, row := range rows {
		score := computeMatchScore(
			row.NodeAvgLatencyMs,
			row.NodeUptimePercent,
			row.ProxyListing.PricePerGB,
			row.NodeTier,
			row.NodeTotalSessions,
		)

		scored = append(scored, ScoredListing{
			ProxyListing:  row.ProxyListing,
			ProviderTier:  row.NodeTier,
			UptimePercent: row.NodeUptimePercent,
			AvgLatencyMs:  row.NodeAvgLatencyMs,
			MatchScore:    score,
		})
	}

	// Sort by score descending (simple insertion sort for small N)
	for i := 1; i < len(scored); i++ {
		for j := i; j > 0 && scored[j].MatchScore > scored[j-1].MatchScore; j-- {
			scored[j], scored[j-1] = scored[j-1], scored[j]
		}
	}

	// Trim to requested limit
	if len(scored) > req.Limit {
		scored = scored[:req.Limit]
	}

	return scored, nil
}

// computeMatchScore calculates a 0-100 match score using the weighted formula.
// latency(30%) + uptime(25%) + price(20%) + tier(15%) + experience(10%)
func computeMatchScore(avgLatencyMs int, uptimePct float64, pricePerGB float64, tier string, totalSessions int) float64 {
	// Latency score: max(0, 1 - latency/1000) * 30
	latencyScore := math.Max(0, 1.0-float64(avgLatencyMs)/1000.0) * 30.0

	// Uptime score: (uptime/100) * 25
	uptimeScore := (uptimePct / 100.0) * 25.0

	// Price score: (1 - min(price, 10)/10) * 20  — lower price = higher score
	priceScore := (1.0 - math.Min(pricePerGB, 10.0)/10.0) * 20.0

	// Tier score: (rank/4) * 15
	rank := float64(tierRank[tier]) // defaults to 0 if not found
	tierScore := (rank / 4.0) * 15.0

	// Experience score: min(sessions, 1000)/1000 * 10
	sessionScore := math.Min(float64(totalSessions), 1000.0) / 1000.0 * 10.0

	total := latencyScore + uptimeScore + priceScore + tierScore + sessionScore

	// Clamp to [0, 100]
	if total < 0 {
		total = 0
	}
	if total > 100 {
		total = 100
	}
	return total
}
