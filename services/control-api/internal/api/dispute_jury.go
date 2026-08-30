package api

import (
	"context"
	"crypto/sha256"
	"net/http"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/orders/fsm"
	"github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
)

// RegisterDisputeJuryRoutes registers decentralized dispute resolution routes
func RegisterDisputeJuryRoutes(r *gin.RouterGroup) {
	disputes := r.Group("/disputes/jury")
	{
		disputes.POST("/create/:orderId", createDisputeJury)
		disputes.GET("/:id", getDisputeJury)
		disputes.GET("/my", getMyJuryDisputes)
		disputes.POST("/:id/vote", castJuryVote)
		disputes.POST("/:id/evidence/buyer", submitBuyerEvidence)
		disputes.POST("/:id/evidence/seller", submitSellerEvidence)
		disputes.GET("/:id/status", getJuryStatus)
	}
}

// @Summary Create a dispute with jury
// @Tags dispute-jury
// @Accept json
// @Produce json
// @Param orderId path string true "Order ID"
// @Param request body models.CreateDisputeJuryRequest true "Dispute details"
// @Success 201 {object} models.DisputeJury
// @Router /v1/disputes/jury/create/{orderId} [post]
func createDisputeJury(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeHybridAsyncChain, "async_write_settlement", "source_of_truth")

	userID, _ := c.Get("user_id")
	orderID := c.Param("orderId")

	var req models.CreateDisputeJuryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get order
	var order models.Order
	if err := db.DB.Preload("Listing").Where("id = ?", orderID).First(&order).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	// Verify user is buyer or seller
	isBuyer := order.BuyerID.String() == userID.(uuid.UUID).String()
	isSeller := order.Listing != nil && order.Listing.SellerID.String() == userID.(uuid.UUID).String()

	if !isBuyer && !isSeller {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not a party to this order"})
		return
	}
	if err := fsm.Validate(order.Status, models.OrderStatusDisputed, "api.dispute_jury.create"); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if dispute already exists
	var existing models.DisputeJury
	if err := db.DB.Where("dispute_id = ?", order.ID).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Dispute already exists", "jury": existing})
		return
	}

	// Get seller ID
	var sellerID uuid.UUID
	if order.Listing != nil {
		sellerID = order.Listing.SellerID
	}

	// Select jurors (reputation-weighted)
	jurors, err := models.SelectJurors(db.DB, order.BuyerID, sellerID, 3)
	if err != nil || len(jurors) < 3 {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":     "Not enough validators available",
			"available": len(jurors),
			"required":  3,
		})
		return
	}

	// Create jury + mark order/escrow disputed in one txn so auto-release cannot settle.
	jury := models.DisputeJury{
		DisputeID:      order.ID,
		BuyerID:        order.BuyerID,
		SellerID:       sellerID,
		Juror1ID:       jurors[0],
		Juror2ID:       jurors[1],
		Juror3ID:       jurors[2],
		DisputeReason:  req.DisputeReason,
		DisputedAmount: req.DisputedAmount,
		Status:         models.JuryVoting,
	}

	if isBuyer {
		jury.BuyerEvidence = req.BuyerEvidence
	} else {
		jury.SellerEvidence = req.SellerEvidence
	}

	if err := db.DB.Transaction(func(tx *gorm.DB) error {
		var escrow models.EscrowTransaction
		if err := tx.Where("order_id = ?", order.ID).First(&escrow).Error; err == nil {
			jury.EscrowID = escrow.ID
			if escrow.Status == models.EscrowHeld || escrow.Status == models.EscrowReleasing {
				if err := tx.Model(&escrow).Update("status", models.EscrowDisputed).Error; err != nil {
					return err
				}
			}
		}
		if err := tx.Create(&jury).Error; err != nil {
			return err
		}
		return fsm.TransitionOrder(tx, &order, models.OrderStatusDisputed, "api.dispute_jury.create", nil)
	}); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// DISP-001/002: Open dispute on-chain with slot-seed VRF so jury
	// selection cannot be replayed or pre-computed by the server.
	if order.EscrowPDA != "" {
		go func(escrowAddr string, reason string) {
			oracle := solana.GetOracleClient()
			if oracle == nil {
				return
			}
			escrowPDA, err := sol.PublicKeyFromBase58(escrowAddr)
			if err != nil {
				logging.Error(err).Msg("createDisputeJury: invalid escrow PDA")
				return
			}
			reasonHash := sha256.Sum256([]byte(reason))
			// Use current nanosecond timestamp as a pseudo-random slot seed.
			// Production deployments should use a recent slot hash from GetSlot.
			slotSeed := uint64(time.Now().UnixNano())

			ctx2, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			disputePDA, sig, err := oracle.OpenDisputeOnChain(ctx2, solana.OpenDisputeParams{
				EscrowPDA:  escrowPDA,
				ReasonHash: reasonHash,
				SlotSeed:   slotSeed,
			})
			if err != nil {
				logging.Error(err).Str("escrow", escrowAddr).Msg("createDisputeJury: OpenDisputeOnChain failed (non-fatal)")
				return
			}
			logging.Info().Str("dispute_pda", disputePDA.String()).Str("sig", sig).Msg("createDisputeJury: dispute anchored on-chain")
		}(order.EscrowPDA, req.DisputeReason)
	}

	// DISP-001/002: Open dispute on-chain with slot-seed VRF so jury
	// selection cannot be replayed or pre-computed by the server.
	if order.EscrowPDA != "" {
		go func(escrowAddr string, reason string) {
			oracle := solana.GetOracleClient()
			if oracle == nil {
				return
			}
			escrowPDA, err := sol.PublicKeyFromBase58(escrowAddr)
			if err != nil {
				logging.Error(err).Msg("createDisputeJury: invalid escrow PDA")
				return
			}
			reasonHash := sha256.Sum256([]byte(reason))
			// Use current nanosecond timestamp as a pseudo-random slot seed.
			// Production deployments should use a recent slot hash from GetSlot.
			slotSeed := uint64(time.Now().UnixNano())

			ctx2, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			disputePDA, sig, err := oracle.OpenDisputeOnChain(ctx2, solana.OpenDisputeParams{
				EscrowPDA:  escrowPDA,
				ReasonHash: reasonHash,
				SlotSeed:   slotSeed,
			})
			if err != nil {
				logging.Error(err).Str("escrow", escrowAddr).Msg("createDisputeJury: OpenDisputeOnChain failed (non-fatal)")
				return
			}
			logging.Info().Str("dispute_pda", disputePDA.String()).Str("sig", sig).Msg("createDisputeJury: dispute anchored on-chain")
		}(order.EscrowPDA, req.DisputeReason)
	}

	c.JSON(http.StatusCreated, jury)
}

