package matching

import (
	"math"
	"sort"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// Matcher handles the logic for finding best proxy matches
type Matcher struct{}

func NewMatcher() *Matcher {
	return &Matcher{}
}

// GetProfiles returns the configuration for all supported use cases
func (m *Matcher) GetProfiles() map[UseCaseType]UseCaseProfile {
	return map[UseCaseType]UseCaseProfile{
		UseCaseGeneral: {
			Name:             "General Browsing",
			Description:      "Balanced performance for everyday tasks.",
			WeightLatency:    0.3,
			WeightUptime:     0.3,
			WeightBandwidth:  0.2,
			WeightTrustScore: 0.2,
		},
		UseCaseStreaming: {
			Name:             "Streaming & Media",
			Description:      "Optimized for high bandwidth and stable connections.",
			WeightLatency:    0.2,
			WeightUptime:     0.3,
			WeightBandwidth:  0.4, // Critical for 4k/HD
			WeightTrustScore: 0.1,
		},
		UseCaseGaming: {
			Name:             "Gaming",
			Description:      "Ultra-low latency focus for responsive gameplay.",
			WeightLatency:    0.6, // Critical
			WeightUptime:     0.2,
			WeightBandwidth:  0.1,
			WeightTrustScore: 0.1,
		},
		UseCaseScraping: {
			Name:             "Data Scraping",
			Description:      "High trust and reliability for accessing protected sites.",
			WeightLatency:    0.1,
			WeightUptime:     0.4,
			WeightBandwidth:  0.1,
			WeightTrustScore: 0.4, // Avoid blocks
		},
		UseCasePrivacy: {
			Name:             "Maximum Privacy",
			Description:      "Focus on high-trust nodes with strong reputation.",
			WeightLatency:    0.1,
			WeightUptime:     0.2,
			WeightBandwidth:  0.1,
			WeightTrustScore: 0.6,
		},
	}
}

// Recommend finds the best listings for a given request
func (m *Matcher) Recommend(req RecommendationRequest) ([]ScoredNode, error) {
	// 1. Fetch Candidate Listings
	var listings []models.ProxyListing
	query := db.DB.Where("status = ?", models.ListingStatusActive)

	if req.Region != "" {
		query = query.Where("country = ? OR isp = ?", req.Region, req.Region)
	}

	if req.MaxPrice > 0 {
		query = query.Where("price_per_gb <= ?", req.MaxPrice)
	}

	if err := query.Find(&listings).Error; err != nil {
		return nil, err
	}

	// 2. Get Profile Weights
	profiles := m.GetProfiles()
	profile, exists := profiles[req.UseCase]
	if !exists {
		profile = profiles[UseCaseGeneral]
	}

	// 3. Score Each Listing
	var scoredNodes []ScoredNode

	for _, listing := range listings {
		score := 50.0 // Baseline score
		var reasons []string

		// Latency Score (Lower is better)
		if listing.AvgLatencyMs > 0 {
			latencyScore := math.Max(0, 1.0-(float64(listing.AvgLatencyMs)/500.0))
			score += (latencyScore - 0.5) * profile.WeightLatency * 100
		}

		// Uptime Score (Higher is better)
		uptimeScore := listing.UptimePercent / 100.0
		score += (uptimeScore - 0.5) * profile.WeightUptime * 100

		// Trust Score (Higher is better)
		trustScore := listing.QualityScore / 100.0
		score += (trustScore - 0.5) * profile.WeightTrustScore * 100

		// Bonus for Verified Seller
		if listing.SellerID != uuid.Nil {
			// Optimization: Preload sellers or cache verification status
			// For now, we assume quality_score reflects it
		}

		scoredNodes = append(scoredNodes, ScoredNode{
			Listing: listing,
			Score:   math.Min(100, math.Max(0, score)),
			Reason:  reasons,
		})
	}

	// 4. Sort by Score (Desc)
	sort.Slice(scoredNodes, func(i, j int) bool {
		return scoredNodes[i].Score > scoredNodes[j].Score
	})

	// 5. Limit Results
	if req.Count <= 0 {
		req.Count = 5
	}
	if len(scoredNodes) > req.Count {
		scoredNodes = scoredNodes[:req.Count]
	}

	return scoredNodes, nil
}
