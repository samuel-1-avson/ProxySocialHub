package billing

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/audit"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maxPayoutRetryAttempts = 5

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
	config     models.BatchConfig
	sendFunc   func(ctx context.Context, recipient string, amountSOL float64) error
	batchFunc  func(ctx context.Context, items []models.BatchPayoutItem) (string, error)
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

// QueuePayout adds a payout to the batch queue.
// sessionIDs are used to derive a deterministic idempotency key to prevent double-payouts.
func (bp *BatchPayoutProcessor) QueuePayout(providerID uuid.UUID, walletAddress string, amountSOL float64, sessionIDs []string) error {
	// Build idempotency key from sorted session IDs so retries are safe
	sorted := make([]string, len(sessionIDs))
	copy(sorted, sessionIDs)
	sort.Strings(sorted)
	raw := providerID.String() + ":" + strings.Join(sorted, ",")
	hash := sha256.Sum256([]byte(raw))
	idempotencyKey := hex.EncodeToString(hash[:])

	// Skip if already queued or processed for these sessions
	var existing models.PendingPayout
	if err := db.DB.Where("idempotency_key = ?", idempotencyKey).First(&existing).Error; err == nil {
		logging.Info().Str("idempotency_key", idempotencyKey).Msg("Payout already queued, skipping duplicate")
		return nil
	}

	// Check if immediate processing is needed (large amount)
	if amountSOL >= bp.config.ImmediateThresholdSOL {
		logging.Info().
			Str("provider_id", providerID.String()).
			Float64("amount", amountSOL).
			Msg("Large payout detected, processing immediately")
		return bp.processImmediate(context.Background(), providerID, walletAddress, amountSOL)
	}

	// Add to queue
	pending := models.PendingPayout{
		ProviderID:     providerID,
		WalletAddress:  walletAddress,
		AmountSOL:      amountSOL,
		Priority:       bp.calculatePriority(amountSOL),
		IdempotencyKey: idempotencyKey,
		QueuedAt:       time.Now(),
	}

	if err := db.DB.Create(&pending).Error; err != nil {
		return fmt.Errorf("failed to queue payout: %w", err)
	}

	logging.Info().
		Str("provider_id", providerID.String()).
		Float64("amount", amountSOL).
		Int("priority", pending.Priority).
		Msg("Payout queued for batch processing")

	return nil
}

// calculatePriority assigns priority based on amount (larger = higher priority)
func (bp *BatchPayoutProcessor) calculatePriority(amountSOL float64) int {
	// Simple priority: 1 SOL = 1 priority point, capped at 100
	priority := int(amountSOL)
	if priority > 100 {
		priority = 100
	}
	if priority < 1 {
		priority = 1
	}
	return priority
}

// processImmediate handles large payouts immediately (bypass batching)
func (bp *BatchPayoutProcessor) processImmediate(ctx context.Context, providerID uuid.UUID, walletAddress string, amountSOL float64) error {
	// Create batch record for tracking
	batch := models.BatchPayout{
		Status:      models.BatchStatusProcessing,
		TotalAmount: amountSOL,
		TotalCount:  1,
	}
	if err := db.DB.Create(&batch).Error; err != nil {
		return err
	}

	// Create item record
	item := models.BatchPayoutItem{
		BatchID:       batch.ID,
		ProviderID:    providerID,
		WalletAddress: walletAddress,
		AmountSOL:     amountSOL,
		Status:        "pending",
	}
	if err := db.DB.Create(&item).Error; err != nil {
		return err
	}

	// Process immediately
	txHash, err := bp.batchFunc(ctx, []models.BatchPayoutItem{item})
	now := time.Now()

	if err != nil {
		item.Status = "failed"
		errMsg := err.Error()
		item.ErrorMessage = &errMsg
		batch.Status = models.BatchStatusFailed
		batch.ErrorMessage = &errMsg
		db.DB.Save(&item)
		db.DB.Save(&batch)
		return err
	}

	// Success
	item.Status = "completed"
	batch.Status = models.BatchStatusCompleted
	batch.TxHash = &txHash
	batch.SuccessCount = 1
	batch.ProcessedAt = &now
	db.DB.Save(&item)
	db.DB.Save(&batch)

	logging.Info().
		Str("provider_id", providerID.String()).
		Float64("amount", amountSOL).
		Str("tx_hash", txHash).
		Msg("Immediate payout processed")

	return nil
}

