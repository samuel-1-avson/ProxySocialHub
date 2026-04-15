package billing

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/sessionintent"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// providerPayoutThresholdSOL is the minimum accrued balance before a payout is queued.
// Note: Actual on-chain transfer happens via batch processing for efficiency.
const providerPayoutThresholdSOL = 0.05

// P3-13: Circuit breaker — prevents thread saturation when Solana RPC is degraded.
// After cbMaxFailures consecutive failures inside a cbWindow window the worker
// pauses for cbPauseDuration before resuming.
const (
	cbMaxFailures   = 3
	cbWindow        = 60 * time.Second
	cbPauseDuration = 5 * time.Minute
)

const cbRedisKey = "circuit:payout:state"

type circuitBreaker struct {
	mu          sync.Mutex
	failures    []time.Time // timestamps of recent failures
	pausedUntil time.Time
}

var settlementCB = &circuitBreaker{}

// recordFailure adds a failure timestamp and returns true if the breaker just tripped.
// When tripped, the pause deadline is persisted to Redis so a service restart does
// not immediately retry into a degraded Solana RPC (4.1).
func (cb *circuitBreaker) recordFailure() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-cbWindow)
	fresh := cb.failures[:0]
	for _, t := range cb.failures {
		if t.After(cutoff) {
			fresh = append(fresh, t)
		}
	}
	fresh = append(fresh, now)
	cb.failures = fresh
	if len(cb.failures) >= cbMaxFailures {
		cb.pausedUntil = now.Add(cbPauseDuration)
		cb.failures = cb.failures[:0]
		// Persist to Redis — if the process restarts while tripped, isOpen() will
		// restore the deadline from Redis instead of resetting to zero.
		redis.Client.Set(context.Background(), cbRedisKey,
			cb.pausedUntil.Unix(), cbPauseDuration)
		return true
	}
	return false
}

// isOpen returns true when the breaker is tripped and settlement must be skipped.
// On first call after a restart, hydrates pausedUntil from Redis if the in-memory
// value is zero (4.1).
func (cb *circuitBreaker) isOpen() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	now := time.Now()
	// In-memory state is authoritative while the process is running.
	if cb.pausedUntil.After(now) {
		return true
	}
	// After a restart pausedUntil is zero — check Redis for a persisted deadline.
	if cb.pausedUntil.IsZero() {
		if val, err := redis.Client.Get(context.Background(), cbRedisKey).Int64(); err == nil {
			persisted := time.Unix(val, 0)
			if persisted.After(now) {
				cb.pausedUntil = persisted
				return true
			}
		}
	}
	return false
}

// recordSuccess resets the failure window and clears the Redis persisted state.
func (cb *circuitBreaker) recordSuccess() {
	cb.mu.Lock()
	cb.failures = cb.failures[:0]
	cb.pausedUntil = time.Time{} // zero so isOpen re-checks Redis next time if needed
	cb.mu.Unlock()
	redis.Client.Del(context.Background(), cbRedisKey)
}

// globalBatchProcessor is the singleton batch payout processor
var globalBatchProcessor *BatchPayoutProcessor

// InitBatchProcessor initializes the batch payout processor
func InitBatchProcessor(sendFunc func(ctx context.Context, recipient string, amountSOL float64) error,
	batchFunc func(ctx context.Context, items []models.BatchPayoutItem) (string, error)) {
	config := models.DefaultBatchConfig()
	globalBatchProcessor = NewBatchPayoutProcessor(config, sendFunc, batchFunc)
}

// GetBatchProcessor returns the global batch processor instance
func GetBatchProcessor() *BatchPayoutProcessor {
	return globalBatchProcessor
}

// StartSettlementWorker starts the background jobs
func StartSettlementWorker() {
	// Start settlement worker
	go func() {
		ticker := time.NewTicker(1 * time.Hour) // Run every hour
		for {
			select {
			case <-ticker.C:
				SettleUsage()
			}
		}
	}()

	// Start batch payout processor if initialized
	if globalBatchProcessor != nil {
		globalBatchProcessor.Start(context.Background())
		logging.Info().Msg("Batch payout processor started")
	}
}

