package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/logging"
	marketplacepkg "github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/marketplace/funnel"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/orders/fsm"
	"github.com/proxyhubb/control-api/internal/prices"
	"github.com/proxyhubb/control-api/internal/proofs"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/ws"
	"gorm.io/gorm"

	sol "github.com/gagliardetto/solana-go"
)

// RegisterOrderRoutes registers JWT-only seller/order routes that are not
// part of the B2B purchase surface.
func RegisterOrderRoutes(rg *gin.RouterGroup) {
	rg.GET("/sales", getMySales)
}

// RegisterPartnerPurchaseRoutes registers B2B purchase endpoints (JWT or API key).
// List/get/pay/cancel share orders:create so API-key clients can complete the
// full create → pay → credentials lifecycle without a separate JWT session.
func RegisterPartnerPurchaseRoutes(rg *gin.RouterGroup) {
	// sandbox-buy before :id routes so Gin does not treat "sandbox-buy" as an id.
	rg.POST("/orders/sandbox-buy", requireBulkScope("orders:create"), sandboxBuyOrder)
	rg.POST("/orders", requireBulkScope("orders:create"), createOrder)
	rg.GET("/orders", requireBulkScope("orders:create"), getMyOrders)
	rg.GET("/orders/:id", requireBulkScope("orders:create"), getOrder)
	rg.GET("/orders/:id/credentials", requireBulkScope("orders:create"), getOrderCredentials)
	rg.POST("/orders/:id/pay/solana", requireBulkScope("orders:create"), initiateSolanaPayment)
	rg.POST("/orders/:id/confirm-escrow", requireBulkScope("orders:create"), confirmEscrow)
	rg.POST("/orders/:id/cancel", requireBulkScope("orders:create"), cancelOrder)
	rg.POST("/orders/:id/activate-dev", requireBulkScope("orders:create"), activateDevOrder)
}

// initiateSolanaPayment prepares a non-custodial escrow transaction
func initiateSolanaPayment(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "read_only_balance_check", "source_of_truth")

	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	buyerID, err := uuid.Parse(userIDStr)
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
	if err := db.DB.Preload("Seller").First(&order, "id = ?", orderID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	if order.BuyerID != buyerID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not your order"})
		return
	}

	intent, problem := prepareOrderEscrow(c.Request.Context(), &order, "api.orders.pay_solana", true)
	if problem != nil {
		c.JSON(problem.Status, problem.Body)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"program_id":             solana.ProgramID,
		"escrow_pda":             intent.PDA.String(),
		"buyer_pubkey":           intent.Buyer.String(),
		"seller_pubkey":          intent.Seller.String(),
		"amount_lamports":        intent.AmountLamports,
		"amount_sol":             intent.AmountSOL,
		"bandwidth_gb":           order.BandwidthGB,
		"escrow_bandwidth_units": solana.LimitUnitsFromGiB(order.BandwidthGB),
		"oracle_pubkey":          intent.OraclePubkey.String(),
		"escrow_already_funded":  intent.AlreadyFunded,
		"on_chain_escrow_status": intent.OnChainStatus,
		"escrow_seed_kind":       intent.SeedKind,
		"escrow_expires_at":      intent.ExpiresAt,
	})
}

// orderEscrowIntent is the escrow an order will be funded into: who pays, who is
// paid, the PDA and the SOL amount quoted from the order's USD total.
type orderEscrowIntent struct {
	Buyer          sol.PublicKey
	Seller         sol.PublicKey
	PDA            sol.PublicKey
	AmountSOL      float64
	AmountLamports uint64
	SeedKind       string
	ExpiresAt      int64
	OraclePubkey   sol.PublicKey
	AlreadyFunded  bool
	OnChainStatus  string
}

