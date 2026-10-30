package api

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/marketplace/funnel"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/orders/fsm"
	"github.com/proxyhubb/control-api/internal/solana"

	sol "github.com/gagliardetto/solana-go"
)

type confirmEscrowRequest struct {
	TxSignature string `json:"tx_signature"`
}

// confirmEscrow activates a pending_payment order when the on-chain escrow PDA
// for the buyer/seller pair already exists and is funded (Pending/Active).
// This covers the case where initializeEscrow succeeded once but SessionActivator
// missed the event, or a retry hits "Allocate: account already in use".
func confirmEscrow(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "on_chain_escrow_verify", "source_of_truth")

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

	var req confirmEscrowRequest
	_ = c.ShouldBindJSON(&req)

	var order models.Order
	if err := db.DB.First(&order, "id = ?", orderID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}
	if order.BuyerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not your order"})
		return
	}

	if order.Status == models.OrderStatusActive || order.Status == models.OrderStatusCompleted {
		if order.SessionID != nil {
			_ = marketplace.ActivateOrderSession(c.Request.Context(), order.ID)
		}
		c.JSON(http.StatusOK, gin.H{
			"order":           order,
			"escrow_pda":      order.EscrowPDA,
			"already_active":  true,
			"on_chain_status": "skipped",
		})
		return
	}

	escrow, pda, problem := confirmOrderEscrowCore(c.Request.Context(), &order, req.TxSignature, "api.orders.confirm_escrow", "confirm_escrow")
	if problem != nil {
		c.JSON(problem.Status, problem.Body)
		return
	}

	actor := userID
	RecordAuditLog(c, models.AuditOrderEscrowConfirmed, models.AuditSeverityInfo, &actor, "order", order.ID.String(),
		"Escrow confirmed via on-chain PDA reuse", true)

	c.JSON(http.StatusOK, gin.H{
		"order":           order,
		"escrow_pda":      pda.String(),
		"on_chain_status": escrow.Status.String(),
		"amount_lamports": escrow.Amount,
		"already_active":  false,
	})
}

// escrowConfirmProblem is an HTTP-shaped failure from confirmOrderEscrowCore.
type escrowConfirmProblem struct {
	Status int
	Body   gin.H
}

func (p *escrowConfirmProblem) Error() string {
	if msg, ok := p.Body["error"].(string); ok {
		return msg
	}
	return http.StatusText(p.Status)
}