// SettleUsage moves pending usage from Redis to SQL Ledger
func SettleUsage() {
	// P3-13: Respect circuit breaker — skip the entire run if the breaker is open.
	if settlementCB.isOpen() {
		logging.Warn().Msg("Billing settlement skipped: circuit breaker is open (Solana RPC degraded)")
		return
	}

	logging.Info().Msg("Starting billing settlement...")

	// 1. Scan all pending sessions
	// Keys: billing:session:{session_id}:pending
	iter := redis.Client.Scan(context.Background(), 0, "billing:session:*:pending", 0).Iterator()

	count := 0
	for iter.Next(context.Background()) {
		key := iter.Val()
		// P1-19: The Redis key format is billing:session:{sessionID}:pending
		// where sessionID is the session UUID primary key.
		sessionID := strings.TrimPrefix(key, "billing:session:")
		sessionID = strings.TrimSuffix(sessionID, ":pending")

		// Get Bytes
		bytesStr, err := redis.Client.Get(context.Background(), key).Result()
		if err != nil {
			continue
		}

		// Parse bytes (simple atoi)
		var totalBytes int64
		fmt.Sscanf(bytesStr, "%d", &totalBytes)

		if totalBytes == 0 {
			continue
		}

		// 2. Process Settlement for this Session
		if err := settleSession(sessionID, totalBytes, key); err != nil {
			logging.Error(err).Str("session_id", sessionID).Msg("Failed to settle session")
		} else {
			count++
		}
	}

	logging.Info().Int("settled_sessions", count).Msg("Billing settlement complete")
}

// P1-19: sessionID is the UUID primary key extracted from the Redis key.
// P2-06: Orchestrates three focused helpers — computeSessionCost,
// debitBuyerWallet, creditProviderWallet — each independently testable.
func settleSession(sessionID string, totalBytes int64, redisKey string) error {
	var session models.Session
	if err := db.DB.Preload("Listing").Where("id = ?", sessionID).First(&session).Error; err != nil {
		return err
	}

	costSOL, costUSD := computeSessionCost(&session, totalBytes)

	// queuePayoutAfterCommit is set inside the tx and consumed after commit (FW-02).
	var queuePayoutAfterCommit uuid.UUID

	if err := db.DB.Transaction(func(tx *gorm.DB) error {
		if err := debitBuyerWallet(tx, &session, totalBytes, costSOL, costUSD); err != nil {
			return err
		}

		shouldQueue, err := creditProviderWallet(tx, &session, totalBytes, costSOL)
		if err != nil {
			return err
		}
		if shouldQueue && session.Listing != nil {
			queuePayoutAfterCommit = session.Listing.SellerID
		}

		// Clear Redis key after successful settlement (I6).
		if err := redis.Client.Del(context.Background(), redisKey).Err(); err != nil {
			logging.Warn().Str("redis_key", redisKey).Err(err).Msg("billing: failed to delete settled Redis key")
		}
		return nil
	}); err != nil {
		// P3-13: Record failure; alert if the breaker just tripped.
		if tripped := settlementCB.recordFailure(); tripped {
			logging.Error(fmt.Errorf("circuit breaker tripped")).
				Str("session_id", sessionID).
				Dur("pause", cbPauseDuration).
				Msg("ALERT: billing settlement circuit breaker open — too many consecutive failures; settlement paused")
		}
		return err
	}

	// P3-13: Successful settlement resets the failure window.
	settlementCB.recordSuccess()

	if err := markSettlementArtifactsSettled(session.ID); err != nil {
		logging.Warn().Err(err).Str("session_id", session.ID.String()).Msg("Billing: failed to mark settlement artifacts settled")
	}

	if queuePayoutAfterCommit != uuid.Nil {
		go queueProviderPayout(queuePayoutAfterCommit)
	}
	return nil
}