// prepareOrderEscrow quotes the order in SOL, derives the escrow PDA and moves the
// order to pending_payment. checkBalance runs the H-02 buyer balance precheck; the
// fiat path skips it because the managed wallet is funded after the quote.
func prepareOrderEscrow(ctx context.Context, order *models.Order, fsmSource string, checkBalance bool) (*orderEscrowIntent, *escrowConfirmProblem) {
	fail := func(status int, body gin.H) (*orderEscrowIntent, *escrowConfirmProblem) {
		return nil, &escrowConfirmProblem{Status: status, Body: body}
	}

	// Fetch Buyer's Linked Wallet
	var buyerWallet models.LinkedWallet
	if err := db.DB.Where("user_id = ? AND chain = ? AND is_primary = true", order.BuyerID, models.ChainSolana).First(&buyerWallet).Error; err != nil {
		return fail(http.StatusBadRequest, gin.H{"error": "Please link a Solana wallet first"})
	}

	// Fetch Seller's Linked Wallet
	var sellerWallet models.LinkedWallet
	if err := db.DB.Where("user_id = ? AND chain = ? AND is_primary = true", order.SellerID, models.ChainSolana).First(&sellerWallet).Error; err != nil {
		return fail(http.StatusBadRequest, gin.H{"error": "Seller has not linked a Solana wallet. Cannot use smart contract payment."})
	}

	// Validate Addresses
	buyerPubKey, err := sol.PublicKeyFromBase58(buyerWallet.Address)
	if err != nil {
		return fail(http.StatusInternalServerError, gin.H{"error": "Invalid buyer wallet address"})
	}
	sellerPubKey, err := sol.PublicKeyFromBase58(sellerWallet.Address)
	if err != nil {
		return fail(http.StatusInternalServerError, gin.H{"error": "Invalid seller wallet address"})
	}

	oracle := solana.GetOracle()
	if oracle == nil {
		return fail(http.StatusServiceUnavailable, gin.H{"error": "Solana Oracle not configured"})
	}

	// Calculate Amount in SOL
	// Assuming Order.TotalPrice is USD (or whatever listing currency was)
	// We need Listing to know currency? Assuming USD for safe smart contract logic.
	solPrice, err := prices.GetSOLPrice(ctx)
	if err != nil {
		return fail(http.StatusServiceUnavailable, gin.H{"error": "Failed to fetch SOL price"})
	}
	if solPrice <= 0 {
		return fail(http.StatusServiceUnavailable, gin.H{"error": "Invalid SOL price: price feed returned zero"})
	}

	// Safety buffer: 1.05x to account for fluctuations? Or fixed USD value?
	// Smart contract usually locks specific SOL amount.
	// Amount in SOL = TotalPrice / SOL_Price
	amountSOL := order.TotalPrice / solPrice
	amountLamports := models.SOLToLamports(amountSOL)

	// BC-06: amount-gated escrow_multisig PDA (legacy below threshold).
	seedKind := "legacy"
	var escrowExpiresAt int64
	var pda sol.PublicKey
	if decentralization.MultisigSettleEnabled() && amountLamports >= decentralization.MultisigSettleAmountLamports() {
		seedKind = escrowSeedKindMultisig
		escrowExpiresAt = time.Now().UTC().AddDate(0, 0, decentralization.EscrowChallengeDays()).Unix()
		var derErr error
		pda, _, derErr = oracle.GetEscrowMultiSigPDA(buyerPubKey, sellerPubKey, escrowExpiresAt)
		if derErr != nil {
			return fail(http.StatusInternalServerError, gin.H{"error": "Failed to derive multisig escrow PDA"})
		}
	} else {
		var derErr error
		pda, _, derErr = oracle.GetEscrowPDA(buyerPubKey, sellerPubKey)
		if derErr != nil {
			return fail(http.StatusInternalServerError, gin.H{"error": "Failed to derive PDA"})
		}
	}
	if pda.IsZero() {
		return fail(http.StatusInternalServerError, gin.H{"error": "Derived escrow PDA is empty"})
	}

	// H-02: Verify buyer has sufficient on-chain SOL balance before recording the PDA.
	// Without this check the DB row would reference an escrow that can never be funded.
	// When the RPC is rate-limited (common on public devnet), skip the precheck and let
	// the wallet transaction be the funding gate — SessionActivator still requires on-chain init.
	if checkBalance {
		buyerOnChainLamports, err := oracle.GetBalance(ctx, buyerPubKey)
		if err != nil {
			logging.Warn().
				Err(err).
				Str("buyer", buyerPubKey.String()).
				Str("order_id", order.ID.String()).
				Msg("pay/solana: on-chain balance precheck unavailable; proceeding (wallet is funding gate)")
		} else if buyerOnChainLamports < amountLamports {
			return fail(http.StatusPaymentRequired, gin.H{
				"error":     "Insufficient on-chain SOL balance",
				"required":  amountSOL,
				"available": float64(buyerOnChainLamports) / 1e9,
			})
		}
	}

	// Update Order with Intent — move to pending_payment so the order is not
	// treated as active until the on-chain escrow deposit is confirmed.
	extras := map[string]interface{}{
		"payment_method":     "solana_escrow",
		"escrow_pda":         pda.String(),
		"buyer_wallet":       buyerWallet.Address,
		"seller_wallet":      sellerWallet.Address,
		"amount_locked_sol":  amountSOL,
		"bandwidth_limit_gb": uint64(order.BandwidthGB),
		"escrow_seed_kind":   seedKind,
		"escrow_expires_at":  escrowExpiresAt,
	}
	if err := fsm.TransitionOrder(db.DB, order, models.OrderStatusPendingPayment, fsmSource, extras); err != nil {
		return fail(http.StatusBadRequest, gin.H{"error": err.Error()})
	}
	order.EscrowPDA = pda.String()
	order.EscrowSeedKind = seedKind
	order.EscrowExpiresAt = escrowExpiresAt
	order.BuyerWallet = buyerWallet.Address
	order.SellerWallet = sellerWallet.Address
	order.AmountLockedSOL = amountSOL

	funnel.Record(ctx, funnel.RecordParams{
		EventName: models.FunnelEscrowInitiated,
		UserID:    &order.BuyerID,
		ListingID: &order.ListingID,
		OrderID:   &order.ID,
		Surface:   "api",
		Meta: map[string]interface{}{
			"escrow_pda":       pda.String(),
			"escrow_seed_kind": seedKind,
		},
	})

	// Legacy PDA is one account per buyer/seller pair. Multisig PDAs include expires_at.
	escrowAlreadyFunded := false
	onChainStatus := ""
	if existing, fetchErr := oracle.FetchEscrow(ctx, pda); fetchErr == nil && existing != nil {
		onChainStatus = existing.Status.String()
		if (existing.Status == solana.EscrowPending || existing.Status == solana.EscrowActive) &&
			existing.Amount > 0 &&
			(existing.ExpiresAt == 0 || time.Now().Unix() < existing.ExpiresAt) {
			escrowAlreadyFunded = true
		}
	}

	return &orderEscrowIntent{
		Buyer:          buyerPubKey,
		Seller:         sellerPubKey,
		PDA:            pda,
		AmountSOL:      amountSOL,
		AmountLamports: amountLamports,
		SeedKind:       seedKind,
		ExpiresAt:      escrowExpiresAt,
		OraclePubkey:   oracle.GetOraclePublicKey(),
		AlreadyFunded:  escrowAlreadyFunded,
		OnChainStatus:  onChainStatus,
	}, nil
}

