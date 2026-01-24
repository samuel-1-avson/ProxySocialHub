package billing

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// ZKAggregator handles batching and confidential settlement of usage proofs
type ZKAggregator struct {
	batchSize int
}

func NewZKAggregator() *ZKAggregator {
	return &ZKAggregator{
		batchSize: 50,
	}
}

// ProcessSignedProofs scans for signed usage proofs and aggregates them by session
func (z *ZKAggregator) ProcessSignedProofs(ctx context.Context) error {
	logging.Info().Msg("ZKAggregator: Scanning for signed usage proofs...")

	// 1. Fetch SIGNED proofs
	var proofs []models.UsageProof
	if err := db.DB.Where("status = ?", models.UsageProofSigned).Limit(z.batchSize).Find(&proofs).Error; err != nil {
		return fmt.Errorf("failed to fetch signed proofs: %w", err)
	}

	if len(proofs) == 0 {
		return nil
	}

	logging.Info().Int("count", len(proofs)).Msg("ZKAggregator: Found signed proofs for processing")

	// 2. Group by SessionID
	sessionGroups := make(map[uuid.UUID][]models.UsageProof)
	for _, p := range proofs {
		sessionGroups[p.SessionID] = append(sessionGroups[p.SessionID], p)
	}

	// 3. Process each session group
	for sessionID, group := range sessionGroups {
		if err := z.settleGroupConfidencially(ctx, sessionID, group); err != nil {
			logging.Error(err).Str("session_id", sessionID.String()).Msg("ZKAggregator: Group settlement failed")
		}
	}

	return nil
}

func (z *ZKAggregator) settleGroupConfidencially(ctx context.Context, sessionID uuid.UUID, group []models.UsageProof) error {
	// Start DB Transaction
	return db.DB.Transaction(func(tx *gorm.DB) error {
		// A. Sum totals
		var totalBytes int64
		proofIDs := make([]uuid.UUID, 0, len(group))
		for _, p := range group {
			totalBytes += p.TotalBytes
			proofIDs = append(proofIDs, p.ID)
		}

		// B. Mark proofs as settling
		if err := tx.Model(&models.UsageProof{}).Where("id IN ?", proofIDs).Update("status", models.UsageProofSettlingConfidential).Error; err != nil {
			return err
		}

		// C. Generate (Mock) ZK Witness
		// In production, this would call a separate ZK-Proof Generation Service (WASM or hardware-accelerated)
		logging.Info().
			Str("session_id", sessionID.String()).
			Int64("total_bytes", totalBytes).
			Msg("ZKAggregator: Confidential witness generated")

		// D. Save Confidential Settlement Record
		// (We might need a new model for ZK Settlements, but for the prototype we can log it)
		// For now, we simulate the "On-Chain" callback by marking them as on_chain

		// In a real system, the worker sends the 'witness' to Solana.
		// We simulate the success response here.
		mockTxHash := "0x_zk_settlement_" + uuid.New().String()[:8]

		if err := tx.Model(&models.UsageProof{}).Where("id IN ?", proofIDs).Updates(map[string]interface{}{
			"status":           models.UsageProofOnChain,
			"on_chain_tx_hash": mockTxHash,
			"on_chain_slot":    time.Now().Unix(), // mock slot
		}).Error; err != nil {
			return err
		}

		logging.Info().
			Str("tx_hash", mockTxHash).
			Int("proof_count", len(group)).
			Msg("ZKAggregator: Confidential settlement submitted to virtual bridge")

		return nil
	})
}