func markSettlementArtifactsSettled(sessionID uuid.UUID) error {
	now := time.Now().UTC()
	return db.DB.Transaction(func(tx *gorm.DB) error {
		var session models.Session
		if err := tx.Select("id", "user_id", "listing_id", "node_id").First(&session, "id = ?", sessionID).Error; err != nil {
			return err
		}

		if err := tx.Model(&models.UsageReceipt{}).
			Where("session_id = ? AND status IN ?", sessionID, []models.UsageReceiptStatus{models.UsageReceiptPending, models.UsageReceiptAggregated, models.UsageReceiptFailed}).
			Updates(map[string]interface{}{
				"status":     models.UsageReceiptSettled,
				"settled_at": now,
				"last_error": nil,
			}).Error; err != nil {
			return err
		}

		if err := tx.Model(&models.SettlementManifest{}).
			Where("session_id = ? AND status IN ?", sessionID, []models.SettlementManifestStatus{models.SettlementManifestOpen, models.SettlementManifestCoordinated, models.SettlementManifestFailed}).
			Updates(map[string]interface{}{
				"status":     models.SettlementManifestSettled,
				"settled_at": now,
				"last_error": nil,
			}).Error; err != nil {
			return err
		}

		return advanceSessionIntentSettlementLifecycle(tx, &session, now)
	})
}

func advanceSessionIntentSettlementLifecycle(tx *gorm.DB, session *models.Session, now time.Time) error {
	record, err := findSessionIntentForSettlement(tx, session)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}

	updates := map[string]interface{}{}
	if sessionintent.CanAdvanceGatewayLifecycle(record.LifecycleState, models.SessionIntentLedgerCommitted) {
		sessionintent.ApplyLifecycleTransition(&record, updates, models.SessionIntentLedgerCommitted, now)
		record.LifecycleState = models.SessionIntentLedgerCommitted
	}

	for _, next := range []models.SessionIntentLifecycle{
		models.SessionIntentBatched,
		models.SessionIntentChainCommitted,
		models.SessionIntentArchived,
	} {
		if !sessionintent.CanAdvanceSettlementLifecycle(record.LifecycleState, next) {
			continue
		}
		sessionintent.ApplyLifecycleTransition(&record, updates, next, now)
		record.LifecycleState = next
	}

	if len(updates) == 0 {
		return nil
	}

	updates["updated_at"] = now
	return tx.Model(&models.SessionIntentRecord{}).
		Where("id = ?", record.ID).
		Updates(updates).Error
}

func findSessionIntentForSettlement(tx *gorm.DB, session *models.Session) (models.SessionIntentRecord, error) {
	buildQuery := func() *gorm.DB {
		query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("user_id = ?", session.UserID).
			Where("lifecycle_state IN ?", []models.SessionIntentLifecycle{
				models.SessionIntentActive,
				models.SessionIntentClosing,
				models.SessionIntentLedgerCommitted,
				models.SessionIntentBatched,
				models.SessionIntentChainCommitted,
			})

		if session.ListingID != nil {
			query = query.Where("listing_id = ?", *session.ListingID)
		} else {
			query = query.Where("listing_id IS NULL")
		}

		return query.Order("updated_at DESC").Order("created_at DESC")
	}

	if session.NodeID != nil {
		var exact models.SessionIntentRecord
		if err := buildQuery().Where("provider_node_id = ?", session.NodeID.String()).First(&exact).Error; err == nil {
			return exact, nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return models.SessionIntentRecord{}, err
		}
	}

	var record models.SessionIntentRecord
	err := buildQuery().First(&record).Error
	return record, err
}

// computeSessionCost returns (costSOL, costUSD) for totalBytes of consumption.
func computeSessionCost(session *models.Session, totalBytes int64) (costSOL, costUSD float64) {
	pricePerGB := 0.50 // USD/GB default
	if session.Listing != nil && session.Listing.PricePerGB > 0 {
		pricePerGB = session.Listing.PricePerGB
	}
	costUSD = float64(totalBytes) / (1024 * 1024 * 1024) * pricePerGB
	costSOL = USDToSOL(costUSD)
	return
}

