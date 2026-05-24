package api

import (
	"context"
	"net/http"
	"strconv"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
)

// RegisterAdminPayoutRoutes registers admin payout management routes.
// P0-19: all routes are protected by JWT auth + admin-permission check.
func RegisterAdminPayoutRoutes(r *gin.RouterGroup) {
	payouts := r.Group("/admin/payouts", AuthMiddleware(), RequirePermission("admin"))
	{
		// Batch payout management
		payouts.GET("/queue", getPayoutQueue)
		payouts.POST("/process", forceProcessBatches)
		payouts.GET("/batches", getBatchHistory)
		payouts.GET("/batches/:id", getBatchDetails)
		payouts.GET("/stats", getPayoutStats)

		// Individual payout retry
		payouts.POST("/retry/:id", retryFailedPayout)
	}
}

// getPayoutQueue returns the current pending payout queue
func getPayoutQueue(c *gin.Context) {
	// Get pending count from batch processor
	processor := billing.GetBatchProcessor()
	if processor == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Batch processor not initialized"})
		return
	}

	pendingCount, err := processor.GetPendingCount()
	if err != nil {
		logging.Error(err).Msg("Failed to get pending count")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get queue status"})
		return
	}

	// Get actual pending items
	var pending []models.PendingPayout
	limit := 50
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	db.DB.Where("scheduled_for IS NULL OR scheduled_for <= NOW()").
		Order("priority DESC, queued_at ASC").
		Limit(limit).
		Find(&pending)

	// Calculate total pending amount
	var totalPending float64
	for _, p := range pending {
		totalPending += p.AmountSOL
	}

	c.JSON(http.StatusOK, gin.H{
		"pending_count":  pendingCount,
		"displayed":      len(pending),
		"total_pending":  totalPending,
		"items":          pending,
	})
}

// forceProcessBatches forces immediate processing of all pending batches
func forceProcessBatches(c *gin.Context) {
	processor := billing.GetBatchProcessor()
	if processor == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Batch processor not initialized"})
		return
	}

	go func() {
		if err := processor.ForceProcess(context.Background()); err != nil {
			logging.Error(err).Msg("Force batch processing failed")
		}
	}()

	c.JSON(http.StatusAccepted, gin.H{
		"status":  "processing",
		"message": "Batch processing started in background",
	})
}

// getBatchHistory returns processed batch history
func getBatchHistory(c *gin.Context) {
	limit := 20
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	offset := 0
	if o := c.Query("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	status := c.Query("status")

	var batches []models.BatchPayout
	query := db.DB.Order("created_at DESC").Limit(limit).Offset(offset)
	if status != "" {
		query = query.Where("status = ?", status)
	}
	query.Find(&batches)

	var total int64
	db.DB.Model(&models.BatchPayout{}).Count(&total)

	c.JSON(http.StatusOK, gin.H{
		"batches": batches,
		"total":   total,
		"limit":   limit,
		"offset":  offset,
	})
}

// getBatchDetails returns details of a specific batch
func getBatchDetails(c *gin.Context) {
	batchID := c.Param("id")

	var batch models.BatchPayout
	if err := db.DB.Where("id = ?", batchID).First(&batch).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Batch not found"})
		return
	}

	// Load items
	var items []models.BatchPayoutItem
	db.DB.Where("batch_id = ?", batchID).Find(&items)

	c.JSON(http.StatusOK, gin.H{
		"batch": batch,
		"items": items,
	})
}

// getPayoutStats returns payout statistics
func getPayoutStats(c *gin.Context) {
	processor := billing.GetBatchProcessor()
	if processor == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Batch processor not initialized"})
		return
	}

	stats, err := processor.GetStats()
	if err != nil {
		logging.Error(err).Msg("Failed to get payout stats")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get stats"})
		return
	}

	// Get additional stats
	var pendingCount int64
	db.DB.Model(&models.PendingPayout{}).Count(&pendingCount)

	var retryCount int64
	db.DB.Model(&models.PayoutRetryQueue{}).Where("status = 'pending'").Count(&retryCount)

	var todayTotal float64
	db.DB.Model(&models.BatchPayout{}).
		Where("created_at >= CURRENT_DATE").
		Select("COALESCE(SUM(total_amount), 0)").
		Scan(&todayTotal)

	c.JSON(http.StatusOK, gin.H{
		"batch_stats":   stats,
		"pending_count": pendingCount,
		"retry_count":   retryCount,
		"today_total":   todayTotal,
	})
}

// retryFailedPayout retries a failed individual payout
func retryFailedPayout(c *gin.Context) {
	payoutID := c.Param("id")

	var item models.BatchPayoutItem
	if err := db.DB.Where("id = ? AND status = 'failed'", payoutID).First(&item).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Failed payout not found"})
		return
	}

	// FIN-002: Verify the underlying escrow is settled on-chain before queuing a
	// retry. Look up the provider's pending earnings → orders to find escrow PDAs,
	// then call IsEscrowSettled. Block the retry if any linked escrow is unsettled.
	if oracle := solana.GetOracleClient(); oracle != nil {
		var earnings []models.ProviderEarning
		db.DB.
			Select("session_id").
			Where("provider_user_id = ? AND status = 'pending'", item.ProviderID).
			Limit(20).
			Find(&earnings)

		for _, earning := range earnings {
			var order models.Order
			if err := db.DB.Select("escrow_pda").
				Where("session_id = ? AND escrow_pda != ''", earning.SessionID).
				First(&order).Error; err != nil {
				continue
			}
			pda, err := sol.PublicKeyFromBase58(order.EscrowPDA)
			if err != nil {
				continue
			}
			settled, err := oracle.IsEscrowSettled(c.Request.Context(), pda)
			if err != nil {
				logging.Warn().Str("escrow", order.EscrowPDA).Msg("retryFailedPayout: IsEscrowSettled check failed, proceeding cautiously")
				continue
			}
			if !settled {
				c.JSON(http.StatusConflict, gin.H{
					"error":      "Payout blocked: linked escrow has not been settled on-chain yet",
					"escrow_pda": order.EscrowPDA,
				})
				return
			}
		}
	}

	// Add to retry queue
	retry := models.PayoutRetryQueue{
		ProviderID:    item.ProviderID,
		WalletAddress: item.WalletAddress,
		AmountSOL:     item.AmountSOL,
		Status:        "pending",
	}
	if err := db.DB.Create(&retry).Error; err != nil {
		logging.Error(err).Msg("Failed to create retry entry")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to queue retry"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":    "queued",
		"retry_id":  retry.ID,
		"message":   "Payout queued for retry",
	})
}