// ProcessPendingBatches processes all pending payouts in batches.
// P0-02: rows are claimed with SELECT FOR UPDATE SKIP LOCKED inside a transaction,
// preventing concurrent workers from processing the same payouts twice.
func (bp *BatchPayoutProcessor) ProcessPendingBatches(ctx context.Context) error {
	for {
		// Check readiness outside the lock (cheap, non-blocking)
		var pendingCount int64
		var oldestQueued time.Time

		db.DB.Model(&models.PendingPayout{}).
			Where("scheduled_for IS NULL OR scheduled_for <= ?", time.Now()).
			Count(&pendingCount)

		if pendingCount == 0 {
			return nil
		}

		db.DB.Model(&models.PendingPayout{}).
			Select("MIN(queued_at)").
			Where("scheduled_for IS NULL OR scheduled_for <= ?", time.Now()).
			Scan(&oldestQueued)

		if !models.ShouldProcessBatch(int(pendingCount), oldestQueued, bp.config) {
			return nil
		}

		// Atomically claim a batch: FOR UPDATE SKIP LOCKED ensures that if two
		// worker processes run concurrently, each picks a distinct set of rows.
		var claimed []models.PendingPayout
		err := db.DB.Transaction(func(tx *gorm.DB) error {
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
				Where("scheduled_for IS NULL OR scheduled_for <= ?", time.Now()).
				Order("priority DESC, queued_at ASC").
				Limit(bp.config.MaxBatchSize).
				Find(&claimed).Error; err != nil {
				return err
			}
			if len(claimed) == 0 {
				return nil
			}
			ids := make([]uuid.UUID, len(claimed))
			for i, p := range claimed {
				ids[i] = p.ID
			}
			// Delete inside the same transaction — rows are gone before any other
			// worker can see them, preventing the double-payment race (P0-02).
			return tx.Delete(&models.PendingPayout{}, "id IN ?", ids).Error
		})
		if err != nil {
			return fmt.Errorf("batch_payout: failed to claim pending rows: %w", err)
		}

		if len(claimed) == 0 {
			return nil
		}

		if err := bp.processBatch(ctx, claimed); err != nil {
			logging.Error(err).Int("batch_size", len(claimed)).Msg("Batch processing failed")
		}
	}
}