// debitBuyerWallet checks spending limits, deducts costSOL from the buyer's locked
// wallet, records spending, and writes the debit ledger entry — all within tx.
func debitBuyerWallet(tx *gorm.DB, session *models.Session, totalBytes int64, costSOL, costUSD float64) error {
	var wallet models.Wallet
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("user_id = ?", session.UserID).First(&wallet).Error; err != nil {
		return err
	}

	if err := wallet.CheckSpendingLimit(tx, costSOL, models.SpendingUsage); err != nil {
		if spendingErr, ok := err.(*models.SpendingLimitError); ok {
			logging.Warn().
				Str("session_id", session.ID.String()).
				Str("limit_type", spendingErr.LimitType).
				Float64("limit", spendingErr.Limit).
				Float64("attempted", costSOL).
				Msg("Billing: spending limit would be exceeded")
			return fmt.Errorf("spending limit exceeded: %s limit of %.6f SOL", spendingErr.LimitType, spendingErr.Limit)
		}
		return err
	}

	if wallet.BalanceSOL < costSOL {
		logging.Warn().Str("session_id", session.ID.String()).
			Float64("need", costSOL).Float64("have", wallet.BalanceSOL).
			Msg("Billing: insufficient SOL balance")
		return fmt.Errorf("insufficient SOL balance")
	}
	wallet.BalanceSOL -= costSOL

	if err := wallet.RecordSpending(tx, costSOL, models.SpendingUsage, session.ID.String()); err != nil {
		logging.Error(err).Str("session_id", session.ID.String()).Msg("Failed to record spending, continuing")
	}
	if err := tx.Save(&wallet).Error; err != nil {
		return err
	}

	solPriceUSD := GetSOLPriceUSD()
	return tx.Create(&models.WalletLedgerEntry{
		WalletID:     wallet.ID,
		Amount:       -costSOL,
		BalanceAfter: wallet.BalanceSOL,
		Type:         models.TransactionUsage,
		Description:  fmt.Sprintf("Usage: %d bytes / $%.4f USD / %.6f SOL (@$%.2f/SOL)", totalBytes, costUSD, costSOL, solPriceUSD),
		CreatedAt:    time.Now(),
	}).Error
}

// creditProviderWallet credits the provider's wallet with costSOL inside tx and
// updates their quality score. Returns (true, nil) when the balance crosses the
// payout threshold — caller must queue a batch payout after the tx commits (FW-02).
//
// Provider resolution order:
//  1. session.Listing.SellerID  — marketplace sessions (from-listing path)
//  2. node.ProviderUserID       — quick-start / instant sessions (node assigned, no listing)
func creditProviderWallet(tx *gorm.DB, session *models.Session, totalBytes int64, costSOL float64) (bool, error) {
	var providerID uuid.UUID

	if session.Listing != nil && session.Listing.SellerID != uuid.Nil {
		providerID = session.Listing.SellerID
	} else if session.NodeID != nil {
		// No listing — resolve the node owner so the provider is still paid.
		var node models.Node
		if err := tx.Select("provider_user_id").First(&node, "id = ?", *session.NodeID).Error; err == nil {
			providerID = node.ProviderUserID
		}
	}

	if providerID == uuid.Nil {
		return false, nil
	}

	// P0-01: FirstOrCreate inside the locked tx — never silently lose funds.
	var providerWallet models.Wallet
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("user_id = ?", providerID).
		FirstOrCreate(&providerWallet, models.Wallet{UserID: providerID}).Error; err != nil {
		return false, fmt.Errorf("billing: failed to lock/create provider wallet for %s: %w", providerID, err)
	}

	providerWallet.BalanceSOL += costSOL
	if err := tx.Save(&providerWallet).Error; err != nil {
		return false, fmt.Errorf("billing: failed to credit provider wallet for %s: %w", providerID, err)
	}

	if err := tx.Create(&models.WalletLedgerEntry{
		WalletID:     providerWallet.ID,
		Amount:       costSOL,
		BalanceAfter: providerWallet.BalanceSOL,
		Type:         "provider_earning",
		Description:  fmt.Sprintf("Bandwidth earnings: %d bytes / %.6f SOL", totalBytes, costSOL),
		CreatedAt:    time.Now(),
	}).Error; err != nil {
		return false, fmt.Errorf("billing: failed to create provider ledger entry for %s: %w", providerID, err)
	}

	var score models.ProviderScore
	if err := tx.FirstOrCreate(&score, models.ProviderScore{ProviderID: providerID}).Error; err == nil {
		score.RecordSessionCompletion(true, totalBytes, getSessionLatency(session.ID))
		tx.Save(&score)
	}

	return providerWallet.BalanceSOL >= providerPayoutThresholdSOL, nil
}

