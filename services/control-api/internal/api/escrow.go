package api

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/alerts"
	"github.com/proxyhubb/control-api/internal/audit"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/orders/fsm"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/ws"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// escrowOnChainSkimsPlatformFee documents whether settle_escrow / settle_escrow_multisig
// deduct platform_fee_bps to a treasury account. Today the Solana program pays only
// seller_payout + buyer_refund (no treasury skim). Keep DB helpers aligned until a
// program upgrade lands; otherwise release accounting drifts from on-chain balances.
const escrowOnChainSkimsPlatformFee = false

// legacyPlatformFeeRate is retained for non-escrow custodial paths and documentation.
// Do not apply this to PDA settlement amounts while escrowOnChainSkimsPlatformFee is false.
const legacyPlatformFeeRate = 0.10

// usageProportionalSellerAmount calculates the seller's share of an escrow
// based on actual bandwidth delivered (P3-03).
//
// Matches on-chain settle_escrow math: seller_payout = amount * min(used, limit) / limit
// with NO platform fee skim while escrowOnChainSkimsPlatformFee is false.
//
// Resolves via: EscrowTransaction.OrderID → Order.SessionID → Session.BytesUsed.
// If any lookup fails or the order has no session, falls back to full escrow amount
// so as not to under-pay a seller due to a missing data link.
func usageProportionalSellerAmount(tx *gorm.DB, escrow models.EscrowTransaction) float64 {
	feeFactor := 1.0
	if escrowOnChainSkimsPlatformFee {
		feeFactor = 1 - legacyPlatformFeeRate
	}

	var order models.Order
	if err := tx.Preload("Session").First(&order, "id = ?", escrow.OrderID).Error; err != nil {
		return escrow.Amount * feeFactor
	}

	if order.SessionID == nil || order.Session == nil || order.BandwidthGB <= 0 {
		return escrow.Amount * feeFactor
	}

	bytesLimit := order.BandwidthGB * 1024 * 1024 * 1024
	bytesUsed := float64(order.Session.BytesUsed)

	usageRatio := bytesUsed / bytesLimit
	if usageRatio > 1.0 {
		usageRatio = 1.0
	}
	if usageRatio < 0 {
		usageRatio = 0
	}

	return escrow.Amount * usageRatio * feeFactor
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

// CreateEscrowForOrder creates an escrow when order is placed.
// Hold / challenge window comes from PROXYHUB_ESCROW_CHALLENGE_DAYS (default 7).
func CreateEscrowForOrder(orderID, buyerID, sellerID uuid.UUID, amount float64) error {
	days := decentralization.EscrowChallengeDays()
	autoRelease := time.Now().UTC().AddDate(0, 0, days)

	escrow := models.EscrowTransaction{
		OrderID:       orderID,
		BuyerID:       buyerID,
		SellerID:      sellerID,
		Amount:        amount,
		Status:        models.EscrowHeld,
		HeldAt:        time.Now().UTC(),
		AutoReleaseAt: &autoRelease,
	}

	return db.DB.Create(&escrow).Error
}

// escrowSettleTimeout is the single on-chain settle budget for buyer
// release and auto-release (W-24: paths drifted 30s vs 45s).
const escrowSettleTimeout = 45 * time.Second

// escrowChainHealthy probes the oracle RPC before any PDA settle work.
// Settling against a lagging/unhealthy RPC is how escrows got stuck in
// `releasing` (W-24): fail the run fast and let the tick retry.
func escrowChainHealthy() bool {
	oracle := solanaClient.GetOracleClient()
	if oracle == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := oracle.GetCurrentSlot(ctx)
	return err == nil
}

// StartEscrowAutoReleaseWorker periodically releases held escrows past auto_release_at
// when no buyer challenge / dispute / jury is open.
func StartEscrowAutoReleaseWorker() {
	go func() {
		log.Println("[escrow] AutoRelease worker started (interval=15m)")
		ticker := time.NewTicker(15 * time.Minute)
		defer ticker.Stop()
		ReapStaleReleasingEscrows() // W-24: recover crash-orphaned claims first
		AutoReleaseExpiredEscrows()
		for range ticker.C {
			ReapStaleReleasingEscrows()
			AutoReleaseExpiredEscrows()
		}
	}()
}

// autoReleaseBlockReason returns a non-empty reason when auto-release must not settle.
// Exported for tests via the same package.
func autoReleaseBlockReason(order *models.Order, escrow *models.EscrowTransaction) string {
	if escrow != nil && escrow.Status == models.EscrowDisputed {
		return "escrow_disputed"
	}
	if order != nil && order.Status == models.OrderStatusDisputed {
		return "order_disputed"
	}
	if order == nil {
		return ""
	}
	var n int64
	if err := db.DB.Model(&models.EscrowDispute{}).
		Where("order_id = ? AND status IN ?", order.ID, []models.DisputeStatus{
			models.DisputeOpen, models.DisputeUnderReview,
		}).Count(&n).Error; err == nil && n > 0 {
		return "open_escrow_dispute"
	}
	if err := db.DB.Model(&models.DisputeJury{}).
		Where("(dispute_id = ? OR escrow_id = ?) AND status IN ?",
			order.ID, escrow.ID,
			[]models.JuryStatus{models.JuryVoting, models.JuryReview, models.JuryAppealed},
		).Count(&n).Error; err == nil && n > 0 {
		return "open_dispute_jury"
	}
	return ""
}

func parkEscrowDisputed(escrowID uuid.UUID) {
	if err := db.DB.Model(&models.EscrowTransaction{}).
		Where("id = ? AND status IN ?", escrowID, []models.EscrowStatus{models.EscrowReleasing, models.EscrowHeld}).
		Update("status", models.EscrowDisputed).Error; err != nil {
		log.Printf("[escrow] parkEscrowDisputed failed for %s: %v", escrowID, err)
	}
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

	if err := fsm.Validate(order.Status, models.OrderStatusCompleted, "api.escrow.release"); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if decentralization.RequireEscrowPDAEnabled() && (order.EscrowPDA == "" || order.SellerWallet == "") {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "PROXYHUB_REQUIRE_ESCROW_PDA: on-chain escrow PDA required to release; custodial complete is disabled",
			"code":  "escrow_pda_required",
		})
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
		if solanaClient.GetOracleClient() == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "oracle client not available"})
			return
		}
		if _, parseErr := sol.PublicKeyFromBase58(order.EscrowPDA); parseErr != nil {
			log.Printf("[escrow] invalid escrow_pda for order %s: %v", order.ID, parseErr)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid escrow key data"})
			return
		}
		if _, parseErr := sol.PublicKeyFromBase58(order.SellerWallet); parseErr != nil {
			log.Printf("[escrow] invalid seller_wallet for order %s: %v", order.ID, parseErr)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid escrow key data"})
			return
		}
		if _, parseErr := sol.PublicKeyFromBase58(order.BuyerWallet); parseErr != nil {
			log.Printf("[escrow] invalid buyer_wallet for order %s: %v", order.ID, parseErr)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid escrow key data"})
			return
		}

		var txErr error
		settleCtx, settleCancel := context.WithTimeout(c.Request.Context(), escrowSettleTimeout)
		settleTxHash, txErr = SettleOrderEscrow(settleCtx, "api.escrow.release", &order)
		settleCancel()
		if txErr != nil {
			log.Printf("[escrow] on-chain settlement failed for order %s: %v — enqueueing retry", order.ID, txErr)
			EnqueueEscrowSettle(&order, "api.escrow.release")
			c.JSON(http.StatusAccepted, gin.H{
				"status":  "settle_queued",
				"code":    "escrow_settle_queued",
				"error":   "on-chain settlement failed; queued for retry",
				"details": txErr.Error(),
				"order_id": order.ID,
			})
			return
		}
		log.Printf("[escrow] on-chain settlement submitted for order %s: txHash=%s seed_kind=%s", order.ID, settleTxHash, order.EscrowSeedKind)
	}

	// Update DB state only after on-chain success (or if no on-chain escrow)
	now := time.Now()
	tx := db.DB.Begin()

	extras := map[string]interface{}{}
	if settleTxHash != "" {
		extras["tx_signature"] = settleTxHash
	}
	if err := fsm.TransitionOrder(tx, &order, models.OrderStatusCompleted, "api.escrow.release", extras); err != nil {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Also update internal escrow transaction record if it exists (legacy/sync)
	tx.Model(&models.EscrowTransaction{}).Where("order_id = ?", orderID).Updates(map[string]interface{}{
		"status":      models.EscrowReleased,
		"released_at": now,
	})

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to commit escrow release"})
		return
	}

	// P2-13: Financial audit trail ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â escrow settled.
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

	var order models.Order
	if err := db.DB.First(&order, "id = ?", orderID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
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
	if err := fsm.Validate(order.Status, models.OrderStatusDisputed, "api.escrow.dispute"); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Create dispute + jury together. Quorum is required (W1.2) — no admin fallback.
	jurorIDs, juryErr := models.SelectJurors(db.DB, escrow.BuyerID, escrow.SellerID, 3)
	if juryErr != nil || len(jurorIDs) < 3 {
		available := 0
		if juryErr == nil {
			available = len(jurorIDs)
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":     "Not enough validators available to convene a jury",
			"available": available,
			"required":  3,
			"code":      "jury_quorum_unavailable",
		})
		return
	}

	dispute := models.EscrowDispute{
		EscrowID:    escrow.ID,
		OrderID:     orderID,
		InitiatedBy: userID,
		Reason:      req.Reason,
		Description: req.Description,
		Status:      models.DisputeOpen,
	}

	// DisputeID on DisputeJury is the order UUID (same as /disputes/jury/create)
	// so settleDisputeOnChain can load the order. Do not use EscrowDispute.ID.
	jury := models.DisputeJury{
		DisputeID:      orderID,
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

	if err := db.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&dispute).Error; err != nil {
			return err
		}
		if err := tx.Create(&jury).Error; err != nil {
			return err
		}
		if err := tx.Model(&escrow).Update("status", models.EscrowDisputed).Error; err != nil {
			return err
		}
		return fsm.TransitionOrder(tx, &order, models.OrderStatusDisputed, "api.escrow.dispute", nil)
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to open dispute with jury", "detail": err.Error()})
		return
	}

	for _, jid := range jurorIDs[:3] {
		ws.BroadcastToUser(jid.String(), ws.MsgTypeOrderUpdate, gin.H{
			"type":       "jury_assigned",
			"dispute_id": dispute.ID,
			"jury_id":    jury.ID,
			"order_id":   orderID,
			"escrow_id":  escrow.ID,
			"message":    "You have been selected as a juror. Please review and cast your vote within 48 hours.",
		})
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
		"jury_convened": true,
	})

	c.JSON(http.StatusCreated, gin.H{
		"dispute":       dispute,
		"jury":          jury,
		"jury_convened": true,
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
// Claim held → releasing, settle on-chain first (PDA), then mark released.
// Custodial wallet credit runs only when there is no EscrowPDA (buyer releaseEscrow
// settles on-chain only — never double-pay PDA sellers into balance_sol).
func AutoReleaseExpiredEscrows() {
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
			ids := make([]uuid.UUID, len(claimed))
			for i, e := range claimed {
				ids[i] = e.ID
			}
			return tx.Model(&models.EscrowTransaction{}).
				Where("id IN ? AND status = ?", ids, models.EscrowHeld).
				Update("status", models.EscrowReleasing).Error
		})
		if err != nil {
			log.Printf("[escrow] AutoReleaseExpiredEscrows claim error: %v", err)
			return
		}
		if len(claimed) == 0 {
			return
		}

		for _, escrow := range claimed {
			now := time.Now()
			var order models.Order
			if err := db.DB.First(&order, "id = ?", escrow.OrderID).Error; err != nil {
				log.Printf("[escrow] AutoReleaseExpiredEscrows order lookup error for escrow %s: %v", escrow.ID, err)
				reclaimEscrowToHeld(escrow.ID)
				continue
			}

			// Buyer challenge / dispute gate (jury path may leave escrow held while order disputed).
			if reason := autoReleaseBlockReason(&order, &escrow); reason != "" {
				log.Printf("[escrow] AutoReleaseExpiredEscrows blocked escrow=%s order=%s reason=%s", escrow.ID, order.ID, reason)
				alerts.Send(alerts.Warning, "Escrow Auto-Release Blocked",
					fmt.Sprintf("escrow=%s order=%s reason=%s", escrow.ID, order.ID, reason))
				parkEscrowDisputed(escrow.ID)
				continue
			}

			var settleTxHash string
			hasPDA := order.EscrowPDA != "" && order.SellerWallet != ""
			if !hasPDA && decentralization.RequireEscrowPDAEnabled() {
				log.Printf("[escrow] AutoReleaseExpiredEscrows skipping custodial settle for escrow %s (REQUIRE_ESCROW_PDA)", escrow.ID)
				alerts.Send(
					alerts.Warning,
					"Custodial escrow settle blocked",
					fmt.Sprintf("Escrow %s / order %s has no PDA; PROXYHUB_REQUIRE_ESCROW_PDA is enabled", escrow.ID, order.ID),
				)
				reclaimEscrowToHeld(escrow.ID)
				continue
			}
			if hasPDA {
				if !escrowChainHealthy() {
					log.Printf("[escrow] AutoReleaseExpiredEscrows RPC unhealthy; aborting run (escrow %s reclaimed)", escrow.ID)
					reclaimEscrowToHeld(escrow.ID)
					return
				}
				if solanaClient.GetOracleClient() == nil {
					log.Printf("[escrow] AutoReleaseExpiredEscrows oracle client not available, reclaiming escrow %s", escrow.ID)
					reclaimEscrowToHeld(escrow.ID)
					continue
				}
				if _, parseErr := sol.PublicKeyFromBase58(order.EscrowPDA); parseErr != nil {
					log.Printf("[escrow] AutoReleaseExpiredEscrows invalid escrow_pda for order %s: %v", order.ID, parseErr)
					reclaimEscrowToHeld(escrow.ID)
					continue
				}
				if _, parseErr := sol.PublicKeyFromBase58(order.SellerWallet); parseErr != nil {
					log.Printf("[escrow] AutoReleaseExpiredEscrows invalid seller_wallet for order %s: %v", order.ID, parseErr)
					reclaimEscrowToHeld(escrow.ID)
					continue
				}
				if _, parseErr := sol.PublicKeyFromBase58(order.BuyerWallet); parseErr != nil {
					log.Printf("[escrow] AutoReleaseExpiredEscrows invalid buyer_wallet for order %s: %v", order.ID, parseErr)
					reclaimEscrowToHeld(escrow.ID)
					continue
				}

				ctx, cancel := context.WithTimeout(context.Background(), escrowSettleTimeout)
				var txErr error
				settleTxHash, txErr = SettleOrderEscrow(ctx, "api.escrow.auto_release", &order)
				cancel()
				if txErr != nil {
					log.Printf("[escrow] AutoReleaseExpiredEscrows on-chain settlement failed for order %s: %v — enqueueing retry", order.ID, txErr)
					EnqueueEscrowSettle(&order, "api.escrow.auto_release")
					alerts.Send(
						alerts.Warning,
						"Auto-release escrow settlement failed",
						fmt.Sprintf("order=%s escrow=%s queued=true error=%v", order.ID, escrow.ID, txErr),
					)
					reclaimEscrowToHeld(escrow.ID)
					continue
				}
				log.Printf("[escrow] AutoReleaseExpiredEscrows on-chain settlement succeeded for order %s: txHash=%s seed_kind=%s", order.ID, settleTxHash, order.EscrowSeedKind)
			}

			if txErr := db.DB.Transaction(func(tx *gorm.DB) error {
				res := tx.Model(&models.EscrowTransaction{}).
					Where("id = ? AND status = ?", escrow.ID, models.EscrowReleasing).
					Updates(map[string]interface{}{
						"status":      models.EscrowReleased,
						"released_at": now,
					})
				if res.Error != nil {
					return res.Error
				}
				if res.RowsAffected == 0 {
					return fmt.Errorf("escrow %s no longer releasing", escrow.ID)
				}

				// PDA settle already paid the seller on-chain — do not custodial-credit.
				if !hasPDA {
					if decentralization.RequireEscrowPDAEnabled() {
						return fmt.Errorf("PROXYHUB_REQUIRE_ESCROW_PDA: refusing custodial seller credit for escrow %s without PDA", escrow.ID)
					}
					sellerWallet, err := models.LockWalletForUpdate(tx, escrow.SellerID)
					if err != nil {
						return err
					}
					sellerAmount := usageProportionalSellerAmount(tx, escrow)
					if sellerAmount > 0 {
						if err := models.CreditWalletLocked(tx, sellerWallet, sellerAmount, "escrow_auto_release",
							escrow.ID.String(), "Escrow auto-released after hold period"); err != nil {
							return err
						}
					}
				}

				var lockedOrder models.Order
				if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
					First(&lockedOrder, "id = ?", escrow.OrderID).Error; err != nil {
					return err
				}
				extras := map[string]interface{}{}
				if settleTxHash != "" {
					extras["tx_signature"] = settleTxHash
				}
				return fsm.TransitionOrder(tx, &lockedOrder, models.OrderStatusCompleted, "api.escrow.auto_release", extras)
			}); txErr != nil {
				log.Printf("[escrow] AutoReleaseExpiredEscrows finalize error for escrow %s: %v", escrow.ID, txErr)
				// PDA already settled: leave releasing for ops/reconcile rather than re-hold (would double-settle).
				if !hasPDA {
					reclaimEscrowToHeld(escrow.ID)
				}
			}
		}

		if len(claimed) < batchSize {
			return
		}
	}
}

func reclaimEscrowToHeld(escrowID uuid.UUID) {
	if err := db.DB.Model(&models.EscrowTransaction{}).
		Where("id = ? AND status = ?", escrowID, models.EscrowReleasing).
		Update("status", models.EscrowHeld).Error; err != nil {
		log.Printf("[escrow] reclaimEscrowToHeld failed for %s: %v", escrowID, err)
	}
}
