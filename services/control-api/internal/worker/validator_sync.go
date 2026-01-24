package worker

import (
	"time"

	"github.com/proxyhubb/control-api/internal/bittensor"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

// StartValidatorSync starts the background job to sync validator scores
func StartValidatorSync(client *bittensor.Client, netUID int) {
	if client == nil {
		logging.Warn().Msg("ValidatorSync: Bittensor client nil, skipping sync")
		return
	}

	go func() {
		logging.Info().Int("netuid", netUID).Msg("ValidatorSync: Started background validator sync loop")
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		for range ticker.C {
			syncScores(client, netUID)
		}
	}()
}

func syncScores(client *bittensor.Client, netUID int) {

	resp, err := client.GetValidatorScores(netUID)
	if err != nil {
		logging.Error(err).Int("netuid", netUID).Msg("ValidatorSync: Failed to get scores")
		return
	}

	logging.Info().Int("count", len(resp.Scores)).Msg("ValidatorSync: Received scores from bridge")

	// Update DB
	// We iterate over received scores and update corresponding nodes
	for hotkey, score := range resp.Scores {
		// Find node by Hotkey
		var node models.ProviderNode
		if err := db.DB.Where("hotkey = ? AND net_uid = ?", hotkey, netUID).First(&node).Error; err != nil {
			// Node usually doesn't exist yet in dev, skip silently
			continue
		}

		// Map score (0.0-1.0) to QualityScore (0-100)
		qualityScore := score * 100

		// Update
		if err := db.DB.Model(&node).Updates(map[string]interface{}{
			"quality_score": qualityScore,
		}).Error; err != nil {
			logging.Error(err).Str("node_id", node.ID.String()).Msg("ValidatorSync: Failed to update node score")
		} else {
			logging.Debug().
				Str("node_id", node.ID.String()).
				Str("hotkey", hotkey).
				Float64("score", qualityScore).
				Msg("ValidatorSync: Updated node score")

			// Update related listings (Phase 4)
			// Marketplace items for this provider should reflect the network trust score
			result := db.DB.Model(&models.ProxyListing{}).
				Where("seller_id = ?", node.UserID).
				Update("quality_score", qualityScore)

			if result.Error != nil {
				logging.Error(result.Error).
					Str("seller_id", node.UserID.String()).
					Msg("ValidatorSync: Failed to update listings score")
			}
		}
	}
}