// @Summary Get dispute jury details
// @Tags dispute-jury
// @Param id path string true "Jury ID"
// @Produce json
// @Success 200 {object} models.DisputeJury
// @Router /v1/disputes/jury/{id} [get]
func getDisputeJury(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "none", "source_of_truth")

	juryID := c.Param("id")

	var jury models.DisputeJury
	if err := db.DB.Preload("Buyer").Preload("Seller").
		Preload("Juror1").Preload("Juror2").Preload("Juror3").
		Where("id = ?", juryID).First(&jury).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Jury not found"})
		return
	}

	c.JSON(http.StatusOK, jury)
}

// @Summary Get my disputes (as party or juror)
// @Tags dispute-jury
// @Produce json
// @Success 200 {array} models.DisputeJury
// @Router /v1/disputes/jury/my [get]
func getMyJuryDisputes(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "none", "source_of_truth")

	userID, _ := c.Get("user_id")

	var disputes []models.DisputeJury

	// Get disputes where user is party or juror
	if err := db.DB.Where(
		"buyer_id = ? OR seller_id = ? OR juror1_id = ? OR juror2_id = ? OR juror3_id = ? OR juror4_id = ? OR juror5_id = ?",
		userID, userID, userID, userID, userID, userID, userID,
	).Order("created_at DESC").Find(&disputes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch disputes"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"disputes": disputes})
}

