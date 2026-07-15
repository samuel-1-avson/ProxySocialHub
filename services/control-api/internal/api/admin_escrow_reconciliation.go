package api

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/models"
)

type escrowReconciliationSummaryRow struct {
	Status string `json:"status"`
	Count  int64  `json:"count"`
}

type escrowReconciliationResponse struct {
	Events  []models.EscrowReconciliationEvent `json:"events"`
	Summary []escrowReconciliationSummaryRow   `json:"summary"`
	Total   int64                              `json:"total"`
	Page    int                                `json:"page"`
	Limit   int                                `json:"limit"`
}

func listEscrowReconciliationEvents(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 50
	}
	offset := (page - 1) * limit

	status := c.Query("status")
	source := c.Query("source")
	eventType := c.Query("event_type")
	escrowPDA := c.Query("escrow_pda")

	query := db.DB.Model(&models.EscrowReconciliationEvent{})
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if source != "" {
		query = query.Where("source = ?", source)
	}
	if eventType != "" {
		query = query.Where("event_type = ?", eventType)
	}
	if escrowPDA != "" {
		query = query.Where("escrow_pda = ?", escrowPDA)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count escrow reconciliation events"})
		return
	}

	var events []models.EscrowReconciliationEvent
	if err := query.
		Preload("Order").
		Order("last_seen_at DESC").
		Offset(offset).
		Limit(limit).
		Find(&events).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list escrow reconciliation events"})
		return
	}

	var summary []escrowReconciliationSummaryRow
	db.DB.Model(&models.EscrowReconciliationEvent{}).
		Select("status, COUNT(*) AS count").
		Group("status").
		Order("status ASC").
		Scan(&summary)

	c.JSON(http.StatusOK, escrowReconciliationResponse{
		Events:  events,
		Summary: summary,
		Total:   total,
		Page:    page,
		Limit:   limit,
	})
}

func retryEscrowReconciliationEvent(c *gin.Context) {
	eventID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid reconciliation event ID"})
		return
	}

	var event models.EscrowReconciliationEvent
	if err := db.DB.First(&event, "id = ?", eventID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Reconciliation event not found"})
		return
	}

	if event.Source != marketplace.SessionActivationEventSource || event.EventType != marketplace.SessionActivationEventType {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":      "Only session activation reconciliation events can be retried from this endpoint",
			"source":     event.Source,
			"event_type": event.EventType,
		})
		return
	}
	if event.OrderID == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Reconciliation event has no linked order"})
		return
	}

	if err := marketplace.ActivateOrderSession(c.Request.Context(), *event.OrderID); err != nil {
		c.JSON(http.StatusConflict, gin.H{
			"error":    "Session activation retry failed",
			"details":  err.Error(),
			"event_id": event.ID,
			"order_id": event.OrderID,
		})
		return
	}

	var refreshed models.EscrowReconciliationEvent
	db.DB.Preload("Order").First(&refreshed, "id = ?", event.ID)
	c.JSON(http.StatusOK, gin.H{
		"message": "Session activation retry succeeded",
		"event":   refreshed,
	})
}