// triggerProviderPayout sends accumulated SOL from treasury to provider's linked Solana wallet.
// Runs in a goroutine — errors are logged but do not affect billing settlement.
// C-3: pendingSOL parameter removed — the locked payoutAmount from the DB transaction is used
// for all on-chain operations so the deducted amount always matches what is sent.
func triggerProviderPayout(providerID uuid.UUID) {
	ctx := context.Background()

	// N-07: Prefer the provider's primary verified linked Solana wallet.
	// Fall back to the legacy profile wallet_address if no linked wallet is set.
	walletAddress, err := resolveProviderWallet(providerID)
	if err != nil {
		logging.Warn().Str("provider_id", providerID.String()).Err(err).Msg("Provider payout: no payable wallet found")
		return
	}

	// C-3: Capture the locked balance inside the transaction so the on-chain transfer
	// always sends exactly what was deducted from the DB — no stale snapshot.
	var payoutAmount float64

	txErr := db.DB.Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", providerID).First(&wallet).Error; err != nil {
			return err
		}
		if wallet.BalanceSOL < providerPayoutThresholdSOL {
			return fmt.Errorf("balance dropped below threshold before payout")
		}
		payoutAmount = wallet.BalanceSOL // captured for use after the transaction
		wallet.BalanceSOL = 0
		if err := tx.Save(&wallet).Error; err != nil {
			return err
		}
		tx.Create(&models.WalletLedgerEntry{
			WalletID:     wallet.ID,
			Amount:       -payoutAmount,
			BalanceAfter: 0,
			Type:         models.TransactionPayout,
			Description:  fmt.Sprintf("On-chain payout to %s (%.6f SOL devnet)", walletAddress, payoutAmount),
			CreatedAt:    time.Now(),
		})
		return nil
	})
	if txErr != nil {
		logging.Error(txErr).Str("provider_id", providerID.String()).Msg("Provider payout: wallet deduction failed")
		return
	}

	// C-3: Send the locked payoutAmount on-chain, not the stale goroutine argument.
	if err := sendSOLToWallet(ctx, walletAddress, payoutAmount); err != nil {
		// Enqueue to retry queue instead of silently dropping or refunding.
		errMsg := err.Error()
		now := time.Now()
		entry := models.PayoutRetryQueue{
			ProviderID:      providerID,
			WalletAddress:   walletAddress,
			AmountSOL:       payoutAmount, // C-3: use locked amount, not stale arg
			AttemptCount:    1,
			LastAttemptedAt: &now,
			NextRetryAt:     now.Add(2 * time.Minute),
			Status:          "pending",
			ErrorMessage:    &errMsg,
		}
		if dbErr := db.DB.Create(&entry).Error; dbErr != nil {
			db.DB.Model(&models.Wallet{}).Where("user_id = ?", providerID).
				Update("balance_sol", gorm.Expr("balance_sol + ?", payoutAmount))
			logging.Error(dbErr).Str("provider_id", providerID.String()).Msg("Provider payout: failed to enqueue retry — balance restored")
		} else {
			logging.Error(err).Str("provider_id", providerID.String()).Str("retry_id", entry.ID.String()).Msg("Provider payout: on-chain transfer failed, queued for retry")
		}
		return
	}

	logging.Info().
		Str("provider_id", providerID.String()).
		Str("wallet", walletAddress).
		Float64("amount_sol", payoutAmount). // C-3: log the actual sent amount
		Msg("Provider payout completed on-chain (devnet)")
}