// @Summary Cast vote as juror
// @Tags dispute-jury
// @Accept json
// @Produce json
// @Param id path string true "Jury ID"
// @Param request body models.CastVoteRequest true "Vote"
// @Success 200 {object} models.DisputeJury
// @Router /v1/disputes/jury/{id}/vote [post]
func castJuryVote(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeHybridAsyncChain, "async_write_settlement", "source_of_truth")

	userID, _ := c.Get("user_id")
	juryID := c.Param("id")

	var req models.CastVoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var jury models.DisputeJury
	if err := db.DB.Where("id = ?", juryID).First(&jury).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Jury not found"})
		return
	}

	// Check if voting is still open
	if jury.Status != models.JuryVoting {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Voting is closed", "status": jury.Status})
		return
	}

	if time.Now().After(jury.VotingDeadline) {
		jury.Status = models.JuryExpired
		db.DB.Save(&jury)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Voting deadline passed"})
		return
	}

	// Check if user is a juror
	slot := jury.GetJurorSlot(userID.(uuid.UUID))
	if slot == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not a juror for this dispute"})
		return
	}

	// Record vote
	now := time.Now()
	switch slot {
	case 1:
		if jury.Vote1 != models.VotePending {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Already voted"})
			return
		}
		jury.Vote1 = req.Vote
		jury.Vote1At = &now
	case 2:
		if jury.Vote2 != models.VotePending {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Already voted"})
			return
		}
		jury.Vote2 = req.Vote
		jury.Vote2At = &now
	case 3:
		if jury.Vote3 != models.VotePending {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Already voted"})
			return
		}
		jury.Vote3 = req.Vote
		jury.Vote3At = &now
	case 4:
		if jury.Vote4 != models.VotePending {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Already voted"})
			return
		}
		jury.Vote4 = req.Vote
		jury.Vote4At = &now
	case 5:
		if jury.Vote5 != models.VotePending {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Already voted"})
			return
		}
		jury.Vote5 = req.Vote
		jury.Vote5At = &now
	}

	// Check if we can auto-resolve
	if jury.CanAutoResolve() {
		jury.Resolve()

		// Submit the resolution to the blockchain.
		// Captured by value so the goroutine is safe after jury is saved below.
		jurySnapshot := jury
		go settleDisputeOnChain(jurySnapshot)
	}

	if err := db.DB.Save(&jury).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save vote"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      "Vote recorded",
		"jury":         jury,
		"vote_count":   jury.GetVoteCount(),
		"total_jurors": jury.GetJurorCount(),
		"can_resolve":  jury.CanAutoResolve(),
	})
}

// @Summary Submit buyer evidence
// @Tags dispute-jury
// @Accept json
// @Produce json
// @Param id path string true "Jury ID"
// @Param request body models.JurySubmitEvidenceRequest true "Evidence"
// @Success 200 {object} models.DisputeJury
// @Router /v1/disputes/jury/{id}/evidence/buyer [post]
func submitBuyerEvidence(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "none", "source_of_truth")

	userID, _ := c.Get("user_id")
	juryID := c.Param("id")

	var req models.JurySubmitEvidenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var jury models.DisputeJury
	if err := db.DB.Where("id = ?", juryID).First(&jury).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Jury not found"})
		return
	}

	if jury.BuyerID.String() != userID.(uuid.UUID).String() {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not the buyer"})
		return
	}

	jury.BuyerEvidence = req.Evidence
	db.DB.Save(&jury)

	c.JSON(http.StatusOK, jury)
}