// createOrder creates a new order (purchase)
func createOrder(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "none", "source_of_truth")

	sandboxBuy := false
	if v, ok := c.Get("sandbox_buy"); ok {
		sandboxBuy, _ = v.(bool)
	}

	// Robust User ID Extraction
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	buyerID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	var req models.CreateOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get listing
	var listing models.ProxyListing
	if err := db.DB.Preload("Seller").Preload("Circle").First(&listing, "id = ?", req.ListingID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
		return
	}
	if !listing.Status.IsPurchasable() {
		c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("Listing is not available (status: %s)", listing.Status)})
		return
	}
	if listing.SellerID == buyerID {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "You cannot buy your own listing. Connect with a different Solana wallet (buyer), or open someone else's listing.",
			"code":  "self_purchase_forbidden",
		})
		return
	}
	if listing.AvailableBandwidthGB > 0 && req.BandwidthGB > listing.AvailableBandwidthGB {
		c.JSON(http.StatusConflict, gin.H{"error": "Requested bandwidth exceeds listing availability"})
		return
	}
	if marketplacepkg.ListingAtConcurrencyCap(&listing) {
		c.JSON(http.StatusConflict, gin.H{
			"error": fmt.Sprintf("This listing already has %d active buyer sessions (max %d). Another buyer can join when a session ends.", listing.MaxConcurrency, listing.MaxConcurrency),
			"code":  "listing_at_capacity",
		})
		return
	}

	if !sandboxBuy {
		if err := EnsureBuyerBandwidthQuota(buyerID, req.BandwidthGB); err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error(), "code": "plan_bandwidth_quota"})
			return
		}
	}

	providerNode, err := marketplacepkg.ResolveListingProviderNode(&listing)
	if err != nil || providerNode == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Provider has no available nodes for this listing. Try again shortly."})
		return
	}

	requestedTotalPrice := calculatePriceWithDiscounts(&listing, req.BandwidthGB)
	unitPrice := listing.PricePerGB
	if req.BandwidthGB > 0 {
		unitPrice = requestedTotalPrice / req.BandwidthGB
	}
	// Fail closed on mispriced offers: a zero or negative total must never reach escrow.
	if requestedTotalPrice <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "This offer is mispriced for the requested size. Try a different amount or another offer."})
		return
	}
	if listing.MinPurchaseGB > 0 && req.BandwidthGB < listing.MinPurchaseGB {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Minimum purchase for this offer is %.2f GB", listing.MinPurchaseGB)})
		return
	}

	// Marketplace checkout is escrow-funded from the buyer's linked on-chain SOL
	// wallet (see initiateSolanaPayment). Do not preflight custodial balance_sol —
	// that rail is for deposits/subscriptions/PAYG, not PDA escrow.
	if !sandboxBuy {
		var linked models.LinkedWallet
		if err := db.DB.Where("user_id = ? AND chain = ? AND is_primary = true", buyerID, models.ChainSolana).
			First(&linked).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Link a Solana wallet before creating a marketplace order. Payment uses on-chain SOL escrow.",
				"code":  "linked_wallet_required",
			})
			return
		}
	}

	if !sandboxBuy {
		existing, err := activePlanWithSeller(db.DB, buyerID, listing.SellerID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check existing plans"})
			return
		}
		if existing != nil {
			c.JSON(http.StatusConflict, activePlanExistsBody(&existing.ID))
			return
		}
	}

	bandwidthLimitBytes := int64(req.BandwidthGB * 1024 * 1024 * 1024)
	bandwidthLimitGB := uint64(req.BandwidthGB)
	if req.BandwidthGB > 0 && bandwidthLimitGB == 0 {
		bandwidthLimitGB = 1
	}

	// Create order. It remains pending until the buyer funds the Solana escrow.
	if err := fsm.AssertCreatableStatus(models.OrderStatusPending, "api.orders.create"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	order := models.Order{
		BuyerID:          buyerID,
		SellerID:         listing.SellerID,
		ListingID:        listing.ID,
		BandwidthGB:      req.BandwidthGB,
		PricePerGB:       unitPrice, // Lock in effective (possibly bulk-discounted) rate
		TotalPrice:       requestedTotalPrice,
		Status:           models.OrderStatusPending,
		BandwidthLimitGB: bandwidthLimitGB,
	}

	tx := db.DB.Begin()

	// Create order record
	if err := tx.Create(&order).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create IaaS allocation"})
		return
	}

	// Update listing stats
	tx.Model(&listing).Updates(map[string]interface{}{
		"orders_count": listing.OrdersCount + 1,
	})

	// Generate secure credentials
	credUser, credPass := generateCredentials()

	// Resolve session type from request, defaulting to rotating
	sessionType := req.SessionType
	if sessionType != models.SessionRotating && sessionType != models.SessionSticky {
		sessionType = models.SessionRotating
	}

	// Create a bandwidth-capped session for the buyer. This lets gateway usage
	// reports trigger deterministic session finalization and proof settlement.
	sessionNodeID := marketplacepkg.SessionNodeIDForProvider(providerNode)
	session := models.Session{
		UserID:          buyerID,
		NodeID:          sessionNodeID,
		ListingID:       &listing.ID,
		Type:            sessionType,
		Status:          models.SessionDisabled,
		CredentialsUser: credUser,
		CredentialsPass: credPass,
		BandwidthLimit:  bandwidthLimitBytes,
		Config:          "{}",
	}
	if err := tx.Create(&session).Error; err != nil {
		tx.Rollback()
		logging.Error(err).
			Str("buyer_id", buyerID.String()).
			Str("listing_id", listing.ID.String()).
			Msg("orders.create: session insert failed")
		// Surface a precise, safe message when encryption/config is the cause.
		errMsg := err.Error()
		if strings.Contains(errMsg, "encryption key") || strings.Contains(errMsg, "encrypt credentials") {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to create session: credential encryption unavailable on server",
				"code":  "session_encryption_failed",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  "Failed to create session",
			"code":   "session_create_failed",
			"detail": errMsg,
		})
		return
	}

	// Link session to order
	if err := tx.Model(&order).Update("session_id", session.ID).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to link session to order"})
		return
	}

	// Create Feed Event for Sale (with Whale Alert)
	isWhale := order.TotalPrice >= 500.0

	feedMeta := map[string]interface{}{
		"price":         order.TotalPrice,
		"currency":      listing.PricePerGB, // Unit price
		"bandwidth_gb":  req.BandwidthGB,
		"listing_title": listing.Title,
		"is_whale":      isWhale,
	}

	feedEvent := models.CreateFeedEvent(
		&buyerID,
		models.FeedEventNewSale,
		"listing",
		&listing.ID,
		fmt.Sprintf("purchased %.2f GB of '%s'", req.BandwidthGB, listing.Title),
		feedMeta,
	)
	tx.Create(feedEvent)

	tx.Commit()
	invalidateMarketplaceReadModels()

	// Real-time Broadcast & Cache (credentials activate after escrow ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â see docs/MARKETPLACE_CREDENTIAL_GATING.md)
	go func() {
		// Populate Actor for feed
		var fullEvent models.FeedEvent
		if err := db.DB.Preload("Actor").First(&fullEvent, "id = ?", feedEvent.ID).Error; err == nil {
			PublishFeedEvent(fullEvent) // Handles standard broadcast + Redis Cache

			if isWhale {
				BroadcastToAll("whale_alert", fullEvent) // Special effect
			}
		}
	}()

	// Reload order with relations
	db.DB.Preload("Buyer", counterpartyColumns).Preload("Seller", counterpartyColumns).Preload("Listing").First(&order, "id = ?", order.ID)
	scrubCounterpartyTaxID(order.Buyer)
	scrubCounterpartyTaxID(order.Seller)

	// Notify seller via WebSocket
	BroadcastToUser(listing.SellerID.String(), ws.MsgTypeNewOrder, gin.H{
		"order":   order,
		"message": "New sale: " + floatToString(req.BandwidthGB) + " GB purchased",
	})
	funnel.Record(c.Request.Context(), funnel.RecordParams{
		EventName: models.FunnelOrderCreated,
		UserID:    &buyerID,
		ListingID: &listing.ID,
		OrderID:   &order.ID,
		Surface:   "order_api",
		Meta: map[string]interface{}{
			"bandwidth_gb": req.BandwidthGB,
			"total_price":  order.TotalPrice,
			"auth_type":    c.GetString("auth_type"),
			"sandbox_buy":  sandboxBuy,
		},
	})

	dispatchUserNotification(c.Request.Context(), userNotification{
		UserID:     listing.SellerID,
		Type:       models.NotificationNewOrder,
		Title:      "New sale",
		Body:       "New sale: " + floatToString(req.BandwidthGB) + " GB purchased",
		ActionURL:  "/dashboard/orders",
		ActionType: "open_order",
		ActorID:    &buyerID,
		TargetType: "order",
		TargetID:   &order.ID,
		Dedupe:     true,
	})

	actor := buyerID
	desc := "Order created"
	if sandboxBuy {
		desc = "Sandbox order created (wallet preflight skipped)"
	} else if c.GetString("auth_type") == "api_key" {
		desc = "Order created via API key"
	}
	RecordAuditLog(c, models.AuditOrderCreated, models.AuditSeverityInfo, &actor, "order", order.ID.String(), desc, true)

	if sandboxBuy {
		finalizeSandboxBuy(c, &order, buyerID)
		return
	}

	response := gin.H{
		"order": order,
	}
	if order.SessionID != nil {
		var createdSession models.Session
		db.DB.First(&createdSession, "id = ?", order.SessionID)
		response["session"] = createdSession
	}
	c.JSON(http.StatusCreated, response)

}

