package api

import (
	"fmt"
	"log"
	"net/http"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/audit"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/ws"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const platformFeeRate = 0.10 // 10% platform fee on all escrow releases

// usageProportionalSellerAmount calculates the seller's share of an escrow
// based on actual bandwidth delivered (P3-03).
//
// Resolves via: EscrowTransaction.OrderID → Order.SessionID → Session.BytesUsed.
// If any lookup fails or the order has no session, falls back to 100% delivery
// (i.e. full escrow minus platform fee) so as not to under-pay a seller due to
// a missing data link.
func usageProportionalSellerAmount(tx *gorm.DB, escrow models.EscrowTransaction) float64 {
	var order models.Order
	if err := tx.Preload("Session").First(&order, "id = ?", escrow.OrderID).Error; err != nil {
		// Order not found — fall back to full release
		return escrow.Amount * (1 - platformFeeRate)
	}

	if order.SessionID == nil || order.Session == nil || order.BandwidthGB <= 0 {
		// No session link or no bandwidth quota — full release
		return escrow.Amount * (1 - platformFeeRate)
	}

	bytesLimit := order.BandwidthGB * 1024 * 1024 * 1024 // GB → bytes
	bytesUsed := float64(order.Session.BytesUsed)

	// Cap at 1.0 — never pay more than the full amount.
	usageRatio := bytesUsed / bytesLimit
	if usageRatio > 1.0 {
		usageRatio = 1.0
	}
	if usageRatio < 0 {
		usageRatio = 0
	}

	return escrow.Amount * usageRatio * (1 - platformFeeRate)
}

// RegisterEscrowRoutes registers escrow-related routes
func RegisterEscrowRoutes(rg *gin.RouterGroup) {
	rg.GET("/escrow/:orderId", getEscrowStatus)
	rg.POST("/escrow/:orderId/release", releaseEscrow)
	rg.POST("/escrow/:orderId/dispute", createEscrowDispute)
	// Admin only: Resolve disputes requires disputes:manage permission
	rg.POST("/escrow/:orderId/resolve", RequirePermission("disputes:manage"), resolveEscrowDispute)
	rg.GET("/escrow/disputes", getMyEscrowDisputes)
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

	// P0-09: Trigger the on-chain settlement BEFORE committing the DB state.
	// If the on-chain call fails, we roll back and return an error so the
	// escrow is not marked released in DB while funds remain locked on-chain.
	var settleTxHash string
	if order.EscrowPDA != "" && order.SellerWallet != "" {
		oracle := solanaClient.GetOracleClient()
		if oracle == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "oracle client not available"})
			return
		}

		escrowPDA, parseErr := sol.PublicKeyFromBase58(order.EscrowPDA)
		sellerKey, parseErr2 := sol.PublicKeyFromBase58(order.SellerWallet)
		buyerKey, parseErr3 := sol.PublicKeyFromBase58(order.BuyerWallet)
		if parseErr != nil || parseErr2 != nil || parseErr3 != nil {
			log.Printf("[escrow] invalid key for order %s: pda=%v seller=%v buyer=%v", order.ID, parseErr, parseErr2, parseErr3)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid escrow key data"})
			return
		}

		var txErr error
		settleTxHash, txErr = oracle.SettleEscrow(c.Request.Context(), solanaClient.SettleEscrowParams{
			EscrowPDA:       escrowPDA,
			Seller:          sellerKey,
			Buyer:           buyerKey,
			BandwidthUsedGB: order.BandwidthLimitGB,
		})
		if txErr != nil {
			log.Printf("[escrow] on-chain settlement failed for order %s: %v", order.ID, txErr)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "on-chain settlement failed: " + txErr.Error()})
			return
		}
		log.Printf("[escrow] on-chain settlement submitted for order %s: txHash=%s", order.ID, settleTxHash)
	}

	// Update DB state only after on-chain success (or if no on-chain escrow)
	now := time.Now()
	tx := db.DB.Begin()

	updates := map[string]interface{}{"status": models.OrderStatusCompleted}
	if settleTxHash != "" {
		updates["tx_signature"] = settleTxHash
	}
	tx.Model(&order).Updates(updates)

	// Also update internal escrow transaction record if it exists (legacy/sync)
	tx.Model(&models.EscrowTransaction{}).Where("order_id = ?", orderID).Updates(map[string]interface{}{
		"status":      models.EscrowReleased,
		"released_at": now,
	})

	tx.Commit()

	// P2-13: Financial audit trail — escrow settled.
	audit.Log(c, models.AuditFinancialEscrowSettled, "order", order.ID.String(),
		fmt.Sprintf("Escrow settled for order %s (tx: %s)", order.ID, settleTxHash),
		map[string]interface{}{
			"order_id":     order.ID.String(),
			"tx_signature": settleTxHash,
			"amount_sol":   order.TotalPrice,
		})

	// Notify seller via WebSocket
	ws.BroadcastToUser(order.BuyerID.String(), ws.MsgTypeOrderUpdate, order)
	ws.BroadcastToUser(order.SellerID.String(), ws.MsgTypeOrderUpdate, order)

	c.JSON(http.StatusOK, gin.H{"message": "Escrow release initiated successfully"})
}