// processBatch executes a single batch of payouts
func (bp *BatchPayoutProcessor) processBatch(ctx context.Context, pending []models.PendingPayout) error {
	if len(pending) == 0 {
		return nil
	}

	// Calculate total and create batch record
	totalAmount := 0.0
	for _, p := range pending {
		totalAmount += p.AmountSOL
	}

	batch := models.BatchPayout{
		Status:      models.BatchStatusProcessing,
		TotalAmount: totalAmount,
		TotalCount:  len(pending),
	}
	if err := db.DB.Create(&batch).Error; err != nil {
		return fmt.Errorf("failed to create batch record: %w", err)
	}

	// Create batch items
	items := make([]models.BatchPayoutItem, len(pending))
	for i, p := range pending {
		items[i] = models.BatchPayoutItem{
			BatchID:       batch.ID,
			ProviderID:    p.ProviderID,
			WalletAddress: p.WalletAddress,
			AmountSOL:     p.AmountSOL,
			Status:        "pending",
		}
	}

	if err := db.DB.Create(&items).Error; err != nil {
		return fmt.Errorf("failed to create batch items: %w", err)
	}

	// Note: pending rows were already deleted atomically by ProcessPendingBatches
	// (SELECT FOR UPDATE SKIP LOCKED + DELETE in one transaction) — no delete here.

	// Execute batch transfer
	logging.Info().
		Str("batch_id", batch.ID.String()).
		Int("count", len(items)).
		Float64("total_sol", totalAmount).
		Msg("Processing batch payout")

	txHash, err := bp.batchFunc(ctx, items)
	now := time.Now()

	if err != nil {
		// On-chain call failed — safe to re-queue (no SOL was sent).
		errMsg := err.Error()
		batch.Status = models.BatchStatusFailed
		batch.ErrorMessage = &errMsg
		batch.ProcessedAt = &now
		db.DB.Save(&batch)

		db.DB.Model(&models.BatchPayoutItem{}).
			Where("batch_id = ?", batch.ID).
			Updates(map[string]interface{}{
				"status":        "failed",
				"error_message": errMsg,
			})

		bp.requeueIndividual(items)
		return err
	}

	// P0-03: On-chain transfer succeeded. Persist txHash + 'submitted' status
	// BEFORE marking complete. If the process dies here, the status 'submitted'
	// with a non-empty txHash tells the next run that money is already in-flight —
	// do NOT re-queue.
	batch.Status = models.BatchStatusSubmitted
	batch.TxHash = &txHash
	batch.ProcessedAt = &now
	if dbErr := saveBatchWithRetry(&batch, 3); dbErr != nil {
		// DB is persistently unavailable. Log CRITICAL with txHash so ops can
		// reconcile manually — do NOT re-queue (SOL is already sent).
		logging.Error(dbErr).
			Str("batch_id", batch.ID.String()).
			Str("tx_hash", txHash).
			Float64("total_sol", totalAmount).
			Msg("CRITICAL: on-chain payout sent but DB record could not be persisted — manual reconciliation required")
		return dbErr
	}

	// DB write confirmed — now finalize to 'completed'.
	batch.Status = models.BatchStatusCompleted
	batch.SuccessCount = len(items)
	db.DB.Save(&batch)

	db.DB.Model(&models.BatchPayoutItem{}).
		Where("batch_id = ?", batch.ID).
		Update("status", "completed")

	// Calculate and log savings
	savings := models.CalculateSavings(len(items), bp.config)
	logging.Info().
		Str("batch_id", batch.ID.String()).
		Str("tx_hash", txHash).
		Int("count", len(items)).
		Float64("savings_sol", savings).
		Msg("Batch payout completed")

	// P2-13: Financial audit trail.
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
		// Check existing retry count before re-queuing
		var existing models.PayoutRetryQueue
		if err := db.DB.Where("provider_id = ? AND wallet_address = ? AND status = 'pending'",
			item.ProviderID, item.WalletAddress).First(&existing).Error; err == nil {
			if existing.AttemptCount >= maxPayoutRetryAttempts {
				logging.Error(fmt.Errorf("payout permanently failed after %d attempts", maxPayoutRetryAttempts)).
					Str("provider_id", item.ProviderID.String()).
					Str("wallet_address", item.WalletAddress).
					Float64("amount_sol", item.AmountSOL).
					Msg("CRITICAL: payout abandoned — manual intervention required")
				// Mark the existing entry as permanently failed so it stops cycling.
				db.DB.Model(&existing).Updates(map[string]interface{}{"status": "abandoned"})
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

	// Total batches
	db.DB.Model(&models.BatchPayout{}).Count(&stats.TotalBatches)

	// Total payouts (sum of counts)
	db.DB.Model(&models.BatchPayout{}).
		Select("COALESCE(SUM(total_count), 0)").
		Scan(&stats.TotalPayouts)

	// Total amount
	db.DB.Model(&models.BatchPayout{}).
		Select("COALESCE(SUM(total_amount), 0)").
		Scan(&stats.TotalAmountSOL)

	// Average batch size
	if stats.TotalBatches > 0 {
		stats.AverageBatchSize = float64(stats.TotalPayouts) / float64(stats.TotalBatches)
	}

	// Calculate savings
	stats.SavingsPercent = 30.0 // Estimated based on config

	return &stats, nil
}

// GetPendingCount returns the number of payouts waiting in queue
func (bp *BatchPayoutProcessor) GetPendingCount() (int64, error) {
	var count int64
	err := db.DB.Model(&models.PendingPayout{}).
		Where("scheduled_for IS NULL OR scheduled_for <= ?", time.Now()).
		Count(&count).Error
	return count, err
}

// ForceProcess forces immediate processing of all pending payouts
func (bp *BatchPayoutProcessor) ForceProcess(ctx context.Context) error {
	logging.Info().Msg("Force processing all pending batch payouts")
	return bp.ProcessPendingBatches(ctx)
}
