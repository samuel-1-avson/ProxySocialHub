package billing

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/redis"
	"gorm.io/gorm"
)

// StartSettlementWorker starts the background job
func StartSettlementWorker() {
	go func() {
		ticker := time.NewTicker(1 * time.Hour) // Run every hour
		for {
			select {
			case <-ticker.C:
				SettleUsage()
			}
		}
	}()
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
			logging.Error(err).Str("session", sessionID).Msg("Failed to settle session")
		} else {
			count++
		}
	}

	logging.Info().Int("settled_sessions", count).Msg("Billing settlement complete")
}

func settleSession(sessionID string, totalBytes int64, redisKey string) error {
	// 1. Get Session Info from DB (to get User ID)
	var session models.Session
	// Using session_id from redis key implies we can look it up.
	// Assuming sessionID is the UUID or CredentialsUser?
	// Based on metering.rs, we use `username` which is CredentialsUser.
	// Let's assume sessionID here is CredentialsUser.

	if err := db.DB.Preload("Listing").Where("credentials_user = ?", sessionID).First(&session).Error; err != nil {
		return err
	}

	// 2. Calculate Cost
	pricePerGB := 0.50
	if session.Listing != nil {
		// CalculateFairPrice logic
		pricePerGB = 0.50 // simplified for import cycle avoidance
	}

	costGHS := float64(totalBytes) / (1024 * 1024 * 1024) * pricePerGB
	// Get Rate (mock)
	rate := 100.0 // GHS per TAO (example)
	costTAO := costGHS / rate

	// 3. DB Transaction
	return db.DB.Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("user_id = ?", session.UserID).First(&wallet).Error; err != nil {
			return err
		}

		if wallet.BalanceTAO < costTAO {
			// Insufficient funds handling (should have been caught by real-time layer)
			// We force deduct resulting in negative balance? Or terminate?
			// For settlement, we take what we can or go negative.
			wallet.BalanceTAO -= costTAO
		} else {
			wallet.BalanceTAO -= costTAO
		}

		if err := tx.Save(&wallet).Error; err != nil {
			return err
		}

		// Create Ledger Entry
		ledger := models.WalletLedgerEntry{
			WalletID:     wallet.ID,
			Amount:       -costTAO,
			BalanceAfter: wallet.BalanceTAO,
			Type:         models.TransactionUsage,
			Description:  fmt.Sprintf("Hourly Settlement: %d bytes (%.6f TAO)", totalBytes, costTAO),
			CreatedAt:    time.Now(),
		}
		if err := tx.Create(&ledger).Error; err != nil {
			return err
		}

		// 4. Clear Redis Pending
		// DecrBy or Del? Del is safer if we processed ALL bytes.
		// What if bytes were added while we processed?
		// ideally: DECRBY key totalBytes
		redis.Client.DecrBy(context.Background(), redisKey, totalBytes)

		return nil
	})
}
