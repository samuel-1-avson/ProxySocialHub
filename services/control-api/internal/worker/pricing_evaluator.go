package worker

import (
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// PricingEvaluator runs periodically to evaluate and update the dynamic pricing tiers of proxy nodes.
//
// Tier thresholds based on Quality Score (0-100):
//
//	Bronze: 0 - 69   (Base price: $0.20/GB)
//	Silver: 70 - 89  (Base price: $1.00/GB)
//	Gold:   90+      (Base price: $2.50/GB)
type PricingEvaluator struct{}

// StartPricingEvaluator starts a background goroutine that evaluates node pricing tiers every 15 minutes.
func StartPricingEvaluator() {
	go func() {
		log.Println("Pricing Evaluator started — running immediately then every 15 minutes")
		runPricingEvaluation()

		ticker := time.NewTicker(15 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			runPricingEvaluation()
		}
	}()
}

// computeDynamicPricingTier calculates the score and assigns the tier and price.
func computeDynamicPricingTier(node models.Node) (score float64, tier string, price float64) {
	// Re-use the existing formula from models/node.go
	score = node.CalculateQualityScore()

	if score >= 90 {
		return score, "Gold", 2.50
	} else if score >= 70 {
		return score, "Silver", 1.00
	} else {
		return score, "Bronze", 0.20
	}
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

			// P2-A10: Update linked marketplace listings for this provider
			// If a provider has multiple nodes, we update their listings with the aggregate performance
			// of their active infrastructure.
			if node.ProviderUserID != uuid.Nil {
				var avgScore float64
				db.DB.Model(&models.Node{}).
					Where("provider_user_id = ? AND is_healthy = ?", node.ProviderUserID, true).
					Select("AVG(quality_score)").
					Scan(&avgScore)

				// Map avg score to a tier for the listing
				_, tier, _ := computeDynamicPricingTier(models.Node{QualityScore: avgScore})

				db.DB.Model(&models.ProxyListing{}).
					Where("seller_id = ? AND status = ?", node.ProviderUserID, models.ListingStatusActive).
					Updates(map[string]interface{}{
						"quality_score": avgScore,
						"current_tier":  tier,
					})
			}
			updated++
		}
	}

	log.Printf("Pricing Evaluator: updated pricing/tiers for %d/%d nodes", updated, len(nodes))
}