func orderCredentialsEligible(status models.OrderStatus) bool {
	return status == models.OrderStatusActive || status == models.OrderStatusCompleted
}

// publishedBuyerAuthHMAC is the CONNECT scheme for BuyerProxyConnectInfo()
// (public proxy.proxyhubb.com:8090). Capability soak is a separate endpoint.
const publishedBuyerAuthHMAC = "hmac"

func sessionExpiresAtRFC3339(session *models.Session) string {
	if session == nil || session.ExpiresAt == nil || session.ExpiresAt.IsZero() {
		return ""
	}
	return session.ExpiresAt.UTC().Format(time.RFC3339)
}

func buildProxyCredentialsResponse(session *models.Session) gin.H {
	host, port, endpoint := BuyerProxyConnectInfo()
	hmacPass := session.CredentialsPass
	out := gin.H{
		"username":          session.CredentialsUser,
		"password":          hmacPass,
		"legacy_password":   hmacPass,
		"auth_for_endpoint": publishedBuyerAuthHMAC,
		"host":              host,
		"port":              port,
		"protocol":          "http",
		"endpoint":          endpoint,
	}
	if iso := sessionExpiresAtRFC3339(session); iso != "" {
		out["expires_at"] = iso
	}
	return out
}

// getOrderCredentials returns proxy credentials after escrow activation.
func getOrderCredentials(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "none", "source_of_truth")

	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
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
	if err := db.DB.First(&order, "id = ?", orderID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	if order.BuyerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	if !orderCredentialsEligible(order.Status) {
		c.JSON(http.StatusConflict, gin.H{
			"error":  "Proxy credentials are available after escrow payment is confirmed",
			"status": order.Status,
		})
		return
	}

	if order.SessionID == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Order has no linked session"})
		return
	}

	var session models.Session
	if err := db.DB.First(&session, "id = ?", *order.SessionID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Session not found"})
		return
	}

	// Opportunistic repair: order is funded/active but Redis sync may have failed,
	// never left disabled, or the linked session was terminated while the order
	// is still active. Never roll the order back — kick ActivateOrderSession once.
	if session.Status == models.SessionDisabled ||
		session.Status == models.SessionTerminated ||
		session.Status == models.SessionActivationFailed ||
		session.Status == models.SessionActivationPending {
		if actErr := marketplacepkg.ActivateOrderSession(c.Request.Context(), order.ID); actErr != nil {
			logging.Warn().
				Err(actErr).
				Str("order_id", order.ID.String()).
				Str("session_status", string(session.Status)).
				Msg("credentials: ActivateOrderSession repair failed")
		} else if err := db.DB.First(&session, "id = ?", *order.SessionID).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Session not found after activation retry"})
			return
		}
	}

	if session.Status != models.SessionActive {
		c.JSON(http.StatusConflict, gin.H{
			"error":          "Proxy credentials are not ready yet",
			"status":         order.Status,
			"session_status": session.Status,
			"retryable":      true,
		})
		return
	}

	funnel.Record(c.Request.Context(), funnel.RecordParams{
		EventName: models.FunnelCredentialsDelivered,
		UserID:    &userID,
		ListingID: &order.ListingID,
		OrderID:   &order.ID,
		Surface:   "api",
	})

	if err := session.DecryptCredentialsForGateway(); err != nil {
		logging.Warn().Err(err).Str("session_id", session.ID.String()).Msg("credentials: decrypt for response")
	}

	resp := gin.H{
		"proxy_credentials": buildProxyCredentialsResponse(&session),
	}
	if iso := sessionExpiresAtRFC3339(&session); iso != "" {
		resp["expires_at"] = iso
	}
	if decentralization.CredentialProofEnabled() {
		if art := proofs.BuildOrderCredentialArtifact(proofs.OrderCredentialPayload{
			OrderID:      order.ID,
			SessionID:    session.ID,
			BuyerID:      order.BuyerID,
			ListingID:    order.ListingID,
			UsernameHash: proofs.HashCredentialsUsername(session.CredentialsUser),
			IssuedAt:     time.Now().UTC().Unix(),
			ExpiresAt:    time.Now().UTC().Add(24 * time.Hour).Unix(),
		}, decentralization.CredentialProofMode()); art != nil {
			resp["credential_proof"] = art
			note := "platform HMAC over order/session/username_hash; Access Pass NFT unchanged"
			switch decentralization.CredentialProofMode() {
			case "enforce":
				note += "; enforced at edge CONNECT for marketplace Redis sessions"
			default:
				note += "; observe-only (not enforced at CONNECT)"
			}
			resp["credential_proof_note"] = note
		}
	}
	if decentralization.SessionCapabilityEnabled() {
		var listing models.ProxyListing
		_ = db.DB.First(&listing, "id = ?", order.ListingID)
		wire, capErr := marketplacepkg.IssueSessionCapabilityToken(&order, &session, &listing)
		if capErr != nil {
			logging.Warn().Err(capErr).Str("order_id", order.ID.String()).Msg("credentials: session capability token")
			if decentralization.SessionCapabilityEnforce() {
				resp["session_capability_error"] = capErr.Error()
			}
		} else if wire != "" {
			resp["session_capability"] = wire
			resp["session_capability_note"] = "Soak CONNECT token (phubb1.…) for Host-A :18091. Public proxy.proxyhubb.com:8090 uses proxy_credentials.password (HMAC). Capability verify is local; Redis session is optional. Remaining SPOF is the token issuer."
		}
	}

	c.JSON(http.StatusOK, resp)
}