// createEscrowDispute opens a dispute for an order
func createEscrowDispute(c *gin.Context) {
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
	dispute := models.EscrowDispute{
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

// getMyEscrowDisputes returns user's escrow disputes
func getMyEscrowDisputes(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var disputes []models.EscrowDispute
	db.DB.Preload("Escrow").Preload("Order").
		Joins("JOIN escrow_transactions ON escrow_disputes.escrow_id = escrow_transactions.id").
		Where("escrow_transactions.buyer_id = ? OR escrow_transactions.seller_id = ?", userID, userID).
		Order("created_at DESC").
		Find(&disputes)

	c.JSON(http.StatusOK, gin.H{"disputes": disputes})
}

// resolveEscrowDispute handles admin resolution of an escrow dispute
// Requires disputes:manage permission (enforced by route middleware)
func resolveEscrowDispute(c *gin.Context) {

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
		// P1-20: Deduct already-released milestone amounts from the refund so
		// funds that were legitimately paid to the seller are not returned twice.
		var releasedMilestones []models.EscrowMilestone
		tx.Where("escrow_id = ? AND status = ?", escrow.ID, "released").Find(&releasedMilestones)
		var alreadyReleased float64
		for _, m := range releasedMilestones {
			alreadyReleased += m.Amount
		}
		refundAmount := escrow.Amount - alreadyReleased
		if refundAmount < 0 {
			refundAmount = 0
		}

		// Refund Buyer
		tx.Model(&escrow).Updates(map[string]interface{}{
			"status":      models.EscrowRefunded,
			"released_at": now,
		})

		if refundAmount > 0 {
			var buyerWallet models.Wallet
			if err := tx.First(&buyerWallet, "user_id = ?", escrow.BuyerID).Error; err == nil {
				newBalance := buyerWallet.BalanceSOL + refundAmount
				tx.Model(&buyerWallet).Update("balance_sol", newBalance)

				tx.Create(&models.WalletLedgerEntry{
					WalletID:     buyerWallet.ID,
					Amount:       refundAmount,
					BalanceAfter: newBalance,
					Type:         "escrow_refund",
					ReferenceID:  escrow.ID.String(),
					Description:  "Refund from dispute resolution (excluding released milestones)",
				})
			}
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

		// P3-03: pay seller proportional to actual bandwidth delivered.
		sellerAmount := usageProportionalSellerAmount(tx, escrow)

		var sellerWallet models.Wallet
		if err := tx.First(&sellerWallet, "user_id = ?", escrow.SellerID).Error; err == nil {
			newBalance := sellerWallet.BalanceSOL + sellerAmount
			tx.Model(&sellerWallet).Update("balance_sol", newBalance)

			tx.Create(&models.WalletLedgerEntry{
				WalletID:     sellerWallet.ID,
				Amount:       sellerAmount,
				BalanceAfter: newBalance,
				Type:         "escrow_release_admin",
				ReferenceID:  escrow.ID.String(),
				Description:  "Admin resolved dispute: Release (usage-proportional)",
			})
		}
	} else {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid decision"})
		return
	}

	// Close Dispute
	var dispute models.EscrowDispute
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

// AutoReleaseExpiredEscrows releases escrows past auto-release date (run as cron).
// P1-08: each escrow is locked with SELECT FOR UPDATE SKIP LOCKED so concurrent
// cron invocations cannot release the same escrow twice.
func AutoReleaseExpiredEscrows() {
	// Process one page at a time; stop when no more rows are claimable.
	const batchSize = 50
	for {
		var claimed []models.EscrowTransaction
		err := db.DB.Transaction(func(tx *gorm.DB) error {
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
				Where("status = ? AND auto_release_at < ?", models.EscrowHeld, time.Now()).
				Limit(batchSize).
				Find(&claimed).Error; err != nil {
				return err
			}
			if len(claimed) == 0 {
				return nil
			}
			// Mark as released inside the same transaction to hold the row lock.
			ids := make([]uuid.UUID, len(claimed))
			for i, e := range claimed {
				ids[i] = e.ID
			}
			now := time.Now()
			return tx.Model(&models.EscrowTransaction{}).
				Where("id IN ?", ids).
				Updates(map[string]interface{}{
					"status":      models.EscrowReleased,
					"released_at": now,
				}).Error
		})
		if err != nil {
			log.Printf("[escrow] AutoReleaseExpiredEscrows lock/update error: %v", err)
			return
		}
		if len(claimed) == 0 {
			return
		}

		for _, escrow := range claimed {
			now := time.Now()
			if txErr := db.DB.Transaction(func(tx *gorm.DB) error {
				var sellerWallet models.Wallet
				if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
					First(&sellerWallet, "user_id = ?", escrow.SellerID).Error; err != nil {
					return err
				}
				// P3-03: pay seller proportional to actual bandwidth delivered.
				sellerAmount := usageProportionalSellerAmount(tx, escrow)
				newBalance := sellerWallet.BalanceSOL + sellerAmount
				if err := tx.Model(&sellerWallet).Update("balance_sol", newBalance).Error; err != nil {
					return err
				}
				ledger := models.WalletLedgerEntry{
					WalletID:     sellerWallet.ID,
					Amount:       sellerAmount,
					BalanceAfter: newBalance,
					Type:         "escrow_auto_release",
					ReferenceID:  escrow.ID.String(),
					Description:  "Escrow auto-released after 7 days",
					CreatedAt:    now,
				}
				if err := tx.Create(&ledger).Error; err != nil {
					return err
				}
				return tx.Model(&models.Order{}).
					Where("id = ?", escrow.OrderID).
					Update("status", models.OrderStatusCompleted).Error
			}); txErr != nil {
				log.Printf("[escrow] AutoReleaseExpiredEscrows credit error for escrow %s: %v", escrow.ID, txErr)
			}
		}

		if len(claimed) < batchSize {
			return // no more pages
		}
	}
}
