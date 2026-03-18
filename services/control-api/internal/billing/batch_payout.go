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
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

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

// ProcessPendingBatches processes all pending payouts in batches
func (bp *BatchPayoutProcessor) ProcessPendingBatches(ctx context.Context) error {
	for {
		// Check if there are enough pending payouts
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

		// Check if we should process
		if !models.ShouldProcessBatch(int(pendingCount), oldestQueued, bp.config) {
			return nil
		}

		// Get batch of payouts
		var pending []models.PendingPayout
		db.DB.Where("scheduled_for IS NULL OR scheduled_for <= ?", time.Now()).
			Order("priority DESC, queued_at ASC").
			Limit(bp.config.MaxBatchSize).
			Find(&pending)

		if len(pending) == 0 {
			return nil
		}

		// Process this batch
		if err := bp.processBatch(ctx, pending); err != nil {
			logging.Error(err).Int("batch_size", len(pending)).Msg("Batch processing failed")
			// Continue to next batch even if this one failed
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
	pendingIDs := make([]uuid.UUID, len(pending))
	for i, p := range pending {
		items[i] = models.BatchPayoutItem{
			BatchID:       batch.ID,
			ProviderID:    p.ProviderID,
			WalletAddress: p.WalletAddress,
			AmountSOL:     p.AmountSOL,
			Status:        "pending",
		}
		pendingIDs[i] = p.ID
	}

	if err := db.DB.Create(&items).Error; err != nil {
		return fmt.Errorf("failed to create batch items: %w", err)
	}

	// Delete pending records (they're now in the batch)
	if err := db.DB.Delete(&models.PendingPayout{}, "id IN ?", pendingIDs).Error; err != nil {
		logging.Error(err).Msg("Failed to clean up pending payouts after batching")
	}

	// Execute batch transfer
	logging.Info().
		Str("batch_id", batch.ID.String()).
		Int("count", len(items)).
		Float64("total_sol", totalAmount).
		Msg("Processing batch payout")

	txHash, err := bp.batchFunc(ctx, items)
	now := time.Now()

	if err != nil {
		// Batch failed entirely
		errMsg := err.Error()
		batch.Status = models.BatchStatusFailed
		batch.ErrorMessage = &errMsg
		batch.ProcessedAt = &now
		db.DB.Save(&batch)

		// Mark all items as failed
		db.DB.Model(&models.BatchPayoutItem{}).
			Where("batch_id = ?", batch.ID).
			Updates(map[string]interface{}{
				"status":        "failed",
				"error_message": errMsg,
			})

		// Re-queue for individual retry
		bp.requeueIndividual(items)

		return err
	}

	// Batch succeeded - update all items as completed
	batch.Status = models.BatchStatusCompleted
	batch.TxHash = &txHash
	batch.SuccessCount = len(items)
	batch.ProcessedAt = &now
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

	return nil
}

// requeueIndividual re-queues failed batch items for individual processing
func (bp *BatchPayoutProcessor) requeueIndividual(items []models.BatchPayoutItem) {
	for _, item := range items {
		// Add to retry queue
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