// confirmOrderEscrowCore verifies the order's on-chain escrow and moves the order to
// active. The order must be pending or pending_payment. Shared by the confirm-escrow
// endpoint (browser-signed escrow) and the fiat flow (server-signed escrow).
func confirmOrderEscrowCore(ctx context.Context, order *models.Order, txSignature, fsmSource, funnelSource string) (*solana.Escrow, sol.PublicKey, *escrowConfirmProblem) {
	fail := func(status int, body gin.H) (*solana.Escrow, sol.PublicKey, *escrowConfirmProblem) {
		return nil, sol.PublicKey{}, &escrowConfirmProblem{Status: status, Body: body}
	}

	if order.Status != models.OrderStatusPending && order.Status != models.OrderStatusPendingPayment {
		return fail(http.StatusConflict, gin.H{
			"error":  "Order is not awaiting escrow confirmation",
			"status": order.Status,
		})
	}

	if decentralization.RequireEscrowPDAEnabled() && order.EscrowPDA == "" {
		return fail(http.StatusBadRequest, gin.H{
			"error": "PROXYHUB_REQUIRE_ESCROW_PDA: order has no escrow_pda; complete POST .../pay/solana first",
			"code":  "escrow_pda_required",
		})
	}

	buyerAddr := order.BuyerWallet
	sellerAddr := order.SellerWallet
	if buyerAddr == "" {
		var buyerWallet models.LinkedWallet
		if err := db.DB.Where("user_id = ? AND chain = ? AND is_primary = true", order.BuyerID, models.ChainSolana).First(&buyerWallet).Error; err != nil {
			return fail(http.StatusBadRequest, gin.H{"error": "Please link a Solana wallet first"})
		}
		buyerAddr = buyerWallet.Address
	}
	if sellerAddr == "" {
		var sellerWallet models.LinkedWallet
		if err := db.DB.Where("user_id = ? AND chain = ? AND is_primary = true", order.SellerID, models.ChainSolana).First(&sellerWallet).Error; err != nil {
			return fail(http.StatusBadRequest, gin.H{"error": "Seller has not linked a Solana wallet"})
		}
		sellerAddr = sellerWallet.Address
	}

	buyerPub, err := sol.PublicKeyFromBase58(buyerAddr)
	if err != nil {
		return fail(http.StatusBadRequest, gin.H{"error": "Invalid buyer wallet address"})
	}
	sellerPub, err := sol.PublicKeyFromBase58(sellerAddr)
	if err != nil {
		return fail(http.StatusBadRequest, gin.H{"error": "Invalid seller wallet address"})
	}

	oracle := solana.GetOracle()
	if oracle == nil {
		return fail(http.StatusServiceUnavailable, gin.H{"error": "Solana Oracle not configured"})
	}

	// Prefer stored order PDA (required for BC-06 escrow_multisig seeds with expires_at).
	var pda sol.PublicKey
	if order.EscrowPDA != "" {
		pda, err = sol.PublicKeyFromBase58(order.EscrowPDA)
		if err != nil {
			return fail(http.StatusBadRequest, gin.H{"error": "Invalid escrow_pda on order"})
		}
	} else if orderUsesMultisigSettle(order) && order.EscrowExpiresAt > 0 {
		pda, _, err = oracle.GetEscrowMultiSigPDA(buyerPub, sellerPub, order.EscrowExpiresAt)
		if err != nil {
			return fail(http.StatusInternalServerError, gin.H{"error": "Failed to derive multisig escrow PDA"})
		}
	} else {
		pda, _, err = oracle.GetEscrowPDA(buyerPub, sellerPub)
		if err != nil {
			return fail(http.StatusInternalServerError, gin.H{"error": "Failed to derive escrow PDA"})
		}
	}

	// BE-CRIT-03: one funded escrow must back one order at a time. The legacy PDA is per
	// buyer/seller pair, so without this a second order could be activated against funds
	// locked for the first.
	if bound, err := orderEscrowBoundElsewhere(db.DB, pda.String(), order.ID); err != nil {
		return fail(http.StatusInternalServerError, gin.H{"error": "Failed to check escrow binding"})
	} else if bound {
		return fail(http.StatusConflict, gin.H{
			"error":      "This escrow already backs another active order. Wait for it to settle or refund before starting a new purchase.",
			"escrow_pda": pda.String(),
			"code":       "escrow_already_bound",
		})
	}

	var escrow *solana.Escrow
	var fetchErr error
	backoffs := []time.Duration{0, 400 * time.Millisecond, 1200 * time.Millisecond, 2500 * time.Millisecond}
	for _, wait := range backoffs {
		if wait > 0 {
			select {
			case <-ctx.Done():
				return fail(http.StatusGatewayTimeout, gin.H{"error": "Timed out waiting for on-chain escrow"})
			case <-time.After(wait):
			}
		}
		escrow, fetchErr = oracle.FetchEscrow(ctx, pda)
		if fetchErr == nil && escrow != nil {
			break
		}
	}
	if fetchErr != nil || escrow == nil {
		logging.Warn().Err(fetchErr).Str("escrow_pda", pda.String()).Str("order_id", order.ID.String()).
			Msg("confirm-escrow: on-chain escrow not found")
		return fail(http.StatusConflict, gin.H{
			"error":      "On-chain escrow not found. Approve the wallet initializeEscrow transaction, then try again.",
			"escrow_pda": pda.String(),
			"code":       "escrow_missing",
		})
	}

	if escrow.Status != solana.EscrowPending && escrow.Status != solana.EscrowActive {
		return fail(http.StatusConflict, gin.H{
			"error":           "On-chain escrow is not fundable for a new order",
			"escrow_pda":      pda.String(),
			"on_chain_status": escrow.Status.String(),
			"code":            "escrow_terminal",
		})
	}

	if escrow.ExpiresAt > 0 && time.Now().Unix() >= escrow.ExpiresAt {
		return fail(http.StatusConflict, gin.H{
			"error":      "On-chain escrow has expired. Refund it before starting a new purchase.",
			"escrow_pda": pda.String(),
			"code":       "escrow_expired",
		})
	}

	if escrow.Amount == 0 {
		return fail(http.StatusConflict, gin.H{
			"error":      "On-chain escrow has no locked funds",
			"escrow_pda": pda.String(),
			"code":       "escrow_empty",
		})
	}

	// BE-CRIT-03: the escrow must hold what the order cost and allow the bandwidth bought.
	// Checked against the quote pay/solana recorded, before amount_locked_sol is replaced
	// with the on-chain amount below.
	if problem := checkOrderEscrowFunding(order, escrow); problem != nil {
		return fail(problem.Status, gin.H{
			"error":             problem.Message,
			"escrow_pda":        pda.String(),
			"code":              problem.Code,
			"amount_lamports":   escrow.Amount,
			"required_lamports": minLamportsForQuote(order.AmountLockedSOL),
		})
	}

	amountLockedSOL := float64(escrow.Amount) / 1e9
	fields := map[string]interface{}{
		"payment_method":    "solana_escrow",
		"escrow_pda":        pda.String(),
		"buyer_wallet":      buyerAddr,
		"seller_wallet":     sellerAddr,
		"amount_locked_sol": amountLockedSOL,
	}
	if txSignature != "" {
		fields["tx_signature"] = txSignature
	} else if order.TxSignature != "" {
		fields["tx_signature"] = order.TxSignature
	}

	if err := fsm.TransitionOrder(db.DB, order, models.OrderStatusActive, fsmSource, fields); err != nil {
		return fail(http.StatusBadRequest, gin.H{"error": err.Error()})
	}

	if err := marketplace.ActivateOrderSession(context.Background(), order.ID); err != nil {
		logging.Error(err).Str("order_id", order.ID.String()).
			Msg("confirm-escrow: order active but session sync failed; scheduling retry")
		orderIDCopy := order.ID
		go func() {
			time.Sleep(2 * time.Second)
			if retryErr := marketplace.ActivateOrderSession(context.Background(), orderIDCopy); retryErr != nil {
				logging.Warn().Err(retryErr).Str("order_id", orderIDCopy.String()).
					Msg("confirm-escrow: immediate session activation retry failed")
			}
		}()
	}

	funnel.Record(ctx, funnel.RecordParams{
		EventName: models.FunnelEscrowConfirmed,
		UserID:    &order.BuyerID,
		ListingID: &order.ListingID,
		OrderID:   &order.ID,
		Surface:   "api",
		Meta: map[string]interface{}{
			"escrow_pda":   pda.String(),
			"tx_signature": txSignature,
			"source":       funnelSource,
		},
	})

	return escrow, pda, nil
}
