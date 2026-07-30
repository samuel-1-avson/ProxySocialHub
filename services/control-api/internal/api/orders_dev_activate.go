package api

import (
	"context"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/orders/fsm"
)

// devEscrowActivateEnabled gates POST /v1/orders/:id/activate-dev (local/docker E2E only).
func devEscrowActivateEnabled() bool {
	if isTruthyEnv(os.Getenv("PROXYHUB_ALLOW_DEV_ESCROW_ACTIVATE")) {
		return true
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("GIN_MODE")), "release") {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV"))) {
	case "production", "prod", "staging":
		return false
	default:
		return false
	}
}

// activateDevOrder simulates on-chain escrow confirmation for integration/E2E tests.
func activateDevOrder(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "dev_escrow_simulation", "source_of_truth")

	if !devEscrowActivateEnabled() {
		c.JSON(http.StatusNotFound, gin.H{"error": "dev escrow activation is not enabled"})
		return
	}

	userID, err := parseAuthenticatedUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	orderID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order ID"})
		return
	}

	var order models.Order
	if err := db.DB.Preload("Listing").First(&order, "id = ?", orderID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}
	if order.BuyerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}
	if order.SessionID == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Order has no linked session"})
		return
	}

	if order.Status != models.OrderStatusActive && order.Status != models.OrderStatusCompleted {
		if err := fsm.TransitionOrder(db.DB, &order, models.OrderStatusActive, "api.orders.activate_dev", nil); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	if err := marketplace.ActivateOrderSession(context.Background(), order.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Session activation failed", "details": err.Error()})
		return
	}

	var session models.Session
	if err := db.DB.First(&session, "id = ?", *order.SessionID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Session not found"})
		return
	}

	actor := userID
	RecordAuditLog(c, models.AuditOrderDevActivated, models.AuditSeverityInfo, &actor, "order", order.ID.String(),
		"Dev escrow activation completed", true)

	c.JSON(http.StatusOK, gin.H{
		"order":             order,
		"proxy_credentials": buildProxyCredentialsResponse(&session),
		"dev_escrow":        true,
	})
}

func parseAuthenticatedUserID(c *gin.Context) (uuid.UUID, error) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				return id, nil
			}
			if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	return uuid.Parse(userIDStr)
}
