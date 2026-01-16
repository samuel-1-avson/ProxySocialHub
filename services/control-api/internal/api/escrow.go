package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterEscrowRoutes registers escrow-related routes
func RegisterEscrowRoutes(rg *gin.RouterGroup) {
	rg.GET("/escrow/:orderId", getEscrowStatus)
	rg.POST("/escrow/:orderId/release", releaseEscrow)
	rg.POST("/escrow/:orderId/dispute", createDispute)
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

	var escrow models.EscrowTransaction
	if err := db.DB.Where("order_id = ?", orderID).First(&escrow).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Escrow not found"})
		return
	}

	// Only buyer can release
	if escrow.BuyerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only buyer can release escrow"})
		return
	}

	if escrow.Status != models.EscrowHeld {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escrow is not in held status"})
		return
	}

	// Release funds to seller
	now := time.Now()
	tx := db.DB.Begin()

	// Update escrow status
	tx.Model(&escrow).Updates(map[string]interface{}{
		"status":      models.EscrowReleased,
		"released_at": now,
	})

	// Credit seller wallet
	var sellerWallet models.Wallet
	if err := tx.First(&sellerWallet, "user_id = ?", escrow.SellerID).Error; err == nil {
		platformFee := escrow.Amount * 0.10 // 10% fee
		sellerAmount := escrow.Amount - platformFee

		newBalance := sellerWallet.Balance + sellerAmount
		tx.Model(&sellerWallet).Update("balance", newBalance)

		// Create ledger entry
		ledger := models.WalletLedgerEntry{
			WalletID:     sellerWallet.ID,
			Amount:       sellerAmount,
			BalanceAfter: newBalance,
			Type:         "escrow_release",
			ReferenceID:  escrow.ID.String(),
			Description:  "Escrow released for order",
		}
		tx.Create(&ledger)
	}

	// Update order status
	tx.Model(&models.Order{}).Where("id = ?", orderID).Update("status", models.OrderStatusCompleted)

	tx.Commit()

	// Notify seller via WebSocket
	BroadcastToUser(escrow.SellerID.String(), MsgTypeOrderUpdate, gin.H{
		"order_id": orderID,
		"message":  "Payment released!",
		"amount":   escrow.Amount,
	})

	c.JSON(http.StatusOK, gin.H{"message": "Escrow released successfully"})
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
			newBalance := sellerWallet.Balance + sellerAmount
			tx.Model(&sellerWallet).Update("balance", newBalance)

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
