// Package billing — ZK batch aggregator (L2 Phase 4).
//
// ProcessSignedProofs batches all signed UsageProofs into a single Merkle-root
// commitment and submits one Solana TX instead of N individual TXes.
//
// Flow:
//  1. Fetch all "signed" UsageProofs (both parties have signed)
//  2. Build ProofLeaf for each
//  3. Compute BatchProof (Merkle root via zk.Prover)
//  4. Idempotency-check: skip if root already anchored on-chain
//  5. Call oracle.SubmitZKBatch — one TX on Solana
//  6. Mark all proofs as "on_chain" with the shared TX hash
//  7. Save ZKBatch record for audit
package billing

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
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
	halo2     *zk.Halo2Client
}

func NewZKAggregator() *ZKAggregator {
	return &ZKAggregator{
		batchSize: 50,
		prover:    zk.NewProver(),
		halo2:     zk.NewHalo2ClientFromEnv(),
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
	if err := z.attachHalo2Proof(ctx, batch, rootHex); err != nil {
		return fmt.Errorf("ZKAggregator: proof generation: %w", err)
	}

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
				"status":           models.UsageProofOnChain,
				"on_chain_tx_hash": txSig,
				"on_chain_slot":    time.Now().Unix(),
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
			ProofBytes:   batch.Proof,
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
	if err := z.attachHalo2Proof(ctx, batch, rootHex); err != nil {
		db.DB.Model(&models.ZKBatch{}).Where("batch_root = ?", rootHex).
			Updates(map[string]interface{}{"status": models.ZKBatchFailed})
		return err
	}

	// Persist proof bytes as soon as they are available so failures after this
	// point (e.g., missing Solana program in a simulation environment) still
	// leave operator-visible evidence behind.
	if len(batch.Proof) > 0 {
		db.DB.Model(&models.ZKBatch{}).Where("batch_root = ?", rootHex).
			Updates(map[string]interface{}{"proof_bytes": batch.Proof})
	}

	txSig, err := z.submitBatchOnChain(ctx, batch, rootHex)
	if err != nil {
		db.DB.Model(&models.ZKBatch{}).Where("batch_root = ?", rootHex).
			Updates(map[string]interface{}{
				"status":      models.ZKBatchFailed,
				"proof_bytes": batch.Proof,
			})
		return err
	}
	db.DB.Model(&models.ZKBatch{}).Where("batch_root = ?", rootHex).
		Updates(map[string]interface{}{
			"status":          models.ZKBatchConfirmed,
			"on_chain_tx_sig": txSig,
			"on_chain_slot":   time.Now().Unix(),
			"proof_bytes":     batch.Proof,
		})
	return nil
}

func (z *ZKAggregator) attachHalo2Proof(ctx context.Context, batch *zk.BatchProof, rootHex string) error {
	if z.halo2 == nil {
		recordZKProverResult("skipped", 0)
		return nil
	}

	started := time.Now()
	proofBytes, err := z.halo2.GenerateBatchProof(ctx, batch)
	elapsed := time.Since(started).Seconds()
	if err != nil {
		recordZKProverResult("failed", elapsed)
		return fmt.Errorf("attach halo2 proof for root %s: %w", rootHex, err)
	}

	if len(proofBytes) == 0 {
		recordZKProverResult("skipped", elapsed)
		return nil
	}

	// BC-11 Sprint A: when prover is required, verify before accepting the blob.
	if z.halo2.Required() {
		signals := halo2PublicSignals(batch)
		ok, vErr := z.halo2.VerifyBatchProof(ctx, proofBytes, signals)
		if vErr != nil {
			recordZKProverResult("verify_failed", elapsed)
			return fmt.Errorf("halo2 verify for root %s: %w", rootHex, vErr)
		}
		if !ok {
			recordZKProverResult("verify_rejected", elapsed)
			return fmt.Errorf("halo2 verify rejected proof for root %s", rootHex)
		}
	}

	batch.Proof = proofBytes
	recordZKProverResult("success", elapsed)

	logging.Info().
		Str("root", rootHex).
		Int("proof_bytes", len(proofBytes)).
		Msg("ZKAggregator: external Halo2 proof attached")

	return nil
}

// halo2PublicSignals builds [digest_hex, session_count, total_bytes] matching zk-prover v2 API.
func halo2PublicSignals(batch *zk.BatchProof) []string {
	digest := computeHalo2BatchDigest(batch)
	return []string{
		hex.EncodeToString(digest[:]),
		fmt.Sprintf("%d", batch.SessionCount),
		fmt.Sprintf("%d", batch.TotalBytes),
	}
}

func computeHalo2BatchDigest(batch *zk.BatchProof) [32]byte {
	h := sha256.New()
	h.Write(batch.Root[:])
	var sc [4]byte
	binary.LittleEndian.PutUint32(sc[:], batch.SessionCount)
	h.Write(sc[:])
	var tb [8]byte
	binary.LittleEndian.PutUint64(tb[:], batch.TotalBytes)
	h.Write(tb[:])
	var ps [8]byte
	binary.LittleEndian.PutUint64(ps[:], uint64(batch.PeriodStart))
	h.Write(ps[:])
	var pe [8]byte
	binary.LittleEndian.PutUint64(pe[:], uint64(batch.PeriodEnd))
	h.Write(pe[:])
	for _, leaf := range batch.LeafHashes {
		h.Write(leaf[:])
	}
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

// submitBatchOnChain submits the batch root to Solana and returns the TX sig.
// Full decentralization requires an initialized oracle; no placeholder tx is returned.
func (z *ZKAggregator) submitBatchOnChain(ctx context.Context, batch *zk.BatchProof, rootHex string) (string, error) {
	oracle := solana.GetOracleClient()
	if oracle == nil {
		return "", fmt.Errorf("oracle not configured: cannot submit ZK batch on-chain")
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

	// BC-11 Sprint A: required prover mode refuses zero proof_hash (no blob).
	proofHash := solana.ProofHashFromBytes(batch.Proof)
	if z.halo2 != nil && z.halo2.Required() && proofHash == ([32]byte{}) {
		return "", fmt.Errorf("HALO2_PROVER_REQUIRED: refusing on-chain submit without non-zero proof_hash")
	}

	txSig, _, err := oracle.SubmitZKBatch(ctx, solana.ZKBatchParams{
		BatchRoot:    batch.Root,
		SessionCount: batch.SessionCount,
		TotalBytes:   batch.TotalBytes,
		PeriodStart:  batch.PeriodStart,
		PeriodEnd:    batch.PeriodEnd,
		ProofHash:    proofHash,
	})
	if err != nil {
		return "", fmt.Errorf("SubmitZKBatch RPC: %w", err)
	}
	return txSig, nil
}
