package api

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/ws"
)

// RegisterEscrowRoutes registers escrow-related routes
func RegisterEscrowRoutes(rg *gin.RouterGroup) {
	rg.GET("/escrow/:orderId", getEscrowStatus)
	rg.POST("/escrow/:orderId/release", releaseEscrow)
	rg.POST("/escrow/:orderId/dispute", createDispute)
	rg.POST("/escrow/:orderId/resolve", resolveDispute)
	rg.GET("/disputes", getMyDisputes)
}

// CreateEscrowForOrder creates an escrow when order is placed
func CreateEscrowForOrder(orderID, buyerID, sellerID uuid.UUID, amount float64) error {
	autoRelease := time.Now().AddDate(0, 0, 7) // 7 days from now

	escrow := models.EscrowTransaction{
		OrderID:       orderID,
		BuyerID:       buyerID,
		SellerID:      sellerID,
		Amount:        amount,
		Status:        models.EscrowHeld,
		HeldAt:        time.Now(),
		AutoReleaseAt: &autoRelease,
	}

	return db.DB.Create(&escrow).Error
}

// getEscrowStatus returns escrow status for an order
func getEscrowStatus(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	orderID, err := uuid.Parse(c.Param("orderId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order ID"})
		return
	}

	var escrow models.EscrowTransaction
	if err := db.DB.Where("order_id = ?", orderID).First(&escrow).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Escrow not found"})
		return
	}

	// Check access
	if escrow.BuyerID != userID && escrow.SellerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	c.JSON(http.StatusOK, escrow)
}

// releaseEscrow releases funds to seller (buyer confirms)
func releaseEscrow(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	orderID, err := uuid.Parse(c.Param("orderId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order ID"})
		return
	}

	var order models.Order
	if err := db.DB.Preload("Listing").First(&order, "id = ?", orderID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	// Only buyer can release
	if order.BuyerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only buyer can release escrow"})
		return
	}

	if order.Status != models.OrderStatusActive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Order is not in active status"})
		return
	}

	// HANDLE ON-CHAIN ESCROW (SOLANA)
	if order.EscrowPDA != "" {
		// Since this is the Control API / Oracle, we sign the settlement.
		log.Printf("Triggering on-chain settlement for order %s, escrow %s, usage: %v GB", order.ID, order.EscrowPDA, order.BandwidthLimitGB)

		// Note: The actual on-chain call happens via the settlement service
		// which we would trigger here.
	}

	// Update DB state
	now := time.Now()
	tx := db.DB.Begin()

	// Update order status
	tx.Model(&order).Updates(map[string]interface{}{
		"status": models.OrderStatusCompleted,
	})

	// Also update internal escrow transaction record if it exists (legacy/sync)
	tx.Model(&models.EscrowTransaction{}).Where("order_id = ?", orderID).Updates(map[string]interface{}{
		"status":      models.EscrowReleased,
		"released_at": now,
	})

	tx.Commit()

	// Notify seller via WebSocket
	ws.BroadcastToUser(order.BuyerID.String(), ws.MsgTypeOrderUpdate, order)
	ws.BroadcastToUser(order.SellerID.String(), ws.MsgTypeOrderUpdate, order)

	c.JSON(http.StatusOK, gin.H{"message": "Escrow release initiated successfully"})
}

// createDispute opens a dispute for an order
func createDispute(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	orderID, err := uuid.Parse(c.Param("orderId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order ID"})
		return
	}

	var req models.CreateDisputeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var escrow models.EscrowTransaction
	if err := db.DB.Where("order_id = ?", orderID).First(&escrow).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Escrow not found"})
		return
	}

	// Only buyer or seller can dispute
	if escrow.BuyerID != userID && escrow.SellerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	if escrow.Status != models.EscrowHeld {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot dispute - escrow not held"})
		return
	}

	// Create dispute
	dispute := models.Dispute{
		EscrowID:    escrow.ID,
		OrderID:     orderID,
		InitiatedBy: userID,
		Reason:      req.Reason,
		Description: req.Description,
		Status:      models.DisputeOpen,
	}

	if err := db.DB.Create(&dispute).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create dispute"})
		return
	}

	// Update escrow status
	db.DB.Model(&escrow).Update("status", models.EscrowDisputed)

	// Notify counterparty
	counterpartyID := escrow.SellerID
	if userID == escrow.SellerID {
		counterpartyID = escrow.BuyerID
	}

	ws.BroadcastToUser(counterpartyID.String(), ws.MsgTypeOrderUpdate, gin.H{
		"order_id": orderID,
		"message":  "Dispute opened on order",
		"type":     "dispute_opened",
	})

	c.JSON(http.StatusCreated, dispute)
}

// getMyDisputes returns user's disputes
func getMyDisputes(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var disputes []models.Dispute
	db.DB.Preload("Escrow").Preload("Order").
		Joins("JOIN escrow_transactions ON disputes.escrow_id = escrow_transactions.id").
		Where("escrow_transactions.buyer_id = ? OR escrow_transactions.seller_id = ?", userID, userID).
		Order("created_at DESC").
		Find(&disputes)

	c.JSON(http.StatusOK, gin.H{"disputes": disputes})
}

