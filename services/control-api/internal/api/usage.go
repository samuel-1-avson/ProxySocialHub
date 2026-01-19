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

		// Update Redis real-time counter (Session based)
		if err := redisClient.IncrementUsage(report.SessionUsername, totalBytes); err != nil {
			continue
		}

		// Update Provider-Link counter (For Oracle claiming)
		// We need providerID + buyerAddress.
		// Ideally we get this from Session Data.
		sData, err := redisClient.GetSession(report.SessionUsername)
		if err == nil {
			// Assume UserID is Buyer Address for now (in Crypto flow)
			_ = redisClient.IncrementProviderUsage(sData.ProviderID, sData.UserID, totalBytes)
		}

		// Get session data
		sessionData, err := redisClient.GetSession(report.SessionUsername)
		if err != nil {
			continue
		}

		// Publish Billing Event (Async)
		// This decouples billing/analytics from the critical path
		go func(data *redisClient.SessionData, up, down int64) {
			// Generate Oracle Signature for usage
			// Matches Smart Contract: keccak256(abi.encodePacked(buyer, provider, bytesUsed, nonce))
			var signature []byte
			var nonce uint64 = uint64(time.Now().UnixNano()) // Use timestamp as nonce for now
			// In production, maintain a nonce counter in Redis

			if signer := GetOracleSigner(); signer != nil {
				// We need ETH addresses. Assuming UserID/ProviderID stored in Redis were ETH addresses
				// If not, we can't sign properly. For this demo, we assume they are valid hex addresses
				// or valid enough for the Signer check (it checks IsHexAddress).
				// If they are not hex, sign will fail.
				sig, err := signer.SignUsage(data.UserID, data.ProviderID,
					new(big.Int).SetUint64(uint64(up+down)),
					new(big.Int).SetUint64(nonce),
				)
				if err != nil {
					logging.Error(err).Msg("Failed to sign usage data")
				} else {
					signature = sig
				}
			}

			if q := GetEventQueue(); q != nil {
				// Use fire-and-forget
				_ = q.Publish(context.Background(), events.Event{
					ID:        "evt_bw_" + time.Now().Format("20060102150405"), // Simple ID
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

		// Check quota/limit
		currentUsage, _ := redisClient.GetUsage(report.SessionUsername)

		if sessionData.BandwidthLimit > 0 && currentUsage >= sessionData.BandwidthLimit {
			// Quota exceeded - Terminate session
			// 1. Remove from Redis (auth checks will fail)
			redisClient.DeleteSession(report.SessionUsername)

			// 2. Update DB status
			db.DB.Model(&models.Session{}).
				Where("credentials_user = ?", report.SessionUsername).
				Updates(map[string]interface{}{
					"status":     models.SessionTerminated,
					"end_reason": "quota_exceeded",
				})

			// 3. Mark Order as "completed" if linked? (Optional, skipping for now)
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

	usageMap, err := redisClient.GetBatchUsage(sessionIDs)
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
	// 1. Get Authenticated Provider
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
	bytesUsed, err := redisClient.GetTotalProviderUsage(providerID, req.BuyerAddress)
	if err != nil {
		logging.Error(err).Msg("Failed to retrieve usage stats")
		// If Redis fails, we might want to fail the request or return 0
		// For now, let's retun error to be safe
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve usage data"})
		return
	}

	if bytesUsed == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No usage found to claim"})
		return
	}

	// 5. Generate Nonce (Atomic Redis Counter)
	// Prevents replay attacks and ensures sequential ordering per pair
	nonce, err := redisClient.IncrementNonce(providerID, req.BuyerAddress)
	if err != nil {
		logging.Error(err).Msg("Failed to generate nonce")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Crypto failure"})
		return
	}

	// 6. Sign
	// Use math/big for large numbers
	signature, err := signer.SignUsage(
		req.BuyerAddress,
		providerID,
		big.NewInt(bytesUsed),
		new(big.Int).SetUint64(nonce),
	)

	if err != nil {
		logging.Error(err).Msg("Failed to generate signature")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Signing failure"})
		return
	}

	// 7. Respond
	c.JSON(http.StatusOK, gin.H{
		"signature":     fmt.Sprintf("0x%x", signature),
		"buyer":         req.BuyerAddress,
		"provider":      providerID,
		"bytes_used":    bytesUsed,
		"nonce":         nonce,
		"token_address": "0x0000000000000000000000000000000000000000",
	})
}
