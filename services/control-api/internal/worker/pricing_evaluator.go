package worker

import (
	"log"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/quality"
)

// PricingEvaluator runs periodically to evaluate and update the dynamic pricing tiers of proxy nodes.
//
// Tier thresholds based on Quality Score (0-100), USD/GB guidance for nodes:
//
//	Bronze: 0 - 69   (Base price: $0.792/GB)
//	Silver: 70 - 89  (Base price: $0.99/GB)
//	Gold:   90+      (Base price: $1.188/GB)
type PricingEvaluator struct{}

// StartPricingEvaluator starts a background goroutine that evaluates node pricing tiers every 15 minutes.
func StartPricingEvaluator() {
	GoSupervised("PricingEvaluator", 5*time.Second, func() {
		log.Println("Pricing Evaluator started — running immediately then every 15 minutes")
		RunSafely("PricingEvaluator.initial", runPricingEvaluation)

		ticker := time.NewTicker(15 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			RunSafely("PricingEvaluator.cycle", runPricingEvaluation)
		}
	})
}

// computeDynamicPricingTier calculates the score and assigns the tier and price.
func computeDynamicPricingTier(node models.Node) (score float64, tier string, price float64) {
	// Re-use the existing formula from models/node.go
	score = node.CalculateQualityScore()

	proxyType := node.ConnectionType
	if quality.BasePrice(proxyType) == 0 {
		proxyType = "residential"
	}
	return score, quality.Tier(score), quality.PriceForScore(proxyType, score)
}

// runPricingEvaluation queries all active nodes and updates their quality score, tier, and price.
func runPricingEvaluation() {
	if db.DB == nil {
		log.Println("Pricing Evaluator: DB not available, skipping")
		return
	}

	var nodes []models.Node
	// We only evaluate active/healthy nodes or nodes seen recently
	if err := db.DB.Where("is_healthy = ?", true).Find(&nodes).Error; err != nil {
		log.Printf("Pricing Evaluator: failed to fetch nodes: %v", err)
		return
	}

	log.Printf("Pricing Evaluator: evaluating %d nodes", len(nodes))

	updated := 0
	for _, node := range nodes {
		score, tier, price := computeDynamicPricingTier(node)

		// Only update if something changed
		if node.QualityScore != score || node.CurrentTier != tier || node.BasePricePerGB != price {
			updates := map[string]interface{}{
				"quality_score":     score,
				"current_tier":      tier,
				"base_price_per_gb": price,
			}

			if err := db.DB.Model(&models.Node{}).Where("id = ?", node.ID).Updates(updates).Error; err != nil {
				log.Printf("Pricing Evaluator: failed to update node %s: %v", node.ID, err)
				continue
			}

			// Legacy hints are scoped to the actual node. Assessed offers retain
			// their evidence-backed score and provider-accepted price.
			if node.ProviderNodeID != nil {
				db.DB.Model(&models.ProxyListing{}).
					Where("provider_node_id = ? AND quality_assessment_id IS NULL AND status = ?", *node.ProviderNodeID, models.ListingStatusActive).
					Updates(map[string]interface{}{"quality_score": score, "current_tier": quality.Tier(score)})
			}
			updated++
		}
	}

	log.Printf("Pricing Evaluator: updated pricing/tiers for %d/%d nodes", updated, len(nodes))
}