// queueProviderPayout queues a provider payout for batch processing.
// This is the preferred method as it saves gas by batching multiple payouts.
func queueProviderPayout(providerID uuid.UUID) {
	// Resolve provider wallet
	walletAddress, err := resolveProviderWallet(providerID)
	if err != nil {
		logging.Warn().Str("provider_id", providerID.String()).Err(err).Msg("Provider payout: no payable wallet found")
		return
	}

	// Lock balance and queue for batch processing
	var payoutAmount float64
	txErr := db.DB.Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", providerID).First(&wallet).Error; err != nil {
			return err
		}
		if wallet.BalanceSOL < providerPayoutThresholdSOL {
			return fmt.Errorf("balance dropped below threshold before payout")
		}
		payoutAmount = wallet.BalanceSOL
		wallet.BalanceSOL = 0
		if err := tx.Save(&wallet).Error; err != nil {
			return err
		}
		tx.Create(&models.WalletLedgerEntry{
			WalletID:     wallet.ID,
			Amount:       -payoutAmount,
			BalanceAfter: 0,
			Type:         models.TransactionPayout,
			Description:  fmt.Sprintf("Queued for batch payout to %s (%.6f SOL)", walletAddress, payoutAmount),
			CreatedAt:    time.Now(),
		})
		return nil
	})
	if txErr != nil {
		logging.Error(txErr).Str("provider_id", providerID.String()).Msg("Provider payout: failed to queue for batch")
		return
	}

	// Queue for batch processing
	if globalBatchProcessor != nil {
		if err := globalBatchProcessor.QueuePayout(providerID, walletAddress, payoutAmount, nil); err != nil {
			logging.Error(err).Str("provider_id", providerID.String()).Msg("Failed to queue payout for batch processing")
			// Fall back to immediate processing
			go triggerProviderPayout(providerID)
			return
		}
		logging.Info().
			Str("provider_id", providerID.String()).
			Float64("amount", payoutAmount).
			Msg("Provider payout queued for batch processing")
	} else {
		// Batch processor not initialized, use immediate processing
		logging.Warn().Str("provider_id", providerID.String()).Msg("Batch processor not initialized, using immediate payout")
		go triggerProviderPayout(providerID)
	}
}

// resolveProviderWallet returns the best payout address for a provider.
// Priority: primary verified linked Solana wallet → profile wallet_address.
func resolveProviderWallet(providerID uuid.UUID) (string, error) {
	// 1. Primary verified linked wallet (N-07)
	var linked models.LinkedWallet
	err := db.DB.Where(
		"user_id = ? AND chain = 'solana' AND is_primary = true AND verified = true AND deleted_at IS NULL",
		providerID,
	).First(&linked).Error
	if err == nil {
		return linked.Address, nil
	}

	// 2. Fall back to profile wallet_address
	var user models.User
	if err := db.DB.Select("wallet_address").Where("id = ?", providerID).First(&user).Error; err != nil {
		return "", fmt.Errorf("user not found: %w", err)
	}
	if user.WalletAddress == nil || *user.WalletAddress == "" {
		return "", fmt.Errorf("no linked Solana wallet configured")
	}
	return *user.WalletAddress, nil
}

// sendSOLToWallet transfers SOL from the oracle/treasury to a recipient Solana address.
func sendSOLToWallet(ctx context.Context, recipientAddress string, amountSOL float64) error {
	// Import is done via the solana package — use the global oracle client
	// We avoid import cycles by keeping this as a thin wrapper
	// The actual oracle client is registered in main.go via solana.InitOracleClient
	// Here we use a package-level function pointer set at startup.
	if globalSendSOL == nil {
		return fmt.Errorf("SOL transfer function not initialized")
	}
	return globalSendSOL(ctx, recipientAddress, amountSOL)
}

