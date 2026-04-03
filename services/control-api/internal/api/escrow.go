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
	// Legacy order-ID jury voting endpoint is hard-disabled to prevent DB-only
	// settlement paths. Use /v1/disputes/jury/* chain-enforced flow instead.
	rg.POST("/escrow/:orderId/jury-vote", castJuryVoteByOrder)
	// Legacy admin fallback route is hard-disabled in all modes.
	rg.POST("/escrow/:orderId/resolve", resolveEscrowDispute)
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

	if order.EscrowPDA != "" && order.SellerWallet != "" {
		setAuthorityHeaders(c, authorityModeChainAuthoritative, "write", "mirror")
	} else {
		setAuthorityHeaders(c, authorityModeDBAuthoritative, "none", "source_of_truth")
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
		settleTxHash, txErr = oracle.SettleEscrow(c.Request.Context(), "api.escrow.release", solanaClient.SettleEscrowParams{
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

	// D-E1: Automatically convene a 3-juror jury from reputation-weighted
	// validators, excluding the two parties.  If fewer than 3 validators are
	// available the dispute falls back to admin resolution.
	juryConvened := false
	jurorIDs, juryErr := models.SelectJurors(db.DB, escrow.BuyerID, escrow.SellerID, 3)
	if juryErr == nil && len(jurorIDs) >= 3 {
		jury := models.DisputeJury{
			DisputeID:      dispute.ID,
			EscrowID:       escrow.ID,
			BuyerID:        escrow.BuyerID,
			SellerID:       escrow.SellerID,
			Juror1ID:       jurorIDs[0],
			Juror2ID:       jurorIDs[1],
			Juror3ID:       jurorIDs[2],
			DisputeReason:  string(req.Reason),
			DisputedAmount: escrow.Amount,
			Status:         models.JuryVoting,
		}
		if len(jurorIDs) >= 4 {
			jury.Juror4ID = &jurorIDs[3]
		}
		if len(jurorIDs) >= 5 {
			jury.Juror5ID = &jurorIDs[4]
		}
		if createErr := db.DB.Create(&jury).Error; createErr == nil {
			juryConvened = true
			// Notify each juror
			for _, jid := range jurorIDs[:3] {
				ws.BroadcastToUser(jid.String(), ws.MsgTypeOrderUpdate, gin.H{
					"type":       "jury_assigned",
					"dispute_id": dispute.ID,
					"escrow_id":  escrow.ID,
					"message":    "You have been selected as a juror. Please review and cast your vote within 48 hours.",
				})
			}
		}
	}

	// Notify counterparty
	counterpartyID := escrow.SellerID
	if userID == escrow.SellerID {
		counterpartyID = escrow.BuyerID
	}
	ws.BroadcastToUser(counterpartyID.String(), ws.MsgTypeOrderUpdate, gin.H{
		"order_id":      orderID,
		"message":       "Dispute opened on order",
		"type":          "dispute_opened",
		"jury_convened": juryConvened,
	})

	c.JSON(http.StatusCreated, gin.H{
		"dispute":       dispute,
		"jury_convened": juryConvened,
	})
}

// castJuryVoteByOrder allows an assigned juror to vote on a dispute via order ID.
//
// This legacy endpoint is intentionally disabled. Use /v1/disputes/jury/*.
func castJuryVoteByOrder(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeChainAuthoritative, "required", "none")
	c.JSON(http.StatusGone, gin.H{
		"error": "Legacy escrow jury-vote endpoint is disabled. Use /v1/disputes/jury/* for chain-enforced dispute settlement.",
	})
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
// This legacy endpoint is intentionally disabled. Use /v1/disputes/jury/*.
func resolveEscrowDispute(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeChainAuthoritative, "required", "none")
	c.JSON(http.StatusGone, gin.H{
		"error": "Centralized escrow dispute resolution endpoint is disabled. Use decentralized jury flow with on-chain settlement.",
	})
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
