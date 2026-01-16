package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

func RegisterUsageRoutes(r *gin.RouterGroup) {
	usage := r.Group("/usage")
	{
		usage.POST("/report", reportUsage)
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

		// Update Redis real-time counter
		if err := redisClient.IncrementUsage(report.SessionUsername, totalBytes); err != nil {
			continue
		}

		// Get session data to find user
		sessionData, err := redisClient.GetSession(report.SessionUsername)
		if err != nil {
			continue
		}

		// Calculate cost (0.50 GHS per GB)
		gbUsed := float64(totalBytes) / (1024 * 1024 * 1024)
		cost := gbUsed * 0.50 // GHS per GB

		// Deduct from user's wallet
		if cost > 0.001 { // Only deduct if meaningful amount
			var wallet models.Wallet
			if result := db.DB.Where("user_id = ?", sessionData.UserID).First(&wallet); result.Error == nil {
				// Create ledger entry for usage
				ledgerEntry := models.WalletLedgerEntry{
					WalletID:    wallet.ID,
					Type:        models.TransactionUsage,
					Amount:      -cost, // Negative for deduction
					Description: "Proxy usage: " + report.SessionUsername,
				}
				db.DB.Create(&ledgerEntry)

				// Update wallet balance
				db.DB.Model(&wallet).Update("balance", wallet.Balance-cost)
			}
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
		"cost_ghs":        float64(usage) / (1024 * 1024 * 1024) * 0.50,
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

	// Get all sessions for user from DB
	var sessions []models.Session
	db.DB.Where("user_id = ?", userID).Find(&sessions)

	var totalUsage int64 = 0
	sessionStats := make([]gin.H, 0)

	for _, session := range sessions {
		usage, _ := redisClient.GetUsage(session.CredentialsUser)
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
		"total_cost_ghs": float64(totalUsage) / (1024 * 1024 * 1024) * 0.50,
		"sessions":       sessionStats,
	})
}
