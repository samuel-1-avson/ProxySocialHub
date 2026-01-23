package api

import (
	"context"
	"fmt"
	"math/big"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/events"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"gorm.io/gorm"
)

const PricePerGB = 0.50 // GHS per GB

func RegisterUsageRoutes(r *gin.RouterGroup) {
	usage := r.Group("/usage")
	{
		usage.POST("/report", reportUsage)
		usage.POST("/sign", signUsageClaim) // New endpoint for providers
		usage.GET("/session/:session_id", getSessionUsage)
		usage.GET("/me", getUserUsage) // Use authenticated user
	}
}

type usageReportRequest struct {
	SessionUsername string `json:"session_username" binding:"required"`
	BytesUp         int64  `json:"bytes_up"`
	BytesDown       int64  `json:"bytes_down"`
}

type batchUsageRequest struct {
	Reports []usageReportRequest `json:"reports" binding:"required"`
}

// reportUsage handles batch usage reports from the Gateway
func reportUsage(c *gin.Context) {
	var req batchUsageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// Try single report format
		var single usageReportRequest
		if err := c.ShouldBindJSON(&single); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		req.Reports = []usageReportRequest{single}
	}

	processed := 0
	for _, report := range req.Reports {
		totalBytes := report.BytesUp + report.BytesDown

		// Get session data from Redis (Source of Truth for Edge Gateway)
		sessionData, err := redisClient.GetSession(report.SessionUsername)
		if err != nil {
			logging.Warn().Err(err).Str("session_username", report.SessionUsername).Msg("Session data not found in Redis during reporting, skipping")
			continue
		}

		// Update Redis real-time counter (Session based)
		if err := redisClient.IncrementUsage(report.SessionUsername, totalBytes); err != nil {
			logging.Error(err).Str("session", report.SessionUsername).Msg("Failed to increment session usage in Redis")
		}

		// Update Provider-Link counter (For Oracle claiming)
		if sessionData.ProviderID != "" && sessionData.UserID != "" {
			_ = redisClient.IncrementProviderUsage(sessionData.ProviderID, sessionData.UserID, totalBytes)
		}

		// Publish Billing Event (Async)
		// This decouples billing/analytics from the critical path
		go func(data *redisClient.SessionData, up, down int64) {
			defer func() {
				if r := recover(); r != nil {
					logging.Error(fmt.Errorf("panic in billing event: %v", r)).Msg("Recovered from panic in billing goroutine")
				}
			}()

			var signature []byte
			var nonce uint64 = uint64(time.Now().UnixNano())

			if signer := GetOracleSigner(); signer != nil {
				// We need ETH addresses for the Oracle.
				// Fallback to internal IDs if address is not stored (handled by signer validation)
				sig, err := signer.SignUsage(data.UserID, data.ProviderID,
					new(big.Int).SetUint64(uint64(up+down)),
					new(big.Int).SetUint64(nonce),
				)
				if err != nil {
					logging.Debug().Err(err).Msg("Skipped oracle signing (not in crypto mode or invalid addresses)")
				} else {
					signature = sig
				}
			}

			if q := GetEventQueue(); q != nil {
				_ = q.Publish(context.Background(), events.Event{
					ID:        fmt.Sprintf("evt_bw_%d_%s", time.Now().Unix(), data.SessionID),
					Type:      events.EventTypeBandwidthConsumed,
					Timestamp: time.Now(),
					Source:    "control-api",
					Payload: map[string]interface{}{
						"session_username": report.SessionUsername,
						"user_id":          data.UserID,
						"provider_id":      data.ProviderID,
						"bytes_up":         up,
						"bytes_down":       down,
						"total_bytes":      up + down,
						"plan_type":        "pay_per_gb",
						"nonce":            nonce,
						"signature":        fmt.Sprintf("0x%x", signature),
					},
				})
			}
		}(sessionData, report.BytesUp, report.BytesDown)

		// IaaS Billing Pivot (Real-time Deduction in TAO)
		// Fetch Proxy Listing for Price Calculation - Database Check
		var session models.Session
		if err := db.DB.Preload("Listing").Where("credentials_user = ?", report.SessionUsername).First(&session).Error; err != nil {
			logging.Warn().Str("session", report.SessionUsername).Msg("Session not found in DB during billing, skipping deduction")
			continue
		}

		var currentPricePerGB float64 = 0.50
		if session.Listing != nil {
			currentPricePerGB = CalculateFairPrice(*session.Listing)
		}

		rate := GetTaoToGhsRate()
		costGHS := float64(totalBytes) / (1024 * 1024 * 1024) * currentPricePerGB
		costTAO := costGHS / rate

		// 3. Atomic Balance Deduction (DB Lock)
		var wallet models.Wallet
		// Use a transaction for safety
		err = db.DB.Transaction(func(tx *gorm.DB) error {
			if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("user_id = ?", sessionData.UserID).First(&wallet).Error; err != nil {
				return err
			}

			// AUTO-MIGRATE if needed (Safety check)
			if wallet.Currency != "TAO" {
				// Ideally logging here
			}

			if wallet.BalanceTAO < costTAO {
				// 4. Insufficient Funds -> Terminate
				redisClient.DeleteSession(report.SessionUsername)

				// Update session status asynchronously to avoid blocking tx
				go func() {
					db.DB.Model(&models.Session{}).
						Where("credentials_user = ?", report.SessionUsername).
						Updates(map[string]interface{}{
							"status":     models.SessionTerminated,
							"end_reason": "insufficient_funds",
						})
				}()

				return fmt.Errorf("insufficient funds")
			}

			// Deduct
			wallet.BalanceTAO -= costTAO
			if err := tx.Save(&wallet).Error; err != nil {
				return err
			}

			// Log Transaction
			ledger := models.WalletLedgerEntry{
				WalletID:     wallet.ID,
				Amount:       -costTAO,
				BalanceAfter: wallet.BalanceTAO,
				Type:         models.TransactionUsage,
				Description:  fmt.Sprintf("Usage: %d bytes (%.6f TAO @ %.2f/GB)", totalBytes, costTAO, currentPricePerGB),
				CreatedAt:    time.Now(),
			}
			return tx.Create(&ledger).Error
		})

		if err != nil {
			// If transaction failed or insufficient funds, we logged it.
			// Gateway should receive a "Stop" signal ideally.
			// For HTTP reporting, we can return a directive in the response,
			// but this function is void in the loop.
			// We rely on Redis deletion to stop future auth checks.
		}

		processed++
	}

	c.JSON(http.StatusOK, gin.H{
		"processed": processed,
		"total":     len(req.Reports),
	})
}

