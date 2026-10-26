package billing

import (
	"math"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/audit"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maxPayoutRetryAttempts = 5

// staleClaimTimeout bounds how long a pending payout may stay "claimed"
// without an on-chain tx hash before the reaper returns it to "queued" (P0-2).
const staleClaimTimeout = 15 * time.Minute

// ErrPayoutAlreadyQueued reports that a payout with the same idempotency key
// already exists. Callers must NOT treat it as success: the amount passed to
// this call was not queued (W-01).
var ErrPayoutAlreadyQueued = errors.New("payout already queued for idempotency key")

// payoutIdempotencyKey derives the pending_payouts idempotency key.
// A caller-supplied per-payout reference (e.g. the ledger debit reference)
// wins; otherwise sorted session IDs; otherwise a fresh UUID so the key is
// never a constant per (provider, wallet) (W-01). Keys fit VARCHAR(64).
func payoutIdempotencyKey(providerID uuid.UUID, walletAddress string, sessionIDs []string, reference string) string {
	reference = strings.TrimSpace(reference)
	if reference != "" {
		if len(reference) <= 64 {
			return reference
		}
		sum := sha256.Sum256([]byte(reference))
		return hex.EncodeToString(sum[:])
	}
	if len(sessionIDs) > 0 {
		sorted := make([]string, len(sessionIDs))
		copy(sorted, sessionIDs)
		sort.Strings(sorted)
		raw := providerID.String() + ":" + walletAddress + ":" + strings.Join(sorted, ",")
		sum := sha256.Sum256([]byte(raw))
		return hex.EncodeToString(sum[:])
	}
	return uuid.NewString()
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique") || strings.Contains(msg, "duplicate key") || strings.Contains(msg, "duplicated key")
}

// saveBatchWithRetry attempts to persist a batch record up to maxAttempts times.
// Used after an on-chain transfer succeeds so the txHash is durable even when
// the first DB write fails (P0-03 double-spend guard).
func saveBatchWithRetry(batch *models.BatchPayout, maxAttempts int) error {
	var lastErr error
	for i := 0; i < maxAttempts; i++ {
		if i > 0 {
			time.Sleep(time.Duration(i) * time.Second)
		}
		if err := db.DB.Save(batch).Error; err != nil {
			lastErr = err
			logging.Error(err).
				Str("batch_id", batch.ID.String()).
				Int("attempt", i+1).
				Msg("batch_payout: DB save retry after on-chain success")
			continue
		}
		return nil
	}
	return fmt.Errorf("batch_payout: DB save failed after %d attempts: %w", maxAttempts, lastErr)
}

// BatchPayoutProcessor manages batching of provider payouts
type BatchPayoutProcessor struct {
	config    models.BatchConfig
	sendFunc  func(ctx context.Context, recipient string, amountSOL float64) error
	batchFunc func(ctx context.Context, items []models.BatchPayoutItem) (string, error)
}

// NewBatchPayoutProcessor creates a new batch processor
func NewBatchPayoutProcessor(
	config models.BatchConfig,
	sendFunc func(ctx context.Context, recipient string, amountSOL float64) error,
	batchFunc func(ctx context.Context, items []models.BatchPayoutItem) (string, error),
) *BatchPayoutProcessor {
	return &BatchPayoutProcessor{
		config:    config,
		sendFunc:  sendFunc,
		batchFunc: batchFunc,
	}
}

// ImmediateThreshold returns the amount at/above which payouts bypass queueing.
func (bp *BatchPayoutProcessor) ImmediateThreshold() float64 {
	return bp.config.ImmediateThresholdSOL
}

// Start begins the background batch processing worker
func (bp *BatchPayoutProcessor) Start(ctx context.Context) {
	go bp.processLoop(ctx)
}

// processLoop runs the periodic batch processing
func (bp *BatchPayoutProcessor) processLoop(ctx context.Context) {
	ticker := time.NewTicker(bp.config.ProcessInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			logging.Info().Msg("Batch payout processor shutting down")
			return
		case <-ticker.C:
			if err := bp.ProcessPendingBatches(ctx); err != nil {
				logging.Error(err).Msg("Batch payout processing failed")
			}
		}
	}
}