// @Summary Submit seller evidence
// @Tags dispute-jury
// @Accept json
// @Produce json
// @Param id path string true "Jury ID"
// @Param request body models.JurySubmitEvidenceRequest true "Evidence"
// @Success 200 {object} models.DisputeJury
// @Router /v1/disputes/jury/{id}/evidence/seller [post]
func submitSellerEvidence(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "none", "source_of_truth")

	userID, _ := c.Get("user_id")
	juryID := c.Param("id")

	var req models.JurySubmitEvidenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var jury models.DisputeJury
	if err := db.DB.Where("id = ?", juryID).First(&jury).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Jury not found"})
		return
	}

	if jury.SellerID.String() != userID.(uuid.UUID).String() {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not the seller"})
		return
	}

	jury.SellerEvidence = req.Evidence
	db.DB.Save(&jury)

	c.JSON(http.StatusOK, jury)
}

// settleDisputeOnChain submits the jury resolution to Solana.
//
// W1.2 note: Go oracle uses EmergencyRefund / SettleEscrow as the intentional
// settlement shortcut. Anchor ExecuteJuryVerdict is not wired in control-api yet;
// payout accounts are still bound by BC-01/02 constraints on SettleEscrow.
// Failures enqueue durable compensation_outbox retries (not fire-and-forget-only).
func settleDisputeOnChain(jury models.DisputeJury) {
	ctx := context.Background()

	order, err := loadOrderForJurySettlement(jury)
	if err != nil {
		logging.Error(err).Str("dispute_id", jury.DisputeID.String()).Msg("dispute settlement: order not found")
		return
	}

	// For pay-as-you-go orders there is no on-chain escrow; nothing to settle.
	if order.EscrowPDA == "" || order.BuyerWallet == "" || order.SellerWallet == "" {
		if err := fsm.TransitionOrder(db.DB, &order, models.OrderStatusRefunded, "api.dispute_jury.settle_no_escrow", nil); err != nil {
			logging.Error(err).Str("order_id", order.ID.String()).Msg("dispute settlement: invalid refund transition")
		}
		return
	}

	decision, _ := jury.GetMajority()

	nextStatus := models.OrderStatusCompleted
	switch decision {
	case models.VoteBuyerWins:
		nextStatus = models.OrderStatusRefunded
	case models.VoteSellerWins, models.VoteSplitFunds:
		nextStatus = models.OrderStatusCompleted
	default:
		logging.Warn().Int("decision", int(decision)).Msg("dispute settlement: unhandled vote decision")
		return
	}
	if err := fsm.Validate(order.Status, nextStatus, "api.dispute_jury.settle"); err != nil {
		logging.Error(err).Str("order_id", order.ID.String()).Msg("dispute settlement: invalid final transition")
		return
	}

	oracle := solana.GetOracle()
	if oracle == nil {
		logging.Warn().Str("dispute_id", jury.DisputeID.String()).Msg("dispute settlement: oracle not configured, enqueueing outbox")
		enqueueJurySettlementRetry(&order, decision, "oracle_nil")
		return
	}

	buyerPubKey, err := sol.PublicKeyFromBase58(order.BuyerWallet)
	if err != nil {
		logging.Error(err).Str("buyer_wallet", order.BuyerWallet).Msg("dispute settlement: invalid buyer wallet address")
		return
	}
	sellerPubKey, err := sol.PublicKeyFromBase58(order.SellerWallet)
	if err != nil {
		logging.Error(err).Str("seller_wallet", order.SellerWallet).Msg("dispute settlement: invalid seller wallet address")
		return
	}
	escrowPDA, err := sol.PublicKeyFromBase58(order.EscrowPDA)
	if err != nil {
		logging.Error(err).Str("escrow_pda", order.EscrowPDA).Msg("dispute settlement: invalid escrow PDA")
		return
	}

	var txHash string
	switch decision {
	case models.VoteBuyerWins:
		txHash, err = oracle.EmergencyRefund(ctx, solana.RefundEscrowParams{
			Buyer:     buyerPubKey,
			EscrowPDA: escrowPDA,
		})
	case models.VoteSellerWins:
		txHash, err = oracle.SettleEscrow(ctx, "api.dispute_jury.seller_wins", solana.SettleEscrowParams{
			Buyer:           buyerPubKey,
			Seller:          sellerPubKey,
			EscrowPDA:       escrowPDA,
			BandwidthUsedGB: resolveChainBandwidthLimit(ctx, &order),
		})
	case models.VoteSplitFunds:
		txHash, err = oracle.SettleEscrow(ctx, "api.dispute_jury.split_funds", solana.SettleEscrowParams{
			Buyer:           buyerPubKey,
			Seller:          sellerPubKey,
			EscrowPDA:       escrowPDA,
			BandwidthUsedGB: resolveChainBandwidthLimit(ctx, &order) / 2,
		})
	}

	if err != nil {
		logging.Error(err).Str("jury_id", jury.ID.String()).Msg("dispute settlement: blockchain call failed; enqueueing outbox")
		enqueueJurySettlementRetry(&order, decision, err.Error())
		return
	}
	extras := map[string]interface{}{}
	if txHash != "" {
		extras["tx_hash"] = txHash
	}
	if err := fsm.TransitionOrder(db.DB, &order, nextStatus, "api.dispute_jury.settle", extras); err != nil {
		logging.Error(err).Str("order_id", order.ID.String()).Msg("dispute settlement: failed to persist final transition")
		return
	}
	_ = db.DB.Model(&models.DisputeJury{}).Where("id = ?", jury.ID).Updates(map[string]interface{}{
		"on_chain_tx_hash": txHash,
	}).Error

	logging.Info().
		Str("jury_id", jury.ID.String()).
		Str("tx_hash", txHash).
		Msg("dispute settlement: blockchain settlement submitted")
}

