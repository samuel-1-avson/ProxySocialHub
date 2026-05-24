// Package billing — ZK batch aggregator (L2 Phase 4).
//
// ProcessSignedProofs batches all signed UsageProofs into a single Merkle-root
// commitment and submits one Solana TX instead of N individual TXes.
//
// Flow:
//   1. Fetch all "signed" UsageProofs (both parties have signed)
//   2. Build ProofLeaf for each
//   3. Compute BatchProof (Merkle root via zk.Prover)
//   4. Idempotency-check: skip if root already anchored on-chain
//   5. Call oracle.SubmitZKBatch — one TX on Solana
//   6. Mark all proofs as "on_chain" with the shared TX hash
//   7. Save ZKBatch record for audit
package billing

import (
	"context"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/zk"
	"gorm.io/gorm"
)

// ZKAggregator handles batching and on-chain settlement of usage proofs.
type ZKAggregator struct {
	batchSize int
	prover    *zk.Prover
}

func NewZKAggregator() *ZKAggregator {
	return &ZKAggregator{
		batchSize: 50,
		prover:    zk.NewProver(),
	}
}

// ProcessSignedProofs fetches signed UsageProofs, generates a batch Merkle
// commitment, submits it in one Solana TX, and marks the proofs as on_chain.
func (z *ZKAggregator) ProcessSignedProofs(ctx context.Context) error {
	logging.Info().Msg("ZKAggregator: Scanning for signed usage proofs...")

	var proofs []models.UsageProof
	if err := db.DB.Where("status = ?", models.UsageProofSigned).
		Limit(z.batchSize).Find(&proofs).Error; err != nil {
		return fmt.Errorf("ZKAggregator: fetch signed proofs: %w", err)
	}
	if len(proofs) == 0 {
		return nil
	}

	logging.Info().Int("count", len(proofs)).Msg("ZKAggregator: building batch proof")

	// Build proof leaves.
	leaves := make([]zk.ProofLeaf, 0, len(proofs))
	proofIDs := make([]interface{}, 0, len(proofs))
	for _, p := range proofs {
		var sessionIDBytes [16]byte
		copy(sessionIDBytes[:], p.SessionID[:])

		buyerSig, _ := base58.Decode(p.BuyerSignature)
		providerSig, _ := base58.Decode(p.ProviderSignature)

		leaves = append(leaves, zk.ProofLeaf{
			SessionID:   sessionIDBytes,
			TotalBytes:  uint64(p.TotalBytes),
			PeriodStart: p.PeriodStart.Unix(),
			PeriodEnd:   p.PeriodEnd.Unix(),
			BuyerSig:    buyerSig,
			ProviderSig: providerSig,
		})
		proofIDs = append(proofIDs, p.ID)
	}

	batch, err := z.prover.GenerateBatchProof(leaves)
	if err != nil {
		return fmt.Errorf("ZKAggregator: GenerateBatchProof: %w", err)
	}

	rootHex := hex.EncodeToString(batch.Root[:])

	// Submit on-chain (idempotency handled inside SubmitZKBatchOnChain).
	txSig, err := z.submitBatchOnChain(ctx, batch, rootHex)
	if err != nil {
		return fmt.Errorf("ZKAggregator: on-chain submission: %w", err)
	}

	// Persist results in a single DB transaction.
	return db.DB.Transaction(func(tx *gorm.DB) error {
		// Mark all proofs as on_chain.
		if err := tx.Model(&models.UsageProof{}).
			Where("id IN ?", proofIDs).
			Updates(map[string]interface{}{
				"status":             models.UsageProofOnChain,
				"on_chain_tx_hash":   txSig,
				"on_chain_slot":      time.Now().Unix(),
			}).Error; err != nil {
			return fmt.Errorf("mark on_chain: %w", err)
		}

		// Create ZKBatch audit record.
		zkBatch := models.ZKBatch{
			BatchRoot:    rootHex,
			SessionCount: batch.SessionCount,
			TotalBytes:   batch.TotalBytes,
			PeriodStart:  time.Unix(batch.PeriodStart, 0),
			PeriodEnd:    time.Unix(batch.PeriodEnd, 0),
			OnChainTxSig: txSig,
			OnChainSlot:  time.Now().Unix(),
			Status:       models.ZKBatchConfirmed,
		}
		if err := tx.Create(&zkBatch).Error; err != nil {
			return fmt.Errorf("create ZKBatch record: %w", err)
		}

		logging.Info().
			Str("root", rootHex).
			Str("tx_sig", txSig).
			Uint32("sessions", batch.SessionCount).
			Uint64("total_bytes", batch.TotalBytes).
			Msg("ZKAggregator: batch committed on-chain")

		return nil
	})
}

// SubmitBatchDirect is called by the API handler when a batch arrives via HTTP
// (as opposed to the background worker picking it up from the DB).
// It updates the existing ZKBatch record with the final TX sig and status.
func (z *ZKAggregator) SubmitBatchDirect(ctx context.Context, batch *zk.BatchProof, rootHex string) error {
	txSig, err := z.submitBatchOnChain(ctx, batch, rootHex)
	if err != nil {
		db.DB.Model(&models.ZKBatch{}).Where("batch_root = ?", rootHex).
			Updates(map[string]interface{}{"status": models.ZKBatchFailed})
		return err
	}
	db.DB.Model(&models.ZKBatch{}).Where("batch_root = ?", rootHex).
		Updates(map[string]interface{}{
			"status":         models.ZKBatchConfirmed,
			"on_chain_tx_sig": txSig,
			"on_chain_slot":  time.Now().Unix(),
		})
	return nil
}

// submitBatchOnChain submits the batch root to Solana and returns the TX sig.
// Falls back to a local placeholder if the oracle is not configured (dev mode).
func (z *ZKAggregator) submitBatchOnChain(ctx context.Context, batch *zk.BatchProof, rootHex string) (string, error) {
	oracle := solana.GetOracleClient()
	if oracle == nil {
		// Dev-mode fallback: no oracle configured.
		placeholder := "dev_batch_" + rootHex[:8]
		logging.Warn().Str("root", rootHex).Msg("ZKAggregator: oracle not configured, using placeholder TX sig")
		return placeholder, nil
	}

	// Idempotency: skip if already anchored.
	anchored, err := oracle.IsZKBatchAnchored(ctx, batch.Root)
	if err != nil {
		logging.Warn().Err(err).Msg("ZKAggregator: idempotency check failed, proceeding with submission")
	} else if anchored {
		// Already on-chain — retrieve the DB record for the existing TX sig.
		var existing models.ZKBatch
		if dbErr := db.DB.Where("batch_root = ?", rootHex).First(&existing).Error; dbErr == nil {
			logging.Info().Str("root", rootHex).Msg("ZKAggregator: batch already anchored, reusing TX sig")
			return existing.OnChainTxSig, nil
		}
		return "already_anchored_" + rootHex[:8], nil
	}

	txSig, _, err := oracle.SubmitZKBatch(ctx, solana.ZKBatchParams{
		BatchRoot:    batch.Root,
		SessionCount: batch.SessionCount,
		TotalBytes:   batch.TotalBytes,
		PeriodStart:  batch.PeriodStart,
		PeriodEnd:    batch.PeriodEnd,
	})
	if err != nil {
		return "", fmt.Errorf("SubmitZKBatch RPC: %w", err)
	}
	return txSig, nil
}
