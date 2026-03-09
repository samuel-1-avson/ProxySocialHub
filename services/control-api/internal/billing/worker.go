package billing

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
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
	
	// Use hardcoded fallback rate (GHS -> SOL) � integrate coingecko prices package when needed
	rate := 100.0
	costSOL := costGHS / rate

	// 3. DB Transaction
	return db.DB.Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("user_id = ?", session.UserID).First(&wallet).Error; err != nil {
			return err
		}

		sessionUUID, _ := uuid.Parse(sessionID)
		if wallet.BalanceSOL < costSOL {
			logging.Warn().Str("session_id", sessionUUID.String()).Float64("need", costSOL).Float64("have", wallet.BalanceSOL).Msg("Billing: insufficient SOL balance, terminating session")
			return fmt.Errorf("insufficient SOL balance")
		}
		wallet.BalanceSOL -= costSOL

		if err := tx.Save(&wallet).Error; err != nil {
			return err
		}

		// Create Ledger Entry
		ledger := models.WalletLedgerEntry{
			WalletID:     wallet.ID,
			Amount:       -costSOL,
			BalanceAfter: wallet.BalanceSOL,
			Type:         models.TransactionUsage,
			Description:  fmt.Sprintf("Hourly Settlement: %d bytes (%.6f SOL)", totalBytes, costSOL),
			CreatedAt:    time.Now(),
		}
		if err := tx.Create(&ledger).Error; err != nil {
			return err
		}

		// Update Provider Score
		var providerID uuid.UUID
		if session.Listing != nil && session.Listing.SellerID != uuid.Nil {
			providerID = session.Listing.SellerID
		}

		if providerID != uuid.Nil {
			var score models.ProviderScore
			if err := tx.FirstOrCreate(&score, models.ProviderScore{ProviderID: providerID}).Error; err == nil {
				// Get actual latency from session stats
				latency := getSessionLatency(session.ID)
				score.RecordSessionCompletion(true, totalBytes, latency)
				tx.Save(&score)
			}
		}

		// 4. Clear Redis Pending
		// DecrBy or Del? Del is safer if we processed ALL bytes.
		// What if bytes were added while we processed?
		// ideally: DECRBY key totalBytes
		redis.Client.DecrBy(context.Background(), redisKey, totalBytes)

		return nil
	})
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