// EnqueuePayoutTx inserts a queued PendingPayout inside the caller's
// transaction so a wallet debit and its payout intent commit atomically
// (P0-1). The caller owns idempotencyKey uniqueness per payout.
func (bp *BatchPayoutProcessor) EnqueuePayoutTx(tx *gorm.DB, providerID uuid.UUID, walletAddress string, amountSOL float64, idempotencyKey string) error {
	if tx == nil {
		return errors.New("batch_payout: EnqueuePayoutTx requires a transaction")
	}
	if strings.TrimSpace(idempotencyKey) == "" {
		return errors.New("batch_payout: idempotency key is required")
	}
	pending := models.PendingPayout{
		ProviderID:     providerID,
		WalletAddress:  walletAddress,
		AmountSOL:      amountSOL,
		Priority:       bp.calculatePriority(amountSOL),
		IdempotencyKey: idempotencyKey,
		Status:         models.PendingPayoutQueued,
		QueuedAt:       time.Now(),
	}
	if err := tx.Create(&pending).Error; err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("%w: %s", ErrPayoutAlreadyQueued, idempotencyKey)
		}
		return fmt.Errorf("batch_payout: enqueue in tx: %w", err)
	}
	return nil
}

// QueuePayout adds a payout to the batch queue.
// sessionIDs derive a deterministic idempotency key so retries of the same
// logical payout are safe. A duplicate returns ErrPayoutAlreadyQueued —
// never nil — so callers that already debited can restore (W-01).
// Prefer EnqueuePayoutTx when a debit is involved (atomic intent).
func (bp *BatchPayoutProcessor) QueuePayout(providerID uuid.UUID, walletAddress string, amountSOL float64, sessionIDs []string) error {
	idempotencyKey := payoutIdempotencyKey(providerID, walletAddress, sessionIDs, "")

	var existing models.PendingPayout
	if err := db.DB.Where("idempotency_key = ?", idempotencyKey).First(&existing).Error; err == nil {
		return fmt.Errorf("%w: %s", ErrPayoutAlreadyQueued, idempotencyKey)
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("batch_payout: idempotency lookup: %w", err)
	}

	if amountSOL >= bp.config.ImmediateThresholdSOL {
		logging.Info().
			Str("provider_id", providerID.String()).
			Float64("amount", amountSOL).
			Msg("Large payout detected, processing immediately")
		return bp.processImmediate(context.Background(), providerID, walletAddress, amountSOL)
	}

	if err := bp.EnqueuePayoutTx(db.DB, providerID, walletAddress, amountSOL, idempotencyKey); err != nil {
		return err
	}

	logging.Info().
		Str("provider_id", providerID.String()).
		Float64("amount", amountSOL).
		Msg("Payout queued for batch processing")

	return nil
}

// calculatePriority assigns priority on a log scale so sub-1 SOL
// payouts are differentiated (E-9: int truncation queued 0.01 and 0.99
// SOL identically).
func (bp *BatchPayoutProcessor) calculatePriority(amountSOL float64) int {
	if amountSOL <= 0 {
		return 1
	}
	priority := 1 + int(10*math.Log10(1+amountSOL))
	if priority > 100 {
		priority = 100
	}
	if priority < 1 {
		priority = 1
	}
	return priority
}

