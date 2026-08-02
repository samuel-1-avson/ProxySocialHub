package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	marketplacepkg "github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/marketplace/funnel"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/orders/fsm"
	"github.com/proxyhubb/control-api/internal/prices"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/ws"

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

	// Fetch Buyer's Linked Wallet
	var buyerWallet models.LinkedWallet
	if err := db.DB.Where("user_id = ? AND chain = ? AND is_primary = true", buyerID, models.ChainSolana).First(&buyerWallet).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Please link a Solana wallet first"})
		return
	}

	// Fetch Seller's Linked Wallet
	var sellerWallet models.LinkedWallet
	if err := db.DB.Where("user_id = ? AND chain = ? AND is_primary = true", order.SellerID, models.ChainSolana).First(&sellerWallet).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Seller has not linked a Solana wallet. Cannot use smart contract payment."})
		return
	}

	// Validate Addresses
	buyerPubKey, err := sol.PublicKeyFromBase58(buyerWallet.Address)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid buyer wallet address"})
		return
	}
	sellerPubKey, err := sol.PublicKeyFromBase58(sellerWallet.Address)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid seller wallet address"})
		return
	}

	// Derive PDA
	oracle := solana.GetOracle()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Solana Oracle not configured"})
		return
	}

	pda, _, err := oracle.GetEscrowPDA(buyerPubKey, sellerPubKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to derive PDA"})
		return
	}

	// Calculate Amount in SOL
	// Assuming Order.TotalPrice is USD (or whatever listing currency was)
	// We need Listing to know currency? Assuming USD for safe smart contract logic.
	solPrice, err := prices.GetSOLPrice(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Failed to fetch SOL price"})
		return
	}
	if solPrice <= 0 {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Invalid SOL price: price feed returned zero"})
		return
	}

	// Safety buffer: 1.05x to account for fluctuations? Or fixed USD value?
	// Smart contract usually locks specific SOL amount.
	// Amount in SOL = TotalPrice / SOL_Price
	amountSOL := order.TotalPrice / solPrice
	amountLamports := uint64(amountSOL * 1e9)

	// H-02: Verify buyer has sufficient on-chain SOL balance before recording the PDA.
	// Without this check the DB row would reference an escrow that can never be funded.
	buyerOnChainLamports, err := oracle.GetBalance(c.Request.Context(), buyerPubKey)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Failed to fetch buyer on-chain balance"})
		return
	}
	if buyerOnChainLamports < amountLamports {
		c.JSON(http.StatusPaymentRequired, gin.H{
			"error":     "Insufficient on-chain SOL balance",
			"required":  amountSOL,
			"available": float64(buyerOnChainLamports) / 1e9,
		})
		return
	}

	// Update Order with Intent ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â move to pending_payment so the order is not
	// treated as active until the on-chain escrow deposit is confirmed.
	if err := fsm.TransitionOrder(db.DB, &order, models.OrderStatusPendingPayment, "api.orders.pay_solana", map[string]interface{}{
		"payment_method":     "solana_escrow",
		"escrow_pda":         pda.String(),
		"buyer_wallet":       buyerWallet.Address,
		"seller_wallet":      sellerWallet.Address,
		"amount_locked_sol":  amountSOL,
		"bandwidth_limit_gb": uint64(order.BandwidthGB),
	}); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	funnel.Record(c.Request.Context(), funnel.RecordParams{
		EventName: models.FunnelEscrowInitiated,
		UserID:    &buyerID,
		ListingID: &order.ListingID,
		OrderID:   &order.ID,
		Surface:   "api",
		Meta: map[string]interface{}{
			"escrow_pda": pda.String(),
		},
	})

	c.JSON(http.StatusOK, gin.H{
		"program_id":      solana.ProgramID,
		"escrow_pda":      pda.String(),
		"buyer_pubkey":    buyerWallet.Address,
		"seller_pubkey":   sellerWallet.Address,
		"amount_lamports": amountLamports,
		"amount_sol":      amountSOL,
		"bandwidth_gb":    order.BandwidthGB,
		"oracle_pubkey":   oracle.GetOraclePublicKey().String(),
	})
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
	if listing.AvailableBandwidthGB > 0 && req.BandwidthGB > listing.AvailableBandwidthGB {
		c.JSON(http.StatusConflict, gin.H{"error": "Requested bandwidth exceeds listing availability"})
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create session"})
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
	db.DB.Preload("Buyer").Preload("Seller").Preload("Listing").First(&order, "id = ?", order.ID)

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

func buildProxyCredentialsResponse(session *models.Session) gin.H {
	host, port, endpoint := BuyerProxyConnectInfo()
	return gin.H{
		"username": session.CredentialsUser,
		"password": session.CredentialsPass,
		"host":     host,
		"port":     port,
		"protocol": "http",
		"endpoint": endpoint,
	}
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

	// Opportunistic repair: order is funded/active but Redis sync may have failed.
	// Never roll the order back — kick ActivateOrderSession once before 409.
	if session.Status == models.SessionActivationFailed || session.Status == models.SessionActivationPending {
		if actErr := marketplacepkg.ActivateOrderSession(c.Request.Context(), order.ID); actErr != nil {
			// fall through to status check / retryable 409
			_ = actErr
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

	c.JSON(http.StatusOK, gin.H{
		"proxy_credentials": buildProxyCredentialsResponse(&session),
	})
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

	if err := query.Preload("Seller").Preload("Listing").
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&orders).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch orders"})
		return
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
	if err := db.DB.Preload("Buyer").Preload("Seller").Preload("Listing").
		First(&order, "id = ?", orderID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	// Check access
	if order.BuyerID != userID && order.SellerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

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

	if err := query.Preload("Buyer").Preload("Listing").
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&orders).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch sales"})
		return
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

	if orderNeedsEscrowResolutionBeforeCancel(order) {
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

	// Deactivate linked session if present and revoke Redis credentials so
	// CONNECT cannot keep using cancelled-order sessions (backlog 1.2).
	if order.SessionID != nil {
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

	c.JSON(http.StatusOK, gin.H{"message": "Order cancelled successfully"})
}