// counterpartyColumns projects a preloaded order counterparty to identity and contact
// basics. TaxID, wallet, business and verification details stay server-side.
func counterpartyColumns(q *gorm.DB) *gorm.DB {
	return q.Select("id", "email", "display_name", "username", "avatar_url")
}

// publicSellerColumns projects a preloaded listing seller to the public storefront
// fields marketplace clients render. Contact and business details stay server-side.
func publicSellerColumns(q *gorm.DB) *gorm.DB {
	return q.Select("id", "display_name", "username", "avatar_url", "location", "avg_rating", "reviews_count", "total_bandwidth_sold", "verified", "is_online", "last_seen_at")
}

// scrubCounterpartyTaxID clears tax data that User.AfterFind refills from the vault
// even for projected queries. Call after every counterparty preload: order parties
// keep identity and contact basics, never tax details.
func scrubCounterpartyTaxID(u *models.User) {
	if u == nil {
		return
	}
	u.TaxID = nil
}

// scrubPublicSeller clears contact and tax data that User.AfterFind refills from the
// vault even for projected queries. Call after every public seller preload:
// storefronts keep display fields only.
func scrubPublicSeller(u *models.User) {
	if u == nil {
		return
	}
	u.Email = ""
	u.TaxID = nil
}

// getMyOrders returns the current user's purchases
func getMyOrders(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "none", "source_of_truth")

	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	var orders []models.Order
	var total int64

	query := db.DB.Model(&models.Order{}).Where("buyer_id = ?", userID)
	query.Count(&total)

	if err := query.Preload("Seller", counterpartyColumns).Preload("Listing").
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&orders).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch orders"})
		return
	}
	for i := range orders {
		scrubCounterpartyTaxID(orders[i].Seller)
	}

	c.JSON(http.StatusOK, gin.H{
		"orders": orders,
		"total":  total,
		"page":   page,
		"limit":  limit,
	})
}