// processImmediate handles large payouts immediately (bypass batching).
// Batch and item records are created in one transaction before any send.
func (bp *BatchPayoutProcessor) processImmediate(ctx context.Context, providerID uuid.UUID, walletAddress string, amountSOL float64) error {
	batch := models.BatchPayout{
		Status:      models.BatchStatusProcessing,
		TotalAmount: amountSOL,
		TotalCount:  1,
	}
	item := models.BatchPayoutItem{
		ProviderID:    providerID,
		WalletAddress: walletAddress,
		AmountSOL:     amountSOL,
		Status:        "pending",
	}
	if err := db.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&batch).Error; err != nil {
			return err
		}
		item.BatchID = batch.ID
		return tx.Create(&item).Error
	}); err != nil {
		return err
	}

	txHash, err := bp.batchFunc(ctx, []models.BatchPayoutItem{item})
	now := time.Now()

	if err != nil {
		errMsg := err.Error()
		item.Status = "failed"
		item.ErrorMessage = &errMsg
		batch.Status = models.BatchStatusFailed
		batch.ErrorMessage = &errMsg
		if saveErr := db.DB.Save(&item).Error; saveErr != nil {
			logging.Error(saveErr).Str("batch_id", batch.ID.String()).Msg("batch_payout: failed to persist failed immediate item")
		}
		if saveErr := db.DB.Save(&batch).Error; saveErr != nil {
			logging.Error(saveErr).Str("batch_id", batch.ID.String()).Msg("batch_payout: failed to persist failed immediate batch")
		}
		return err
	}

	item.Status = "completed"
	batch.Status = models.BatchStatusCompleted
	batch.TxHash = &txHash
	batch.SuccessCount = 1
	batch.ProcessedAt = &now
	if saveErr := db.DB.Save(&item).Error; saveErr != nil {
		logging.Error(saveErr).Str("batch_id", batch.ID.String()).Str("tx_hash", txHash).Msg("CRITICAL: immediate payout sent but item record not persisted")
	}
	if saveErr := saveBatchWithRetry(&batch, 3); saveErr != nil {
		logging.Error(saveErr).Str("batch_id", batch.ID.String()).Str("tx_hash", txHash).Msg("CRITICAL: immediate payout sent but batch record not persisted")
		return saveErr
	}

	logging.Info().
		Str("provider_id", providerID.String()).
		Float64("amount", amountSOL).
		Str("tx_hash", txHash).
		Msg("Immediate payout processed")

	return nil
}

// reapStaleClaims returns pending payouts stuck in "claimed" without an
// on-chain tx hash to "queued" (P0-2). Rows whose batch already has a tx
// hash are never re-queued: that money may be in flight.
func (bp *BatchPayoutProcessor) reapStaleClaims() {
	cutoff := time.Now().Add(-staleClaimTimeout)
	var stale []models.PendingPayout
	if err := db.DB.Where("status = ? AND claimed_at < ?", models.PendingPayoutClaimed, cutoff).Find(&stale).Error; err != nil {
		logging.Error(err).Msg("batch_payout: stale-claim scan failed")
		return
	}
	byBatch := make(map[uuid.UUID][]uuid.UUID)
	for _, p := range stale {
		if p.BatchID == nil {
			continue
		}
		byBatch[*p.BatchID] = append(byBatch[*p.BatchID], p.ID)
	}
	for batchID, pendingIDs := range byBatch {
		var batch models.BatchPayout
		if err := db.DB.First(&batch, "id = ?", batchID).Error; err != nil {
			continue
		}
		if batch.TxHash != nil && *batch.TxHash != "" {
			continue // submitted on-chain; ops/finality owns it, never re-queue
		}
		if batch.Status == models.BatchStatusCompleted || batch.Status == models.BatchStatusFailed {
			continue
		}
		err := db.DB.Transaction(func(tx *gorm.DB) error {
			msg := "claim expired before on-chain submission; returned to queue"
			if err := tx.Model(&models.PendingPayout{}).
				Where("id IN ? AND status = ?", pendingIDs, models.PendingPayoutClaimed).
				Updates(map[string]interface{}{
					"status":     models.PendingPayoutQueued,
					"batch_id":   nil,
					"claimed_at": nil,
					"attempts":   gorm.Expr("attempts + 1"),
					"last_error": msg,
				}).Error; err != nil {
				return err
			}
			if err := tx.Model(&models.BatchPayoutItem{}).
				Where("batch_id = ?", batchID).
				Updates(map[string]interface{}{"status": "failed", "error_message": msg}).Error; err != nil {
				return err
			}
			return tx.Model(&models.BatchPayout{}).
				Where("id = ?", batchID).
				Updates(map[string]interface{}{"status": models.BatchStatusFailed, "error_message": msg}).Error
		})
		if err != nil {
			logging.Error(err).Str("batch_id", batchID.String()).Msg("batch_payout: stale-claim reap failed")
			continue
		}
		logging.Warn().
			Str("batch_id", batchID.String()).
			Int("returned", len(pendingIDs)).
			Msg("batch_payout: stale claims returned to queue")
	}
}

type claimedBatch struct {
	batch      models.BatchPayout
	items      []models.BatchPayoutItem
	pendingIDs []uuid.UUID
}

