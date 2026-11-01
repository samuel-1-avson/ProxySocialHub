package api

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/orders/fsm"
)

// sandboxBuyOrder creates an order and simulates escrow activation in one call.
// Gated by PROXYHUB_ALLOW_DEV_ESCROW_ACTIVATE (partner sandbox / local E2E only).
func sandboxBuyOrder(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "dev_escrow_simulation", "source_of_truth")

	if !devEscrowActivateEnabled() {
		c.JSON(http.StatusNotFound, gin.H{"error": "sandbox buy is not enabled on this environment"})
		return
	}

	c.Set("sandbox_buy", true)
	createOrder(c)
}

// finalizeSandboxBuy activates escrow simulation and returns credentials after order create.
func finalizeSandboxBuy(c *gin.Context, order *models.Order, buyerID uuid.UUID) bool {
	if order.SessionID == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Order has no linked session"})
		return false
	}

	if order.Status != models.OrderStatusActive && order.Status != models.OrderStatusCompleted {
		if err := fsm.TransitionOrder(db.DB, order, models.OrderStatusActive, "api.orders.sandbox_buy", nil); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return false
		}
	}

	if err := marketplace.ActivateOrderSession(context.Background(), order.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Session activation failed", "details": err.Error()})
		return false
	}

	var session models.Session
	if err := db.DB.First(&session, "id = ?", *order.SessionID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Session not found"})
		return false
	}

	actor := buyerID
	RecordAuditLog(c, models.AuditOrderDevActivated, models.AuditSeverityInfo, &actor, "order", order.ID.String(),
		"Sandbox buy activated order without on-chain escrow", true)

	db.DB.Preload("Buyer", counterpartyColumns).Preload("Seller", counterpartyColumns).Preload("Listing").First(order, "id = ?", order.ID)

	c.JSON(http.StatusCreated, gin.H{
		"order":             order,
		"proxy_credentials": buildProxyCredentialsResponse(&session),
		"sandbox":           true,
		"dev_escrow":        true,
	})
	return true
}