// globalSendSOL is set by main.go after the oracle client is initialized.
// This avoids an import cycle between billing and solana packages.
var globalSendSOL func(ctx context.Context, recipient string, amountSOL float64) error

// SetSOLTransferFunc registers the on-chain SOL transfer implementation.
// Must be called from main.go after initializing the oracle client.
func SetSOLTransferFunc(fn func(ctx context.Context, recipient string, amountSOL float64) error) {
	globalSendSOL = fn
}

// StartPayoutRetryWorker polls payout_retry_queue every 5 minutes and retries
// failed on-chain payouts with exponential backoff (max 8 attempts, then marks permanent failure).
func StartPayoutRetryWorker() {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			processPayoutRetries()
		}
	}()
}

func processPayoutRetries() {
	ctx := context.Background()
	var entries []models.PayoutRetryQueue
	if err := db.DB.
		Where("status = ? AND next_retry_at <= ?", "pending", time.Now()).
		Order("next_retry_at ASC").
		Limit(50).
		Find(&entries).Error; err != nil {
		logging.Error(err).Msg("Payout retry worker: failed to query retry queue")
		return
	}

	for _, entry := range entries {
		now := time.Now()
		err := sendSOLToWallet(ctx, entry.WalletAddress, entry.AmountSOL)

		update := map[string]interface{}{
			"attempt_count":     entry.AttemptCount + 1,
			"last_attempted_at": now,
			"updated_at":        now,
		}

		if err == nil {
			update["status"] = "succeeded"
			update["error_message"] = nil
			logging.Info().
				Str("retry_id", entry.ID.String()).
				Str("wallet", entry.WalletAddress).
				Float64("amount_sol", entry.AmountSOL).
				Int("attempt", entry.AttemptCount+1).
				Msg("Payout retry succeeded")
		} else {
			errMsg := err.Error()
			update["error_message"] = errMsg
			nextAttempt := entry.AttemptCount + 1
			if nextAttempt >= 8 {
				update["status"] = "failed_permanent"
				logging.Error(err).
					Str("retry_id", entry.ID.String()).
					Int("attempts", nextAttempt).
					Msg("Payout retry: permanent failure after max attempts — manual intervention required")
			} else {
				// Exponential backoff: 2^attempt minutes, capped at ~2h
				backoffMins := math.Pow(2, float64(nextAttempt))
				if backoffMins > 128 {
					backoffMins = 128
				}
				update["next_retry_at"] = now.Add(time.Duration(backoffMins) * time.Minute)
				logging.Warn().
					Str("retry_id", entry.ID.String()).
					Int("attempt", nextAttempt).
					Float64("backoff_minutes", backoffMins).
					Msg("Payout retry: attempt failed, will retry")
			}
		}

		if dbErr := db.DB.Model(&models.PayoutRetryQueue{}).Where("id = ?", entry.ID).Updates(update).Error; dbErr != nil {
			logging.Error(dbErr).Str("retry_id", entry.ID.String()).Msg("Payout retry: failed to update queue entry")
		}
	}
}

// getSessionLatency retrieves the average latency for a session from Redis or database
func getSessionLatency(sessionID uuid.UUID) float64 {
	// Try to get from Redis first
	ctx := context.Background()
	latencyKey := fmt.Sprintf("session:%s:latency", sessionID.String())

	if redis.Client != nil {
		latency, err := redis.Client.Get(ctx, latencyKey).Float64()
		if err == nil && latency > 0 {
			return latency
		}
	}

	// Fallback: query database for session metrics
	var metrics models.SessionMetrics
	if err := db.DB.Where("session_id = ?", sessionID).Order("created_at DESC").First(&metrics).Error; err == nil {
		return metrics.AvgLatencyMs
	}

	// Default fallback if no data available
	return 0
}