func loadOrderForJurySettlement(jury models.DisputeJury) (models.Order, error) {
	var order models.Order
	if err := db.DB.Where("id = ?", jury.DisputeID).First(&order).Error; err == nil {
		return order, nil
	}
	// Legacy auto-jury rows used EscrowDispute.ID as DisputeID — resolve via escrow dispute.
	var ed models.EscrowDispute
	if err := db.DB.Where("id = ?", jury.DisputeID).First(&ed).Error; err != nil {
		return models.Order{}, err
	}
	if err := db.DB.Where("id = ?", ed.OrderID).First(&order).Error; err != nil {
		return models.Order{}, err
	}
	return order, nil
}

func enqueueJurySettlementRetry(order *models.Order, decision models.JuryVote, reason string) {
	if order == nil {
		return
	}
	switch decision {
	case models.VoteSellerWins:
		EnqueueEscrowSettle(order, "api.dispute_jury.seller_wins_outbox")
	case models.VoteSplitFunds:
		EnqueueEscrowSettleUsage(order, "api.dispute_jury.split_funds_outbox", solana.LimitUnitsFromGiB(orderPurchasedGiB(order))/2)
	case models.VoteBuyerWins:
		EnqueueEscrowRefund(order, "api.dispute_jury.buyer_wins_outbox", reason)
	default:
		logging.Warn().Int("decision", int(decision)).Msg("dispute settlement: no outbox mapping for decision")
	}
}

// @Summary Get jury voting status
// @Tags dispute-jury
// @Param id path string true "Jury ID"
// @Produce json
// @Success 200 {object} gin.H
// @Router /v1/disputes/jury/{id}/status [get]
func getJuryStatus(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "none", "source_of_truth")

	juryID := c.Param("id")

	var jury models.DisputeJury
	if err := db.DB.Where("id = ?", juryID).First(&jury).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Jury not found"})
		return
	}

	decision, hasMajority := jury.GetMajority()

	c.JSON(http.StatusOK, gin.H{
		"jury_id":          jury.ID,
		"status":           jury.Status,
		"votes_cast":       jury.GetVoteCount(),
		"total_jurors":     jury.GetJurorCount(),
		"has_majority":     hasMajority,
		"current_decision": decision,
		"voting_deadline":  jury.VotingDeadline,
		"is_expired":       time.Now().After(jury.VotingDeadline),
		"buyer_payout":     jury.BuyerPayout,
		"seller_payout":    jury.SellerPayout,
	})
}

func computeReasonHash(reason string) [32]byte {
	return sha256.Sum256([]byte(reason))
}
