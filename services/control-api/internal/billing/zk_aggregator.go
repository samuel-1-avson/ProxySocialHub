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
	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
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
	groth16   *zk.Groth16Client
}

func NewZKAggregator() *ZKAggregator {
	return &ZKAggregator{
		batchSize: 50,
		prover:    zk.NewProver(),
		halo2:     zk.NewHalo2ClientFromEnv(),
		groth16:   zk.NewGroth16ClientFromEnv(),
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
	if err := z.attachGroth16Proof(ctx, batch, rootHex); err != nil {
		return fmt.Errorf("ZKAggregator: groth16 proof: %w", err)
	}

	// Submit on-chain (idempotency handled inside SubmitZKBatchOnChain).
	txSig, batchPDA, err := z.submitBatchOnChain(ctx, batch, rootHex)
	if err != nil {
		return fmt.Errorf("ZKAggregator: on-chain submission: %w", err)
	}

	z.creditReputationAfterSettle(ctx, batch, proofs, batchPDA)

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
	if err := z.attachGroth16Proof(ctx, batch, rootHex); err != nil {
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

	txSig, _, err := z.submitBatchOnChain(ctx, batch, rootHex)
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
	// Groth16 settlement lane uses BN254 wire proofs; skip pasta Halo2 blob.
	if decentralization.ZKOnchainGroth16Enabled() {
		return nil
	}
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

// attachGroth16Proof produces the 256-byte BN254 wire proof for on-chain verify.
// Required when PROXYHUB_ZK_ONCHAIN_GROTH16 is on (or GROTH16_PROVER_REQUIRED).
// Overwrites batch.Proof with the Groth16 wire bytes (Halo2 blob is not on-chain).
func (z *ZKAggregator) attachGroth16Proof(ctx context.Context, batch *zk.BatchProof, rootHex string) error {
	requireLane := decentralization.ZKOnchainGroth16Enabled()
	clientRequired := z.groth16 != nil && z.groth16.Required()
	if !requireLane && !clientRequired && (z.groth16 == nil || !z.groth16.Enabled()) {
		return nil
	}
	if z.groth16 == nil || !z.groth16.Enabled() {
		return fmt.Errorf("GROTH16_PROVER_URL required when PROXYHUB_ZK_ONCHAIN_GROTH16 / GROTH16_PROVER_REQUIRED is on")
	}

	started := time.Now()
	wire, err := z.groth16.ProveBatchHeader(ctx, batch)
	elapsed := time.Since(started).Seconds()
	if err != nil {
		recordZKProverResult("groth16_failed", elapsed)
		return fmt.Errorf("attach groth16 proof for root %s: %w", rootHex, err)
	}
	batch.Proof = append([]byte(nil), wire[:]...)
	recordZKProverResult("groth16_success", elapsed)
	logging.Info().
		Str("root", rootHex).
		Int("proof_bytes", len(batch.Proof)).
		Msg("ZKAggregator: BN254 Groth16 wire proof attached")
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

// submitBatchOnChain submits the batch root to Solana and returns the TX sig
// plus ZKBatchPDA (for reputation consume). Full decentralization requires an
// initialized oracle; no placeholder tx is returned.
// Wave 4.1: when PROXYHUB_ZK_ONCHAIN_GROTH16 is on, refuse oracle-only submit
// (fail-closed until Groth16 verifier is ready).
func (z *ZKAggregator) submitBatchOnChain(ctx context.Context, batch *zk.BatchProof, rootHex string) (string, sol.PublicKey, error) {
	if err := decentralization.GateOnchainGroth16Settlement(); err != nil {
		return "", sol.PublicKey{}, err
	}

	oracle := solana.GetOracleClient()
	if oracle == nil {
		return "", sol.PublicKey{}, fmt.Errorf("oracle not configured: cannot submit ZK batch on-chain")
	}

	// Idempotency: skip if already anchored.
	anchored, err := oracle.IsZKBatchAnchored(ctx, batch.Root)
	if err != nil {
		logging.Warn().Err(err).Msg("ZKAggregator: idempotency check failed, proceeding with submission")
	} else if anchored {
		pda, _, _ := oracle.GetZKBatchPDA(batch.Root)
		var existing models.ZKBatch
		if dbErr := db.DB.Where("batch_root = ?", rootHex).First(&existing).Error; dbErr == nil {
			logging.Info().Str("root", rootHex).Msg("ZKAggregator: batch already anchored, reusing TX sig")
			return existing.OnChainTxSig, pda, nil
		}
		return "already_anchored_" + rootHex[:8], pda, nil
	}

	proofHash := solana.ProofHashFromBytes(batch.Proof)
	if z.halo2 != nil && z.halo2.Required() && !decentralization.ZKOnchainGroth16Enabled() && proofHash == ([32]byte{}) {
		return "", sol.PublicKey{}, fmt.Errorf("HALO2_PROVER_REQUIRED: refusing on-chain submit without non-zero proof_hash")
	}

	if decentralization.ZKOnchainGroth16Enabled() {
		if len(batch.Proof) != zk.Groth16ProofWireLen {
			return "", sol.PublicKey{}, fmt.Errorf("PROXYHUB_ZK_ONCHAIN_GROTH16: need %d-byte Groth16 wire proof, got %d", zk.Groth16ProofWireLen, len(batch.Proof))
		}
		var wire [256]byte
		copy(wire[:], batch.Proof)
		leavesHash, err := zk.LeavesHash(batch.LeafHashes)
		if err != nil {
			return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatchGroth16 leaves_hash: %w", err)
		}
		if uint32(len(batch.LeafHashes)) != batch.SessionCount {
			return "", sol.PublicKey{}, fmt.Errorf(
				"SubmitZKBatchGroth16: leaf count %d != session_count %d",
				len(batch.LeafHashes), batch.SessionCount,
			)
		}
		txSig, batchPDA, err := oracle.SubmitZKBatchGroth16(ctx, solana.ZKBatchGroth16Params{
			ZKBatchParams: solana.ZKBatchParams{
				BatchRoot:    batch.Root,
				SessionCount: batch.SessionCount,
				TotalBytes:   batch.TotalBytes,
				PeriodStart:  batch.PeriodStart,
				PeriodEnd:    batch.PeriodEnd,
				ProofHash:    proofHash,
			},
			LeavesHash: leavesHash,
			Proof:      wire,
			VKHash:     solana.BatchGroth16VKHash(),
		})
		if err != nil {
			return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatchGroth16: %w", err)
		}
		return txSig, batchPDA, nil
	}

	txSig, batchPDA, err := oracle.SubmitZKBatch(ctx, solana.ZKBatchParams{
		BatchRoot:    batch.Root,
		SessionCount: batch.SessionCount,
		TotalBytes:   batch.TotalBytes,
		PeriodStart:  batch.PeriodStart,
		PeriodEnd:    batch.PeriodEnd,
		ProofHash:    proofHash,
	})
	if err != nil {
		return "", sol.PublicKey{}, fmt.Errorf("SubmitZKBatch RPC: %w", err)
	}
	return txSig, batchPDA, nil
}

// creditReputationAfterSettle consumes the settled batch (ZKBatchPDA when Groth16
// ready) to credit each unique provider via reputation verify_usage.
// Soft-fail: settlement already succeeded; reputation errors are logged.
func (z *ZKAggregator) creditReputationAfterSettle(ctx context.Context, batch *zk.BatchProof, proofs []models.UsageProof, zkBatchPDA sol.PublicKey) {
	if batch == nil || len(proofs) == 0 {
		return
	}
	if err := solana.GateReputationScoreUpdate(); err != nil {
		logging.Warn().Err(err).Msg("ZKAggregator: skip reputation credit (gate)")
		return
	}
	oracle := solana.GetOracleClient()
	if oracle == nil {
		logging.Warn().Msg("ZKAggregator: skip reputation credit (no oracle)")
		return
	}

	entries := make([]solana.ProviderBatchCredit, 0, len(proofs))
	for _, p := range proofs {
		if p.TotalBytes <= 0 {
			continue
		}
		entries = append(entries, solana.ProviderBatchCredit{
			Wallet:     p.ProviderWallet,
			TotalBytes: uint64(p.TotalBytes),
		})
	}
	credits := solana.AggregateProviderBatchCredits(entries)
	if len(credits) == 0 {
		return
	}

	proofHash := solana.ProofHashFromBytes(batch.Proof)
	sigs, err := oracle.CreditProvidersFromZKBatchWithPDA(ctx, batch.Root, proofHash, zkBatchPDA, credits)
	if err != nil {
		logging.Warn().
			Err(err).
			Int("credited", len(sigs)).
			Int("providers", len(credits)).
			Str("root", hex.EncodeToString(batch.Root[:])).
			Msg("ZKAggregator: reputation credit partial/failed")
		return
	}
	logging.Info().
		Int("providers", len(credits)).
		Int("txs", len(sigs)).
		Str("root", hex.EncodeToString(batch.Root[:])).
		Msg("ZKAggregator: reputation credited via ZKBatchPDA consume")
}
