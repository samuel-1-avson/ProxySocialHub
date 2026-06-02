package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/prices"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/ws"

	sol "github.com/gagliardetto/solana-go"
)

// RegisterOrderRoutes registers order-related routes
func RegisterOrderRoutes(rg *gin.RouterGroup) {
	rg.POST("/orders", createOrder)
	rg.GET("/orders", getMyOrders)
	rg.GET("/orders/:id", getOrder)
	rg.POST("/orders/:id/cancel", cancelOrder)
	rg.GET("/sales", getMySales)
	rg.POST("/orders/:id/pay/solana", initiateSolanaPayment)
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

	if err := models.ValidateOrderStatusTransition(order.Status, models.OrderStatusPendingPayment); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
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

	// Update Order with Intent — move to pending_payment so the order is not
	// treated as active until the on-chain escrow deposit is confirmed.
	db.DB.Model(&order).Updates(map[string]interface{}{
		"status":             models.OrderStatusPendingPayment,
		"payment_method":     "solana_escrow",
		"escrow_pda":         pda.String(),
		"buyer_wallet":       buyerWallet.Address,
		"seller_wallet":      sellerWallet.Address,
		"amount_locked_sol":  amountSOL,
		"bandwidth_limit_gb": uint64(order.BandwidthGB),
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

	// Check buyer wallet balance (Minimum threshold for Pay-As-You-Go)
	var wallet models.Wallet
	if err := db.DB.First(&wallet, "user_id = ?", buyerID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No wallet found. Please add funds first."})
		return
	}

	if wallet.BalanceSOL <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient SOL balance. Please deposit/swap funds."})
		return
	}

	// Fetch buyer user to get TrustTier for Redis SessionData
	var buyer models.User
	if err := db.DB.First(&buyer, "id = ?", buyerID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve user profile"})
		return
	}

	// Create order (Track allocation, but simple IaaS model)
	order := models.Order{
		BuyerID:     buyerID,
		SellerID:    listing.SellerID,
		ListingID:   listing.ID,
		BandwidthGB: 0,                  // Pay-As-You-Go (Unlimited until empty wallet)
		PricePerGB:  listing.PricePerGB, // Lock in the rate
		TotalPrice:  0,                  // Charged via Usage
		Status:      models.OrderStatusActive,
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

	// Create a session for the buyer (Unlimited/Pay-As-You-Go)
	session := models.Session{
		UserID:          buyerID,
		ListingID:       &listing.ID,
		Type:            sessionType,
		Status:          models.SessionActive,
		CredentialsUser: credUser,
		CredentialsPass: credPass,
		BandwidthLimit:  0, // 0 = Unlimited / Pay-As-You-Go
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

	// Real-time Broadcast & Cache
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

	// Store in Redis for Gateway authentication
	sessionData := &redisClient.SessionData{
		UserID:         buyerID.String(),
		SessionID:      session.ID.String(),
		ProviderID:     listing.SellerID.String(),
		Type:           string(sessionType),
		Status:         "active",
		BandwidthLimit: 0,
		BandwidthUsed:  0,
		TrustTier:      string(buyer.TrustTier),
		ExpiresAt:      time.Now().Add(24 * time.Hour),
		CreatedAt:      time.Now(),
	}

	// Store with 24-hour TTL
	if err := redisClient.StoreSession(credUser, sessionData, 24*time.Hour); err != nil {
		// Log but don't fail return - session is still in DB
		fmt.Printf("WARNING: Redis session sync failed: %v\n", err)
	}
	// Reload order with relations
	db.DB.Preload("Buyer").Preload("Seller").Preload("Listing").First(&order, "id = ?", order.ID)

	// Notify seller via WebSocket
	BroadcastToUser(listing.SellerID.String(), ws.MsgTypeNewOrder, gin.H{
		"order":   order,
		"message": "New sale: " + floatToString(req.BandwidthGB) + " GB purchased",
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

	// Response includes session credentials if created
	response := gin.H{
		"order": order,
	}
	if order.SessionID != nil {
		var createdSession models.Session
		db.DB.First(&createdSession, "id = ?", order.SessionID)
		response["session"] = createdSession
		response["proxy_credentials"] = gin.H{
			"username": createdSession.CredentialsUser,
			"password": createdSession.CredentialsPass,
			"endpoint": "proxy.proxyhubb.com:8080",
		}
	}
	c.JSON(http.StatusCreated, response)

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

// cancelOrder cancels an active or pending order owned by the caller
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

	if err := models.ValidateOrderStatusTransition(order.Status, models.OrderStatusCancelled); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
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

	if err := db.DB.Model(&order).Update("status", models.OrderStatusCancelled).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to cancel order"})
		return
	}

	// Deactivate linked session if present
	if order.SessionID != nil {
		db.DB.Model(&models.Session{}).
			Where("id = ?", order.SessionID).
			Update("status", models.SessionTerminated)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Order cancelled successfully"})
}