// getSessionUsage returns usage stats for a specific session
func getSessionUsage(c *gin.Context) {
	sessionID := c.Param("session_id")

	// Get from Redis
	usage, err := redisClient.GetUsage(sessionID)
	if err != nil {
		usage = 0
	}

	// Get session data
	sessionData, _ := redisClient.GetSession(sessionID)

	var limit int64 = 0
	if sessionData != nil {
		limit = sessionData.BandwidthLimit
	}

	c.JSON(http.StatusOK, gin.H{
		"session_id":      sessionID,
		"bytes_used":      usage,
		"bytes_limit":     limit,
		"percent_used":    float64(usage) / float64(limit) * 100,
		"gb_used":         float64(usage) / (1024 * 1024 * 1024),
		"cost_ghs":        float64(usage) / (1024 * 1024 * 1024) * PricePerGB,
		"last_updated_at": time.Now(),
	})
}

// getUserUsage returns aggregated usage for the authenticated user
func getUserUsage(c *gin.Context) {
	userID := c.GetString("userID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Filter by status (optional), default to "active" to prevent slow queries on huge history
	status := c.Query("status")
	if status == "" {
		status = "active" // Default optimization
	}

	// 1. Get filtered sessions from DB
	var sessions []models.Session
	query := db.DB.Where("user_id = ?", userID)

	if status != "all" {
		query = query.Where("status = ?", status)
	}

	// Limit to reasonable number if "all" is requested to prevent crash
	if status == "all" {
		query = query.Limit(100).Order("created_at DESC")
	}

	query.Find(&sessions)

	// 2. Batch get usage from Redis (Pipeline)
	sessionIDs := make([]string, len(sessions))
	for i, s := range sessions {
		sessionIDs[i] = s.CredentialsUser
	}

	redisStart := time.Now()
	usageMap, err := redisClient.GetBatchUsage(sessionIDs)
	RecordRedisBatchFetch(time.Since(redisStart).Seconds())

	if err != nil {
		logging.Error(err).Msg("Failed to batch fetch usage")
		// Continue with 0 usage on error
		usageMap = make(map[string]int64)
	}

	var totalUsage int64 = 0
	sessionStats := make([]gin.H, 0, len(sessions))

	// 3. Construct response
	for _, session := range sessions {
		usage := usageMap[session.CredentialsUser]
		totalUsage += usage

		sessionStats = append(sessionStats, gin.H{
			"session_id": session.ID,
			"type":       session.Type,
			"status":     session.Status,
			"bytes_used": usage,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"user_id":        userID,
		"total_bytes":    totalUsage,
		"total_gb":       float64(totalUsage) / (1024 * 1024 * 1024),
		"total_cost_ghs": float64(totalUsage) / (1024 * 1024 * 1024) * PricePerGB,
		"sessions":       sessionStats,
		"count":          len(sessions),
		"filter":         status,
	})
}

// signUsageRequest represents the request to sign usage for a specific buyer
type signUsageRequest struct {
	BuyerAddress string `json:"buyer_address" binding:"required"`
}

// signUsageClaim generates an Oracle signature for a provider to claim earnings from a buyer
func signUsageClaim(c *gin.Context) {
	// 1. Get Authenticated Provider (Internal User ID)
	providerID := c.GetString("userID")
	if providerID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	// 2. Bind Request
	var req signUsageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 3. Get Oracle Signer
	signer := GetOracleSigner()
	if signer == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Oracle signer not configured"})
		return
	}

	// 4. Retrieve Usage Stats from Redis
	// Fetch real usage for this provider-buyer pair
	// Note: req.BuyerAddress IS the wallet address from the client perspective,
	// but in Redis we stored Internal UserID. So we need to map Buyer Address -> Internal UserID to look up usage,
	// OR we stored usage keyed by Internal UserID.
	// Let's assume Redis keys are: usage:provider:{providerID}:user:{userID}.

	// Reverse Lookup: Find UserID from BuyerAddress (Wallet)
	var buyerUser models.User
	if err := db.DB.Where("wallet_address = ? OR bittensor_address = ?", req.BuyerAddress, req.BuyerAddress).First(&buyerUser).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Buyer wallet not registered"})
		return
	}

	bytesUsed, err := redisClient.GetTotalProviderUsage(providerID, buyerUser.ID.String())
	if err != nil {
		logging.Error(err).Msg("Failed to retrieve usage stats")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve usage data"})
		return
	}

	if bytesUsed == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No usage found to claim"})
		return
	}

	// 5. Generate Nonce
	nonce, err := redisClient.IncrementNonce(providerID, buyerUser.ID.String())
	if err != nil {
		logging.Error(err).Msg("Failed to generate nonce")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Crypto failure"})
		return
	}

	// 6. Resolve Provider Wallet Address
	var providerUser models.User
	if err := db.DB.Where("id = ?", providerID).First(&providerUser).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Provider profile error"})
		return
	}

	providerWallet := ""
	if providerUser.WalletAddress != nil {
		providerWallet = *providerUser.WalletAddress
	}
	// Fallback or prefer specific chain logic if needed.
	if providerWallet == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Provider must link a wallet to claim earnings"})
		return
	}

	// 7. Sign (Using WALLET ADDRESSES now)
	signature, err := signer.SignUsage(
		req.BuyerAddress, // Client provided wallet address (verified exists)
		providerWallet,   // Provider's linked wallet
		big.NewInt(bytesUsed),
		new(big.Int).SetUint64(nonce),
	)

	if err != nil {
		logging.Error(err).Msg("Failed to generate signature")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Signing failure"})
		return
	}

	// 8. Respond
	c.JSON(http.StatusOK, gin.H{
		"signature":     fmt.Sprintf("0x%x", signature),
		"buyer":         req.BuyerAddress,
		"provider":      providerWallet,
		"bytes_used":    bytesUsed,
		"nonce":         nonce,
		"token_address": "0x0000000000000000000000000000000000000000",
	})
}
