package billing

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/redis"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// providerPayoutThresholdSOL is the minimum accrued balance before a payout is queued.
// Note: Actual on-chain transfer happens via batch processing for efficiency.
const providerPayoutThresholdSOL = 0.05

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
	logging.Info().Msg("Starting billing settlement...")

	// 1. Scan all pending sessions
	// Keys: billing:session:{session_id}:pending
	iter := redis.Client.Scan(context.Background(), 0, "billing:session:*:pending", 0).Iterator()

	count := 0
	for iter.Next(context.Background()) {
		key := iter.Val()
		// H-5: The Redis key embeds credentials_user (not a session UUID).
		credentialsUser := strings.TrimPrefix(key, "billing:session:")
		credentialsUser = strings.TrimSuffix(credentialsUser, ":pending")

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
		if err := settleSession(credentialsUser, totalBytes, key); err != nil {
			logging.Error(err).Str("credentials_user", credentialsUser).Msg("Failed to settle session")
		} else {
			count++
		}
	}

	logging.Info().Int("settled_sessions", count).Msg("Billing settlement complete")
}

// H-5: parameter renamed from sessionID — the Redis key holds credentials_user, not a session UUID.
func settleSession(credentialsUser string, totalBytes int64, redisKey string) error {
	// 1. Get Session Info from DB
	var session models.Session
	if err := db.DB.Preload("Listing").Where("credentials_user = ?", credentialsUser).First(&session).Error; err != nil {
		return err
	}

	// 2. Calculate Cost using live prices
	// pricePerGB is set in USD by providers when creating listings; converted to SOL at settlement time.
	pricePerGB := 0.50 // USD/GB default
	if session.Listing != nil && session.Listing.PricePerGB > 0 {
		pricePerGB = session.Listing.PricePerGB
	}

	costUSD := float64(totalBytes) / (1024 * 1024 * 1024) * pricePerGB
	costSOL := USDToSOL(costUSD)

	// 3. DB Transaction
	return db.DB.Transaction(func(tx *gorm.DB) error {
		// Lock buyer wallet
		var wallet models.Wallet
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", session.UserID).First(&wallet).Error; err != nil {
			return err
		}

		// Check spending limits before charging
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

		// H-5: use session.ID (actual UUID) instead of uuid.Parse(credentialsUser) which always gave uuid.Nil
		if wallet.BalanceSOL < costSOL {
			logging.Warn().Str("session_id", session.ID.String()).Float64("need", costSOL).Float64("have", wallet.BalanceSOL).Msg("Billing: insufficient SOL balance, terminating session")
			return fmt.Errorf("insufficient SOL balance")
		}
		wallet.BalanceSOL -= costSOL

		// Record spending for limit tracking
		if err := wallet.RecordSpending(tx, costSOL, models.SpendingUsage, session.ID.String()); err != nil {
			logging.Error(err).Str("session_id", session.ID.String()).Msg("Failed to record spending, continuing")
			// Don't fail the transaction, just log the error
		}

		if err := tx.Save(&wallet).Error; err != nil {
			return err
		}

		// Create Ledger Entry (buyer debit)
		solPriceUSD := GetSOLPriceUSD()
		ledger := models.WalletLedgerEntry{
			WalletID:     wallet.ID,
			Amount:       -costSOL,
			BalanceAfter: wallet.BalanceSOL,
			Type:         models.TransactionUsage,
			Description:  fmt.Sprintf("Usage: %d bytes / $%.4f USD / %.6f SOL (@$%.2f/SOL)", totalBytes, costUSD, costSOL, solPriceUSD),
			CreatedAt:    time.Now(),
		}
		if err := tx.Create(&ledger).Error; err != nil {
			return err
		}

		// Credit provider's internal wallet and update score
		var providerID uuid.UUID
		if session.Listing != nil && session.Listing.SellerID != uuid.Nil {
			providerID = session.Listing.SellerID
		}

		if providerID != uuid.Nil {
			// C-4: Lock provider wallet (FOR UPDATE) to prevent lost-update race
			// when multiple sessions for the same provider settle concurrently.
			var providerWallet models.Wallet
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", providerID).First(&providerWallet).Error; err == nil {
				providerWallet.BalanceSOL += costSOL
				if err := tx.Save(&providerWallet).Error; err == nil {
					tx.Create(&models.WalletLedgerEntry{
						WalletID:     providerWallet.ID,
						Amount:       costSOL,
						BalanceAfter: providerWallet.BalanceSOL,
						Type:         "provider_earning",
						Description:  fmt.Sprintf("Bandwidth earnings: %d bytes / %.6f SOL (devnet)", totalBytes, costSOL),
						CreatedAt:    time.Now(),
					})

					// Queue payout for batch processing if threshold reached
					if providerWallet.BalanceSOL >= providerPayoutThresholdSOL {
						go queueProviderPayout(providerID)
					}
				}
			}

			// Update provider score
			var score models.ProviderScore
			if err := tx.FirstOrCreate(&score, models.ProviderScore{ProviderID: providerID}).Error; err == nil {
				latency := getSessionLatency(session.ID)
				score.RecordSessionCompletion(true, totalBytes, latency)
				tx.Save(&score)
			}
		}

		// 4. Clear Redis pending counter — delete the key entirely after a successful
		// settlement so it does not linger until the 48 h TTL (I6 improvement).
		// credentialsUser is used as the key segment for billing:session:* keys;
		// the session:*:usage keys (incremented by IncrementUsage) are expired via
		// their own TTL set in the pipeline inside redis.IncrementUsage.
		if err := redis.Client.Del(context.Background(), redisKey).Err(); err != nil {
			logging.Warn().Str("redis_key", redisKey).Err(err).Msg("billing: failed to delete settled Redis key")
		}

		return nil
	})
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
			"attempt_count":    entry.AttemptCount + 1,
			"last_attempted_at": now,
			"updated_at":       now,
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
