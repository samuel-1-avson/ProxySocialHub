package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterOrderRoutes registers order-related routes
func RegisterOrderRoutes(rg *gin.RouterGroup) {
	rg.POST("/orders", createOrder)
	rg.GET("/orders", getMyOrders)
	rg.GET("/orders/:id", getOrder)
	rg.GET("/sales", getMySales)
}

// createOrder creates a new order (purchase)
func createOrder(c *gin.Context) {
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

	// Calculate price (check bulk discounts)
	totalPrice := calculatePriceWithDiscounts(&listing, req.BandwidthGB)
	pricePerGB := totalPrice / req.BandwidthGB

	// Check buyer wallet balance
	var wallet models.Wallet
	if err := db.DB.First(&wallet, "user_id = ?", buyerID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No wallet found. Please add funds first."})
		return
	}

	if wallet.Balance < totalPrice {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient balance"})
		return
	}

	// Create order
	order := models.Order{
		BuyerID:     buyerID,
		SellerID:    listing.SellerID,
		ListingID:   listing.ID,
		BandwidthGB: req.BandwidthGB,
		PricePerGB:  pricePerGB,
		TotalPrice:  totalPrice,
		Status:      models.OrderStatusPending,
	}

	tx := db.DB.Begin()

	// Create order
	if err := tx.Create(&order).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create order"})
		return
	}

	// Deduct from buyer wallet
	newBalance := wallet.Balance - totalPrice
	tx.Model(&wallet).Update("balance", newBalance)

	// Create ledger entry for buyer
	buyerLedger := models.WalletLedgerEntry{
		WalletID:     wallet.ID,
		Amount:       -totalPrice,
		BalanceAfter: newBalance,
		Type:         "purchase",
		ReferenceID:  order.ID.String(),
		Description:  "Purchase from " + getDisplayName(listing.Seller),
	}
	tx.Create(&buyerLedger)

	// Distribute Funds
	// Platform Fee: 10%
	platformFee := totalPrice * 0.10
	netAmount := totalPrice - platformFee

	var clanShare float64 = 0
	var sellerAmount = netAmount

	// Check for Clan Revenue Share
	if listing.CircleID != nil && listing.Circle != nil && listing.Circle.RevenueSharePercent > 0 {
		clanShare = netAmount * listing.Circle.RevenueSharePercent
		sellerAmount = netAmount - clanShare

		// Credit Clan Owner
		var clanOwnerWallet models.Wallet
		if err := tx.First(&clanOwnerWallet, "user_id = ?", listing.Circle.OwnerID).Error; err != nil {
			clanOwnerWallet = models.Wallet{UserID: listing.Circle.OwnerID, Balance: 0, Currency: "GHS"}
			tx.Create(&clanOwnerWallet)
		}
		clanOwnerNewBalance := clanOwnerWallet.Balance + clanShare
		tx.Model(&clanOwnerWallet).Update("balance", clanOwnerNewBalance)

		// Ledger for Clan Owner
		tx.Create(&models.WalletLedgerEntry{
			WalletID:     clanOwnerWallet.ID,
			Amount:       clanShare,
			BalanceAfter: clanOwnerNewBalance,
			Type:         "clan_share",
			ReferenceID:  order.ID.String(),
			Description:  fmt.Sprintf("Clan share (%.0f%%) from sale in %s", listing.Circle.RevenueSharePercent*100, listing.Circle.Name),
		})
	}

	// Credit Seller
	var sellerWallet models.Wallet
	if err := tx.First(&sellerWallet, "user_id = ?", listing.SellerID).Error; err != nil {
		// Create wallet if not exists
		sellerWallet = models.Wallet{
			UserID:   listing.SellerID,
			Balance:  0,
			Currency: "GHS",
		}
		tx.Create(&sellerWallet)
	}

	sellerNewBalance := sellerWallet.Balance + sellerAmount
	tx.Model(&sellerWallet).Update("balance", sellerNewBalance)

	// Create ledger entry for seller
	sellerLedger := models.WalletLedgerEntry{
		WalletID:     sellerWallet.ID,
		Amount:       sellerAmount,
		BalanceAfter: sellerNewBalance,
		Type:         "sale",
		ReferenceID:  order.ID.String(),
		Description:  "Sale of " + floatToString(req.BandwidthGB) + " GB bandwidth",
	}
	tx.Create(&sellerLedger)

	// Update listing stats
	tx.Model(&listing).Updates(map[string]interface{}{
		"available_bandwidth_gb": listing.AvailableBandwidthGB - req.BandwidthGB,
		"orders_count":           listing.OrdersCount + 1,
	})

	// Update seller stats
	tx.Model(&models.User{}).Where("id = ?", listing.SellerID).Update("total_bandwidth_sold", db.DB.Raw("total_bandwidth_sold + ?", req.BandwidthGB))

	// Mark as sold out if no bandwidth left
	if listing.AvailableBandwidthGB-req.BandwidthGB <= 0 {
		tx.Model(&listing).Update("status", models.ListingStatusSoldOut)
	}

	// Update order status to active
	tx.Model(&order).Update("status", models.OrderStatusActive)

	// Create feed event
	feedEvent := models.FeedEvent{
		ActorID:    &buyerID,
		EventType:  models.FeedEventNewSale,
		TargetType: "order",
		TargetID:   &order.ID,
		Content:    "purchased " + floatToString(req.BandwidthGB) + " GB",
	}
	tx.Create(&feedEvent)

	// Create a session for the buyer with the purchased bandwidth
	session := models.Session{
		UserID:         buyerID,
		Type:           models.SessionRotating,
		Status:         models.SessionActive,
		BandwidthLimit: int64(req.BandwidthGB * 1024 * 1024 * 1024), // Convert GB to Bytes
		Config:         "{}",                                        // Default config
	}
	if err := tx.Create(&session).Error; err == nil {
		// Link session to order
		tx.Model(&order).Update("session_id", session.ID)
	}

	tx.Commit()

	// Reload order with relations
	db.DB.Preload("Buyer").Preload("Seller").Preload("Listing").First(&order, "id = ?", order.ID)

	// Notify seller via WebSocket
	BroadcastToUser(listing.SellerID.String(), MsgTypeNewOrder, gin.H{
		"order":   order,
		"message": "New sale: " + floatToString(req.BandwidthGB) + " GB purchased",
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
