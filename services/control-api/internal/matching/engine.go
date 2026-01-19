package matching

import (
	"math"
	"sort"

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

// Recommend finds the best nodes for a given request
func (m *Matcher) Recommend(req RecommendationRequest) ([]ScoredNode, error) {
	// 1. Fetch Candidate Nodes
	var nodes []models.ProviderNode
	query := db.DB.Where("status = ?", models.NodeOnline)

	if req.Region != "" {
		// Simple region matching - in production use GeoIP distance
		query = query.Where("country = ? OR city = ?", req.Region, req.Region)
	}

	if err := query.Find(&nodes).Error; err != nil {
		return nil, err
	}

	// 2. Get Profile Weights
	profiles := m.GetProfiles()
	profile, exists := profiles[req.UseCase]
	if !exists {
		profile = profiles[UseCaseGeneral]
	}

	// 3. Score Each Node
	var scoredNodes []ScoredNode

	// Pre-calculate max values for normalization
	// We use fixed realistic baselines to avoid skewing by outliers
	const (
		MaxReasonableLatency   = 500.0  // ms
		MaxReasonableBandwidth = 1000.0 // Mbps
	)

	for _, node := range nodes {
		score := 0.0
		var reasons []string

		// Latency Score (Lower is better)
		// Get latency from recent uptime checks or use a default if no checks yet
		// For MVP we assume node.Status stores last check stats or we perform a join.
		// Since we don't have direct latency in ProviderNode struct yet (it's in UptimeChecks),
		// we will assume a mock or fetch it.
		// TODO: Add AvgLatency to ProviderNode model for caching
		latency := 100.0 // Default mock

		latencyScore := math.Max(0, 1.0-(latency/MaxReasonableLatency))
		score += latencyScore * profile.WeightLatency

		// Uptime Score (Higher is better)
		// Assume node has UptimePercentage logic or field.
		// For now using placeholder 0.99
		uptime := 0.99
		score += uptime * profile.WeightUptime

		// Bandwidth Score (Higher is better)
		// Parse "100 Mbps" logic... for now assume 100.
		bandwidth := 100.0
		bwScore := math.Min(1.0, bandwidth/MaxReasonableBandwidth)
		score += bwScore * profile.WeightBandwidth

		// Trust Score (Higher is better)
		// From Bittensor validation
		trust := node.QualityScore / 100.0
		score += trust * profile.WeightTrustScore

		scoredNodes = append(scoredNodes, ScoredNode{
			Node:   node,
			Score:  score * 100, // Scale to 0-100
			Reason: reasons,
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