// claimBatch atomically claims up to MaxBatchSize queued payouts: it creates
// the BatchPayout + items and marks the pending rows claimed, all in one
// transaction. No row is ever deleted (P0-2).
func (bp *BatchPayoutProcessor) claimBatch() (*claimedBatch, error) {
	var claimed claimedBatch
	err := db.DB.Transaction(func(tx *gorm.DB) error {
		var pending []models.PendingPayout
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("status = ? AND (scheduled_for IS NULL OR scheduled_for <= ?)", models.PendingPayoutQueued, time.Now()).
			Order("priority DESC, queued_at ASC").
			Limit(bp.config.MaxBatchSize).
			Find(&pending).Error; err != nil {
			return err
		}
		if len(pending) == 0 {
			return nil
		}

		totalAmount := 0.0
		for _, p := range pending {
			totalAmount += p.AmountSOL
		}
		batch := models.BatchPayout{
			Status:      models.BatchStatusProcessing,
			TotalAmount: totalAmount,
			TotalCount:  len(pending),
		}
		if err := tx.Create(&batch).Error; err != nil {
			return fmt.Errorf("batch_payout: create batch: %w", err)
		}

		items := make([]models.BatchPayoutItem, len(pending))
		ids := make([]uuid.UUID, len(pending))
		for i, p := range pending {
			items[i] = models.BatchPayoutItem{
				BatchID:       batch.ID,
				ProviderID:    p.ProviderID,
				WalletAddress: p.WalletAddress,
				AmountSOL:     p.AmountSOL,
				Status:        "pending",
			}
			ids[i] = p.ID
		}
		if err := tx.Create(&items).Error; err != nil {
			return fmt.Errorf("batch_payout: create batch items: %w", err)
		}

		now := time.Now()
		res := tx.Model(&models.PendingPayout{}).
			Where("id IN ? AND status = ?", ids, models.PendingPayoutQueued).
			Updates(map[string]interface{}{
				"status":     models.PendingPayoutClaimed,
				"batch_id":   batch.ID,
				"claimed_at": now,
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != int64(len(ids)) {
			return fmt.Errorf("batch_payout: claimed %d of %d pending payouts", res.RowsAffected, len(ids))
		}

		claimed = claimedBatch{batch: batch, items: items, pendingIDs: ids}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(claimed.pendingIDs) == 0 {
		return nil, nil
	}
	return &claimed, nil
}

// ProcessPendingBatches processes all pending payouts in batches.
func (bp *BatchPayoutProcessor) ProcessPendingBatches(ctx context.Context) error {
	bp.reapStaleClaims()
	for {
		var pendingCount int64
		var oldestQueued time.Time

		db.DB.Model(&models.PendingPayout{}).
			Where("status = ? AND (scheduled_for IS NULL OR scheduled_for <= ?)", models.PendingPayoutQueued, time.Now()).
			Count(&pendingCount)

		if pendingCount == 0 {
			return nil
		}

		db.DB.Model(&models.PendingPayout{}).
			Select("MIN(queued_at)").
			Where("status = ? AND (scheduled_for IS NULL OR scheduled_for <= ?)", models.PendingPayoutQueued, time.Now()).
			Scan(&oldestQueued)

		if !models.ShouldProcessBatch(int(pendingCount), oldestQueued, bp.config) {
			return nil
		}

		claimed, err := bp.claimBatch()
		if err != nil {
			return fmt.Errorf("batch_payout: failed to claim pending rows: %w", err)
		}
		if claimed == nil {
			return nil
		}

		if err := bp.executeClaimedBatch(ctx, claimed); err != nil {
			logging.Error(err).Str("batch_id", claimed.batch.ID.String()).Int("batch_size", len(claimed.items)).Msg("Batch processing failed")
		}
	}
}

func (bp *BatchPayoutProcessor) setPendingStatus(pendingIDs []uuid.UUID, status models.PendingPayoutStatus, lastError *string) {
	updates := map[string]interface{}{"status": status}
	if lastError != nil {
		updates["last_error"] = *lastError
	}
	if err := db.DB.Model(&models.PendingPayout{}).Where("id IN ?", pendingIDs).Updates(updates).Error; err != nil {
		logging.Error(err).Str("status", string(status)).Msg("batch_payout: failed to update pending payout status")
	}
}

// executeClaimedBatch sends a previously claimed batch on-chain and drives
// batch, items, and pending rows to their terminal states.
func (bp *BatchPayoutProcessor) executeClaimedBatch(ctx context.Context, claimed *claimedBatch) error {
	batch := claimed.batch
	items := claimed.items

	logging.Info().
		Str("batch_id", batch.ID.String()).
		Int("count", len(items)).
		Float64("total_sol", batch.TotalAmount).
		Msg("Processing batch payout")

	txHash, err := bp.batchFunc(ctx, items)
	now := time.Now()

	if err != nil {
		// On-chain call failed — no SOL was sent. Hand each payout to the
		// individual retry queue and terminate the pending rows as failed.
		errMsg := err.Error()
		batch.Status = models.BatchStatusFailed
		batch.ErrorMessage = &errMsg
		batch.ProcessedAt = &now
		if saveErr := db.DB.Save(&batch).Error; saveErr != nil {
			logging.Error(saveErr).Str("batch_id", batch.ID.String()).Msg("batch_payout: failed to persist failed batch")
		}
		if updErr := db.DB.Model(&models.BatchPayoutItem{}).
			Where("batch_id = ?", batch.ID).
			Updates(map[string]interface{}{
				"status":        "failed",
				"error_message": errMsg,
			}).Error; updErr != nil {
			logging.Error(updErr).Str("batch_id", batch.ID.String()).Msg("batch_payout: failed to persist failed items")
		}
		bp.setPendingStatus(claimed.pendingIDs, models.PendingPayoutFailed, &errMsg)
		bp.requeueIndividual(items)
		return err
	}

	// P0-03: persist txHash + 'submitted' BEFORE marking complete. If the
	// process dies here, 'submitted' with a txHash means money is in flight —
	// never re-queue (the reaper also skips batches with a tx hash).
	batch.Status = models.BatchStatusSubmitted
	batch.TxHash = &txHash
	batch.ProcessedAt = &now
	if dbErr := saveBatchWithRetry(&batch, 3); dbErr != nil {
		logging.Error(dbErr).
			Str("batch_id", batch.ID.String()).
			Str("tx_hash", txHash).
			Float64("total_sol", batch.TotalAmount).
			Msg("CRITICAL: on-chain payout sent but DB record could not be persisted — manual reconciliation required")
		return dbErr
	}

	if err := waitForTxFinality(ctx, txHash); err != nil {
		logging.Error(err).
			Str("batch_id", batch.ID.String()).
			Str("tx_hash", txHash).
			Msg("batch_payout: finality not confirmed — batch left in 'submitted' state for reconciliation")
		return nil
	}

	batch.Status = models.BatchStatusCompleted
	batch.SuccessCount = len(items)
	if saveErr := saveBatchWithRetry(&batch, 3); saveErr != nil {
		logging.Error(saveErr).Str("batch_id", batch.ID.String()).Str("tx_hash", txHash).Msg("CRITICAL: batch completed on-chain but completion not persisted")
		return saveErr
	}

	if updErr := db.DB.Model(&models.BatchPayoutItem{}).
		Where("batch_id = ?", batch.ID).
		Update("status", "completed").Error; updErr != nil {
		logging.Error(updErr).Str("batch_id", batch.ID.String()).Msg("batch_payout: failed to mark items completed")
	}
	bp.setPendingStatus(claimed.pendingIDs, models.PendingPayoutCompleted, nil)

	savings := models.CalculateSavings(len(items), bp.config)
	logging.Info().
		Str("batch_id", batch.ID.String()).
		Str("tx_hash", txHash).
		Int("count", len(items)).
		Float64("savings_sol", savings).
		Msg("Batch payout completed")

	audit.LogDirect(nil, "system", models.AuditFinancialBatchPayout, "batch_payout", batch.ID.String(),
		fmt.Sprintf("Batch payout completed: %d recipients (tx: %s)", len(items), txHash),
		map[string]interface{}{
			"tx_hash":     txHash,
			"item_count":  len(items),
			"savings_sol": savings,
		})

	return nil
}

// requeueIndividual re-queues failed batch items for individual processing.
// P1-05: items that have already reached maxPayoutRetryAttempts are permanently
// abandoned (logged as a critical alert) instead of looping forever.
func (bp *BatchPayoutProcessor) requeueIndividual(items []models.BatchPayoutItem) {
	for _, item := range items {
		var existing models.PayoutRetryQueue
		if err := db.DB.Where("provider_id = ? AND wallet_address = ? AND status = 'pending'",
			item.ProviderID, item.WalletAddress).First(&existing).Error; err == nil {
			if existing.AttemptCount >= maxPayoutRetryAttempts {
				logging.Error(fmt.Errorf("payout permanently failed after %d attempts", maxPayoutRetryAttempts)).
					Str("provider_id", item.ProviderID.String()).
					Str("wallet_address", item.WalletAddress).
					Float64("amount_sol", item.AmountSOL).
					Msg("CRITICAL: payout abandoned — manual intervention required")
				if updErr := db.DB.Model(&existing).Updates(map[string]interface{}{"status": "abandoned"}).Error; updErr != nil {
					logging.Error(updErr).Str("provider_id", item.ProviderID.String()).Msg("batch_payout: failed to mark retry abandoned")
				}
				continue
			}
		}

		retry := models.PayoutRetryQueue{
			ProviderID:    item.ProviderID,
			WalletAddress: item.WalletAddress,
			AmountSOL:     item.AmountSOL,
			Status:        "pending",
		}
		if err := db.DB.Create(&retry).Error; err != nil {
			logging.Error(err).
				Str("provider_id", item.ProviderID.String()).
				Msg("Failed to re-queue failed batch item")
		}
	}
}

// GetStats returns statistics about batch processing
func (bp *BatchPayoutProcessor) GetStats() (*models.BatchPayoutStats, error) {
	var stats models.BatchPayoutStats

	db.DB.Model(&models.BatchPayout{}).Count(&stats.TotalBatches)

	db.DB.Model(&models.BatchPayout{}).
		Select("COALESCE(SUM(total_count), 0)").
		Scan(&stats.TotalPayouts)

	db.DB.Model(&models.BatchPayout{}).
		Select("COALESCE(SUM(total_amount), 0)").
		Scan(&stats.TotalAmountSOL)

	if stats.TotalBatches > 0 {
		stats.AverageBatchSize = float64(stats.TotalPayouts) / float64(stats.TotalBatches)
	}

	// E-8: measured signature-fee saving vs one tx per payout
	// (5000 lamports base fee per signature): saved fraction of fees.
	if stats.TotalPayouts > 0 {
		stats.SavingsPercent = (1 - float64(stats.TotalBatches)/float64(stats.TotalPayouts)) * 100
		if stats.SavingsPercent < 0 {
			stats.SavingsPercent = 0
		}
	}

	return &stats, nil
}

// waitForTxFinality polls Solana until the transaction reaches CommitmentFinalized
// or the context is cancelled. Returns nil immediately when the oracle is not
// configured (dev/test mode).
func waitForTxFinality(ctx context.Context, txHash string) error {
	if !solana.IsOracleConfigured() {
		return nil
	}
	oracle := solana.GetOracle()
	const maxAttempts = 12
	const pollInterval = 5 * time.Second

	for i := 0; i < maxAttempts; i++ {
		tx, err := oracle.GetTransaction(ctx, txHash)
		if err == nil && tx != nil {
			return nil // finalized
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(pollInterval):
		}
	}
	return fmt.Errorf("transaction %s not finalized after %d attempts", txHash, maxAttempts)
}

// GetPendingCount returns the number of payouts waiting in queue
func (bp *BatchPayoutProcessor) GetPendingCount() (int64, error) {
	var count int64
	err := db.DB.Model(&models.PendingPayout{}).
		Where("status = ? AND (scheduled_for IS NULL OR scheduled_for <= ?)", models.PendingPayoutQueued, time.Now()).
		Count(&count).Error
	return count, err
}

// ForceProcess forces immediate processing of all pending payouts
func (bp *BatchPayoutProcessor) ForceProcess(ctx context.Context) error {
	logging.Info().Msg("Force processing all pending batch payouts")
	return bp.ProcessPendingBatches(ctx)
}