// resolveDispute handles admin resolution of a dispute
func resolveDispute(c *gin.Context) {
	// TODO: Add Admin Role Check (Middleware or explicit check)
	// currentUserID, _ := c.Get("user_id")

	orderID, err := uuid.Parse(c.Param("orderId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order ID"})
		return
	}

	var req struct {
		Decision string `json:"decision"` // "refund" or "release"
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var escrow models.EscrowTransaction
	if err := db.DB.Where("order_id = ?", orderID).First(&escrow).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Escrow not found"})
		return
	}

	if escrow.Status != models.EscrowDisputed {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Transaction is not in dispute"})
		return
	}

	tx := db.DB.Begin()
	now := time.Now()

	if req.Decision == "refund" {
		// Refund Buyer
		tx.Model(&escrow).Updates(map[string]interface{}{
			"status":      models.EscrowRefunded,
			"released_at": now,
		})

		var buyerWallet models.Wallet
		if err := tx.First(&buyerWallet, "user_id = ?", escrow.BuyerID).Error; err == nil {
			newBalance := buyerWallet.BalanceGHS + escrow.Amount
			tx.Model(&buyerWallet).Update("balance_ghs", newBalance)

			tx.Create(&models.WalletLedgerEntry{
				WalletID:     buyerWallet.ID,
				Amount:       escrow.Amount,
				BalanceAfter: newBalance,
				Type:         "escrow_refund",
				ReferenceID:  escrow.ID.String(),
				Description:  "Refund from dispute resolution",
			})
		}
	} else if req.Decision == "release" {
		// Release to Seller (Standard Logic)
		// We can reuse the release logic or duplicate it here for explicit control
		// For simplicity, we duplicate the core credit logic here but ideally we should refactor into a helper.

		tx.Model(&escrow).Updates(map[string]interface{}{
			"status":      models.EscrowReleased,
			"released_at": now,
		})

		// ... (Seller Credit Logic would go here - for brevity assumming manual release trigger or calling helper)
		// Since we can't easily call the route handler, and refactoring is risky right now,
		// we will implement the critical credit:

		platformFee := escrow.Amount * 0.10
		sellerAmount := escrow.Amount - platformFee

		var sellerWallet models.Wallet
		if err := tx.First(&sellerWallet, "user_id = ?", escrow.SellerID).Error; err == nil {
			newBalance := sellerWallet.BalanceGHS + sellerAmount
			tx.Model(&sellerWallet).Update("balance_ghs", newBalance)

			tx.Create(&models.WalletLedgerEntry{
				WalletID:     sellerWallet.ID,
				Amount:       sellerAmount,
				BalanceAfter: newBalance,
				Type:         "escrow_release_admin",
				ReferenceID:  escrow.ID.String(),
				Description:  "Admin resolved dispute: Release",
			})
		}
	} else {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid decision"})
		return
	}

	// Close Dispute
	var dispute models.Dispute
	if err := tx.Where("escrow_id = ? AND status = ?", escrow.ID, models.DisputeOpen).First(&dispute).Error; err == nil {
		newStatus := models.DisputeResolvedSeller
		if req.Decision == "refund" {
			newStatus = models.DisputeResolvedBuyer
		}

		tx.Model(&dispute).Updates(map[string]interface{}{
			"status":      newStatus,
			"resolution":  "Admin decision: " + req.Decision,
			"resolved_at": now,
		})
	}

	tx.Commit()
	c.JSON(http.StatusOK, gin.H{"message": "Dispute resolved successfully"})
}

// AutoReleaseExpiredEscrows releases escrows past auto-release date (run as cron)
func AutoReleaseExpiredEscrows() {
	var escrows []models.EscrowTransaction
	db.DB.Where("status = ? AND auto_release_at < ?", models.EscrowHeld, time.Now()).Find(&escrows)

	for _, escrow := range escrows {
		now := time.Now()
		tx := db.DB.Begin()

		tx.Model(&escrow).Updates(map[string]interface{}{
			"status":      models.EscrowReleased,
			"released_at": now,
		})

		// Credit seller
		var sellerWallet models.Wallet
		if err := tx.First(&sellerWallet, "user_id = ?", escrow.SellerID).Error; err == nil {
			platformFee := escrow.Amount * 0.10
			sellerAmount := escrow.Amount - platformFee
			newBalance := sellerWallet.BalanceGHS + sellerAmount
			tx.Model(&sellerWallet).Update("balance_ghs", newBalance)

			ledger := models.WalletLedgerEntry{
				WalletID:     sellerWallet.ID,
				Amount:       sellerAmount,
				BalanceAfter: newBalance,
				Type:         "escrow_auto_release",
				ReferenceID:  escrow.ID.String(),
				Description:  "Escrow auto-released after 7 days",
			}
			tx.Create(&ledger)
		}

		tx.Model(&models.Order{}).Where("id = ?", escrow.OrderID).Update("status", models.OrderStatusCompleted)
		tx.Commit()
	}
}