// getOrder returns a single order
func getOrder(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "none", "source_of_truth")

	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
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
	if err := db.DB.Preload("Buyer", counterpartyColumns).Preload("Seller", counterpartyColumns).Preload("Listing").
		First(&order, "id = ?", orderID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	// Check access
	if order.BuyerID != userID && order.SellerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}
	scrubCounterpartyTaxID(order.Buyer)
	scrubCounterpartyTaxID(order.Seller)

	c.JSON(http.StatusOK, order)
}

// getMySales returns the current user's sales
func getMySales(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "none", "source_of_truth")

	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	var orders []models.Order
	var total int64

	query := db.DB.Model(&models.Order{}).Where("seller_id = ?", userID)
	query.Count(&total)

	if err := query.Preload("Buyer", counterpartyColumns).Preload("Listing").
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&orders).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch sales"})
		return
	}
	for i := range orders {
		scrubCounterpartyTaxID(orders[i].Buyer)
	}

	c.JSON(http.StatusOK, gin.H{
		"sales": orders,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

// Helper functions
func floatToString(f float64) string {
	return fmt.Sprintf("%.2f", f)
}

func calculatePriceWithDiscounts(listing *models.ProxyListing, bandwidthGB float64) float64 {
	basePrice := listing.PricePerGB

	// Parse bulk discounts
	var discounts []models.BulkDiscount
	if len(listing.BulkDiscounts) > 0 {
		// Try to unmarshal (it's stored as JSONB/bytes)
		if err := json.Unmarshal(listing.BulkDiscounts, &discounts); err != nil {
			return basePrice * bandwidthGB
		}
	}

	// Find applicable discount (highest min_gb that fits)
	bestPrice := basePrice
	for _, d := range discounts {
		if bandwidthGB >= d.MinGB && d.PricePerGB < bestPrice {
			bestPrice = d.PricePerGB
		}
	}

	return bestPrice * bandwidthGB
}

func getDisplayName(user *models.User) string {
	if user == nil {
		return "Unknown"
	}
	if user.DisplayName != nil && *user.DisplayName != "" {
		return *user.DisplayName
	}
	if user.Username != nil && *user.Username != "" {
		return "@" + *user.Username
	}
	return user.Email
}

func orderNeedsEscrowResolutionBeforeCancel(order models.Order) bool {
	if order.PaymentMethod != "solana_escrow" && order.EscrowPDA == "" {
		return false
	}
	return order.Status == models.OrderStatusPendingPayment || order.Status == models.OrderStatusActive
}

// cancelOrder cancels an unfunded pending order owned by the caller.
// Escrow-backed orders must go through refund, settlement, or dispute handling
// so local order state cannot diverge from on-chain escrow state.
func cancelOrder(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "none", "source_of_truth")

	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	buyerID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	orderID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order ID"})
		return
	}

	var order models.Order
	if err := db.DB.First(&order, "id = ? AND buyer_id = ?", orderID, buyerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	unfunded := false
	if order.Status == models.OrderStatusPendingPayment {
		var problem gin.H
		unfunded, problem = pendingOrderUnfunded(c.Request.Context(), &order)
		if problem != nil {
			c.JSON(http.StatusConflict, problem)
			return
		}
	}

	if !unfunded && orderNeedsEscrowResolutionBeforeCancel(order) {
		c.JSON(http.StatusConflict, gin.H{
			"error":      "Escrow-backed orders require refund, settlement, or dispute resolution before cancellation",
			"status":     order.Status,
			"escrow_pda": order.EscrowPDA,
		})
		return
	}

	if order.SessionID != nil {
		var session models.Session
		if err := db.DB.First(&session, "id = ?", order.SessionID).Error; err == nil {
			if err := models.ValidateSessionStatusTransition(session.Status, models.SessionTerminated); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
		}
	}

	if err := fsm.TransitionOrder(db.DB, &order, models.OrderStatusCancelled, "api.orders.cancel", nil); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	terminateOrderSession(&order)

	c.JSON(http.StatusOK, gin.H{"message": "Order cancelled successfully"})
}

// terminateOrderSession deactivates a cancelled order's session and revokes its Redis
// credentials so CONNECT cannot keep using it (backlog 1.2).
func terminateOrderSession(order *models.Order) {
	if order.SessionID == nil {
		return
	}
	var session models.Session
	if err := db.DB.First(&session, "id = ?", order.SessionID).Error; err == nil {
		_ = db.DB.Model(&session).Update("status", models.SessionTerminated).Error
		if session.CredentialsUser != "" {
			_ = redisClient.DeleteSession(session.CredentialsUser)
			_ = redisClient.DeleteUsage(session.CredentialsUser)
		}
	} else {
		db.DB.Model(&models.Session{}).
			Where("id = ?", order.SessionID).
			Update("status", models.SessionTerminated)
	}
}

// pendingOrderUnfunded reports whether a pending_payment order never got its own
// escrow, so cancelling it cannot strand funds. A card payment already received
// returns a problem instead: that order is being finished, not abandoned.
func pendingOrderUnfunded(ctx context.Context, order *models.Order) (bool, gin.H) {
	paymentInProgress := gin.H{
		"error": "We already received your payment and are finishing this order.",
		"code":  "payment_in_progress",
	}
	if fiatPaymentInProgress(order.ID) {
		return false, paymentInProgress
	}
	var quoted []models.FiatPayment
	db.DB.Where("order_id = ? AND status = ?", order.ID, models.FiatPaymentQuoted).Find(&quoted)
	for i := range quoted {
		paid, err := closeUnpaidCheckout(ctx, &quoted[i], "checkout cancelled by buyer")
		if err != nil {
			return false, gin.H{"error": "Could not check the payment with Paystack. Try again shortly."}
		}
		if paid {
			return false, paymentInProgress
		}
	}
	if order.EscrowPDA == "" {
		return true, nil
	}
	pda, err := sol.PublicKeyFromBase58(order.EscrowPDA)
	if err != nil {
		return true, nil
	}
	// The PDA is shared per buyer/seller: an escrow held by another order is not this one's.
	if bound, err := orderEscrowBoundElsewhere(db.DB, order.EscrowPDA, order.ID); err == nil && bound {
		return true, nil
	}
	funded, known := pendingEscrowFunded(ctx, pda)
	return known && !funded, nil
}

// pendingEscrowFunded reports whether the escrow at pda holds funds. known is false
// when the chain could not be read, so callers never treat an RPC failure as unfunded.
var pendingEscrowFunded = func(ctx context.Context, pda sol.PublicKey) (funded, known bool) {
	oracle := solana.GetOracle()
	if oracle == nil {
		return false, false
	}
	e, err := oracle.FetchEscrow(ctx, pda)
	if err != nil {
		return false, strings.Contains(strings.ToLower(err.Error()), "not found")
	}
	return e != nil && e.Amount > 0 && (e.Status == solana.EscrowPending || e.Status == solana.EscrowActive), true
}
