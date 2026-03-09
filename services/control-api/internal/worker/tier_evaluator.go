package worker

import (
	"log"
	"math"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// TierEvaluator runs periodically to evaluate and update provider verification tiers.
//
// Tier thresholds:
//
//	unverified: tier_score < 20
//	basic:      tier_score 20-49, uptime >= 90%
//	verified:   tier_score 50-74, uptime >= 95%, sessions >= 100, kyc_verified = true
//	premium:    tier_score 75-89, uptime >= 98%, sessions >= 500, disputes == 0
//	enterprise: tier_score >= 90, uptime >= 99%, sessions >= 2000, disputes == 0, kyc_verified = true
type TierEvaluator struct{}

// StartTierEvaluator starts a background goroutine that evaluates provider tiers every hour.
func StartTierEvaluator() {
	go func() {
		log.Println("Tier Evaluator started — running immediately then every hour")
		runTierEvaluation()

		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			runTierEvaluation()
		}
	}()
}

// computeTierScore calculates a tier score (0–100) for a provider node using the formula:
//
//	(uptime_percent * 0.4)
//	+ (min(total_sessions_served, 2000) / 2000.0 * 30)
//	+ (kyc_bonus: 20 if kyc_verified)
//	+ (dispute_penalty: -10 per dispute, max -30)
//	+ (latency_score: 10 if avg_latency_ms < 100, 5 if < 250, 0 otherwise)
func computeTierScore(node models.ProviderNode) float64 {
	uptimeComponent := node.UptimePercent * 0.4

	sessionCap := math.Min(float64(node.TotalSessionsServed), 2000.0)
	sessionComponent := (sessionCap / 2000.0) * 30.0

	kycBonus := 0.0
	if node.KYCVerified {
		kycBonus = 20.0
	}

	disputePenalty := float64(node.DisputeCount) * 10.0
	if disputePenalty > 30.0 {
		disputePenalty = 30.0
	}

	latencyScore := 0.0
	if node.AvgLatencyMs > 0 {
		if node.AvgLatencyMs < 100 {
			latencyScore = 10.0
		} else if node.AvgLatencyMs < 250 {
			latencyScore = 5.0
		}
	}

	score := uptimeComponent + sessionComponent + kycBonus - disputePenalty + latencyScore
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	return score
}

// assignTier determines the verification tier based on score and node metrics.
func assignTier(node models.ProviderNode, score float64) string {
	switch {
	case score >= 90 && node.UptimePercent >= 99 && node.TotalSessionsServed >= 2000 && node.DisputeCount == 0 && node.KYCVerified:
		return "enterprise"
	case score >= 75 && node.UptimePercent >= 98 && node.TotalSessionsServed >= 500 && node.DisputeCount == 0:
		return "premium"
	case score >= 50 && node.UptimePercent >= 95 && node.TotalSessionsServed >= 100 && node.KYCVerified:
		return "verified"
	case score >= 20 && node.UptimePercent >= 90:
		return "basic"
	default:
		return "unverified"
	}
}

// runTierEvaluation queries all provider nodes and updates their tier and tier_score.
func runTierEvaluation() {
	if db.DB == nil {
		log.Println("Tier Evaluator: DB not available, skipping")
		return
	}

	var nodes []models.ProviderNode
	if err := db.DB.Find(&nodes).Error; err != nil {
		log.Printf("Tier Evaluator: failed to fetch provider nodes: %v", err)
		return
	}

	log.Printf("Tier Evaluator: evaluating %d provider nodes", len(nodes))

	now := time.Now()
	updated := 0
	for _, node := range nodes {
		score := computeTierScore(node)
		tier := assignTier(node, score)

		updates := map[string]interface{}{
			"tier_score": score,
			"tier":       tier,
		}

		// Record tier_verified_at when first leaving unverified
		if tier != "unverified" && node.TierVerifiedAt == nil {
			updates["tier_verified_at"] = now
		}

		if err := db.DB.Model(&models.ProviderNode{}).Where("id = ?", node.ID).Updates(updates).Error; err != nil {
			log.Printf("Tier Evaluator: failed to update node %s: %v", node.ID, err)
			continue
		}
		updated++
	}

	log.Printf("Tier Evaluator: updated tiers for %d/%d nodes", updated, len(nodes))
}
