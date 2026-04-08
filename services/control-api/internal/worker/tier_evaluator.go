package worker

import (
	"fmt"
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
//	verified:   tier_score 50-74, uptime >= 95%, sessions >= 100
//	premium:    tier_score 75-89, uptime >= 98%, sessions >= 500, disputes == 0
//	enterprise: tier_score >= 90, uptime >= 99%, sessions >= 2000, disputes == 0
type TierEvaluator struct{}

// StartTierEvaluator starts a background goroutine that evaluates provider tiers every hour.
func StartTierEvaluator() {
	GoSupervised("TierEvaluator", 5*time.Second, func() {
		log.Println("Tier Evaluator started — running immediately then every hour")
		RunSafely("TierEvaluator.initial", runTierEvaluation)

		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			RunSafely("TierEvaluator.cycle", runTierEvaluation)
		}
	})
}

// computeTierScore calculates a tier score (0–100) for a provider node using the formula:
//
//	uptime component:   uptime_percent * 0.4                    → max 40
//	session component:  min(sessions, 2000) / 2000.0 * 40      → max 40  (P1-21: was *30, max was 80 total)
//	latency component:  20 if avg_latency_ms < 100,
//	                    10 if < 250, 0 otherwise                → max 20  (P1-21: was 10/5)
//	dispute penalty:   -10 per dispute, capped at -30
//
// Maximum achievable score with perfect metrics: 40 + 40 + 20 = 100.
// Enterprise tier (score >= 90) now requires near-perfect uptime, session count, and latency.
func computeTierScore(node models.ProviderNode) float64 {
	uptimeComponent := node.UptimePercent * 0.4

	sessionCap := math.Min(float64(node.TotalSessionsServed), 2000.0)
	sessionComponent := (sessionCap / 2000.0) * 40.0 // P1-21: increased from 30 so max total reaches 100

	disputePenalty := float64(node.DisputeCount) * 10.0
	if disputePenalty > 30.0 {
		disputePenalty = 30.0
	}

	latencyScore := 0.0
	if node.AvgLatencyMs > 0 {
		if node.AvgLatencyMs < 100 {
			latencyScore = 20.0 // P1-21: increased from 10 so max total reaches 100
		} else if node.AvgLatencyMs < 250 {
			latencyScore = 10.0 // P1-21: increased from 5
		}
	}

	score := uptimeComponent + sessionComponent - disputePenalty + latencyScore
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	return score
}

// assignRawTier determines the tier purely from score and metrics, without grace-period logic.
func assignRawTier(node models.ProviderNode, score float64) string {
	switch {
	case score >= 90 && node.UptimePercent >= 99 && node.TotalSessionsServed >= 2000 && node.DisputeCount == 0:
		return "enterprise"
	case score >= 75 && node.UptimePercent >= 98 && node.TotalSessionsServed >= 500 && node.DisputeCount == 0:
		return "premium"
	case score >= 50 && node.UptimePercent >= 95 && node.TotalSessionsServed >= 100:
		return "verified"
	case score >= 20 && node.UptimePercent >= 90:
		return "basic"
	default:
		return "unverified"
	}
}

// tierRank maps tier names to numeric rank for comparison.
func tierRank(tier string) int {
	switch tier {
	case "enterprise":
		return 4
	case "premium":
		return 3
	case "verified":
		return 2
	case "basic":
		return 1
	default:
		return 0
	}
}

// assignTierWithGrace applies a 2-evaluation grace period before demoting a provider.
// A provider must fail the threshold on 2 consecutive evaluations before being demoted.
// Returns the tier to apply and the updated demotion_warnings value.
func assignTierWithGrace(node models.ProviderNode, score float64) (tier string, demotionWarnings int) {
	rawTier := assignRawTier(node, score)
	currentRank := tierRank(node.Tier)
	newRank := tierRank(rawTier)

	if newRank < currentRank {
		// This is a demotion — apply grace period
		if node.DemotionWarnings < 2 {
			// Give the provider another chance; keep current tier
			return node.Tier, node.DemotionWarnings + 1
		}
		// Two consecutive failures — actually demote, reset counter
		return rawTier, 0
	}

	// Promotion or same tier — reset any pending demotion counter
	return rawTier, 0
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
		tier, demotionWarnings := assignTierWithGrace(node, score)

		updates := map[string]interface{}{
			"tier_score":        score,
			"tier":              tier,
			"demotion_warnings": demotionWarnings,
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

		// Notify provider if tier actually changed
		if tier != node.Tier {
			capturedNode := node
			capturedFromTier := node.Tier
			capturedToTier := tier
			Go("TierEvaluator.notifyTierChange", func() {
				notifyTierChange(capturedNode, capturedFromTier, capturedToTier)
			})
		}
	}

	log.Printf("Tier Evaluator: updated tiers for %d/%d nodes", updated, len(nodes))
}

// notifyTierChange inserts an in-app notification for the provider when their tier changes.
func notifyTierChange(node models.ProviderNode, fromTier, toTier string) {
	if db.DB == nil {
		return
	}

	promoted := tierRank(toTier) > tierRank(fromTier)
	title := fmt.Sprintf("Provider Tier Changed: %s", toTier)
	var message string
	if promoted {
		message = fmt.Sprintf("Congratulations! Your node '%s' has been promoted from %s to %s tier.", node.Name, fromTier, toTier)
	} else {
		message = fmt.Sprintf("Your node '%s' has been moved from %s to %s tier. Improve uptime and sessions to regain your tier.", node.Name, fromTier, toTier)
	}

	notification := models.Notification{
		UserID: node.UserID,
		Type:   models.NotificationTrustTierChange,
		Title:  title,
		Body:   message,
	}

	if err := notification.CreateDeduped(db.DB); err != nil {
		log.Printf("Tier Evaluator: failed to create tier-change notification for user %s: %v", node.UserID, err)
	}
}
