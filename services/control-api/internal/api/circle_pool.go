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
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/ws"
)

// RegisterCirclePoolRoutes registers circle bandwidth pooling routes
func RegisterCirclePoolRoutes(rg *gin.RouterGroup) {
	// Circle pool management
	rg.GET("/circles/:id/pool", getCirclePoolStatus)
	// Note: join/leave circle pool uses existing circle membership endpoints
	// These are placeholder routes for future pool-specific join/leave logic
	rg.POST("/circles/:id/pool/contribute", contributeBandwidth)
	
	// Enterprise quotes
	rg.POST("/circles/:id/quotes", requestEnterpriseQuote)
	rg.GET("/circles/:id/quotes", getCircleQuotes)
	rg.POST("/circles/quotes/:quoteId/accept", acceptQuote)
	
	// Pool sessions
	rg.POST("/circles/:id/sessions", createCircleSession)
	rg.GET("/circles/:id/sessions", getCircleSessions)
	
	// Revenue sharing
	rg.GET("/circles/:id/revenue", getCircleRevenue)
	rg.POST("/circles/:id/revenue/claim", claimRevenue)

	// Aliases for frontend compatibility (singular /circle pattern)
	circle := rg.Group("/circle")
	{
		circle.GET("/status", func(c *gin.Context) {
			// Proxy to first circle status for legacy frontend
			c.Redirect(http.StatusTemporaryRedirect, "/v1/circles/my")
		})
		circle.GET("/my-contributions", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"contributions": []interface{}{}})
		})
		circle.GET("/revenues", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"revenues": []interface{}{}})
		})
	}
}

// CirclePoolStatus represents the status of a circle's bandwidth pool
type CirclePoolStatus struct {
	CircleID            uuid.UUID         `json:"circle_id"`
	CircleName          string            `json:"circle_name"`
	TotalCapacityGB     float64           `json:"total_capacity_gb"`
	AvailableCapacityGB float64           `json:"available_capacity_gb"`
	UsedCapacityGB      float64           `json:"used_capacity_gb"`
	UtilizationPercent  float64           `json:"utilization_percent"`
	MemberCount         int               `json:"member_count"`
	ActiveSessionCount  int               `json:"active_session_count"`
	Members             []PoolMemberInfo  `json:"members"`
	IsEnterpriseReady   bool              `json:"is_enterprise_ready"`
}

// CircleRevenueResponse matches frontend interface
type CircleRevenueResponse struct {
	RevenueID            uuid.UUID  `json:"revenue_id"`
	PeriodStart          time.Time  `json:"period_start"`
	PeriodEnd            time.Time  `json:"period_end"`
	TotalPoolRevenue     float64    `json:"total_pool_revenue"`
	ProviderID           uuid.UUID  `json:"provider_id"`
	ProviderSharePercent float64    `json:"provider_share_percent"`
	ProviderRevenue      float64    `json:"provider_revenue"`
	SessionsCount        int        `json:"sessions_count"`
	Status               string     `json:"status"` // pending, paid, processing
	PaidAt               *time.Time `json:"paid_at,omitempty"`
	TxHash               string     `json:"tx_hash,omitempty"`
}

// PoolMemberInfo represents a member's contribution to the pool
type PoolMemberInfo struct {
	ProviderID       uuid.UUID `json:"provider_id"`
	ProviderName     string    `json:"provider_name"`
	AvatarURL        string    `json:"avatar_url"`
	ContributedGB    float64   `json:"contributed_gb"`
	UsedGB           float64   `json:"used_gb"`
	SharePercent     float64   `json:"share_percent"`
	RevenueEarned    float64   `json:"revenue_earned"`
	IsOnline         bool      `json:"is_online"`
	QualityScore     float64   `json:"quality_score"`
}

// getCirclePoolStatus returns the pool status for a circle
func getCirclePoolStatus(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}

	log.Printf("[getCirclePoolStatus] Request for circle %s", circleID)

	var circle models.Circle
	if err := db.Social().Preload("Members").Preload("Members.User").First(&circle, "id = ?", circleID).Error; err != nil {
		log.Printf("[getCirclePoolStatus] Circle %s not found", circleID)
		c.JSON(http.StatusNotFound, gin.H{"error": "Circle not found"})
		return
	}

	// Get circle members
	var circleMembers []models.CircleMember
	db.Social().Where("circle_id = ? AND status = ?", circleID, "active").Find(&circleMembers)
	log.Printf("[getCirclePoolStatus] Found %d active members", len(circleMembers))

	// Calculate pool stats
	var totalCapacity, usedCapacity float64
	var activeSessions int64

	// REP-005: Prefer on-chain ProviderRegistry.total_bandwidth_served as the
	// authoritative capacity figure.  Falls back to DB ContributedBandwidthGB
	// when the oracle is unavailable or a member hasn't registered on-chain.
	oracle := solana.GetOracleClient()
	for _, member := range circleMembers {
		var memberCapacityGB float64
		if oracle != nil {
			var memberUser models.User
			db.DB.Select("wallet_address").First(&memberUser, "id = ?", member.UserID)
			if memberUser.WalletAddress != nil && *memberUser.WalletAddress != "" {
				if pubkey, err := sol.PublicKeyFromBase58(*memberUser.WalletAddress); err == nil {
					if reg, err := oracle.ReadProviderRegistry(c.Request.Context(), pubkey); err == nil {
						// Convert bytes → GB
						memberCapacityGB = float64(reg.TotalBandwidthServed) / (1024 * 1024 * 1024)
					} else {
						logging.Warn().Str("user", member.UserID.String()).Msg("getCirclePoolStatus: ReadProviderRegistry failed, using DB fallback")
					}
				}
			}
		}
		if memberCapacityGB == 0 {
			memberCapacityGB = member.ContributedBandwidthGB
		}
		totalCapacity += memberCapacityGB
	}
	
	// Get active pool sessions
	db.DB.Model(&models.CircleSession{}).
		Where("circle_id = ? AND status = ?", circleID, "active").
		Count(&activeSessions)
	
	db.DB.Model(&models.CircleSession{}).
		Where("circle_id = ? AND status = ?", circleID, "active").
		Select("SUM(used_gb)").
		Scan(&usedCapacity)

	// Build member info
	members := make([]PoolMemberInfo, 0, len(circleMembers))
	for _, member := range circleMembers {
		var usedGB float64
		db.DB.Model(&models.CircleSession{}).
			Where("provider_id = ? AND status = ?", member.UserID, "active").
			Select("SUM(used_gb)").
			Scan(&usedGB)
		
		var revenue float64
		db.Social().Model(&models.CircleRevenue{}).
			Where("provider_id = ? AND circle_id = ?", member.UserID, circleID).
			Select("SUM(amount)").
			Scan(&revenue)

		// Get user info
		var user models.User
		db.DB.Select("id", "display_name", "avatar_url", "is_online", "avg_rating").First(&user, "id = ?", member.UserID)

		sharePercent := 0.0
		if totalCapacity > 0 {
			sharePercent = (member.ContributedBandwidthGB / totalCapacity) * 100
		}

		providerName := ""
		if user.DisplayName != nil {
			providerName = *user.DisplayName
		}
		avatarURL := ""
		if user.AvatarURL != nil {
			avatarURL = *user.AvatarURL
		}
		members = append(members, PoolMemberInfo{
			ProviderID:    member.UserID,
			ProviderName:  providerName,
			AvatarURL:     avatarURL,
			ContributedGB: member.ContributedBandwidthGB,
			UsedGB:        usedGB,
			SharePercent:  sharePercent,
			RevenueEarned: revenue,
			IsOnline:      user.IsOnline,
			QualityScore:  user.AvgRating * 20,
		})
	}

	availableCapacity := totalCapacity - usedCapacity
	utilization := 0.0
	if totalCapacity > 0 {
		utilization = (usedCapacity / totalCapacity) * 100
	}

	status := CirclePoolStatus{
		CircleID:            circleID,
		CircleName:          circle.Name,
		TotalCapacityGB:     totalCapacity,
		AvailableCapacityGB: availableCapacity,
		UsedCapacityGB:      usedCapacity,
		UtilizationPercent:  utilization,
		MemberCount:         len(circleMembers),
		ActiveSessionCount:  int(activeSessions),
		Members:             members,
		IsEnterpriseReady:   totalCapacity >= 1000 && len(circleMembers) >= 3, // 1TB+ and 3+ members
	}

	log.Printf("[getCirclePoolStatus] Final stats: total=%f, available=%f, members=%d", status.TotalCapacityGB, status.AvailableCapacityGB, len(status.Members))
	c.JSON(http.StatusOK, status)
}

// ContributeBandwidthRequest represents a bandwidth contribution
type ContributeBandwidthRequest struct {
	BandwidthGB float64 `json:"bandwidth_gb" binding:"required,gt=0"`
}

// contributeBandwidth adds bandwidth to the circle pool
func contributeBandwidth(c *gin.Context) {
	userID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}

	var req ContributeBandwidthRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify membership
	var membership models.CircleMember
	if err := db.Social().
		Where("circle_id = ? AND user_id = ?", circleID, userID).
		First(&membership).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "You are not a member of this circle"})
		return
	}

	// Update contribution
	membership.ContributedBandwidthGB += req.BandwidthGB
	if err := db.Social().Save(&membership).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update contribution"})
		return
	}

	// Update circle pool
	var circle models.Circle
	db.Social().First(&circle, "id = ?", circleID)
	circle.BandwidthPoolGB += req.BandwidthGB
	db.Social().Save(&circle)

	// Notify circle members
	BroadcastToCircle(circleID.String(), "pool_updated", gin.H{
		"provider_id":    userID,
		"bandwidth_added": req.BandwidthGB,
		"total_pool":     circle.BandwidthPoolGB,
	})

	c.JSON(http.StatusOK, gin.H{
		"message":          "Bandwidth contributed successfully",
		"contributed_gb":   membership.ContributedBandwidthGB,
		"total_pool_gb":    circle.BandwidthPoolGB,
	})
}

// EnterpriseQuoteRequest represents an enterprise quote request
type EnterpriseQuoteRequest struct {
	BandwidthGB   float64 `json:"bandwidth_gb" binding:"required,gt=0"`
	DurationMonths int    `json:"duration_months" binding:"required,min=1,max=12"`
	Requirements  string  `json:"requirements"`
	MaxPricePerGB float64 `json:"max_price_per_gb"`
}

// requestEnterpriseQuote creates an enterprise quote request
func requestEnterpriseQuote(c *gin.Context) {
	userID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}

	var req EnterpriseQuoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check circle capacity
	var circle models.Circle
	if err := db.Social().First(&circle, "id = ?", circleID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Circle not found"})
		return
	}

	if circle.BandwidthPoolGB < req.BandwidthGB {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("Circle only has %.0fGB available, need %.0fGB", circle.BandwidthPoolGB, req.BandwidthGB),
		})
		return
	}

	// Calculate quote price
	basePrice := req.BandwidthGB * circle.PricePerGB * float64(req.DurationMonths)
	discount := 0.0
	if req.BandwidthGB >= 1000 {
		discount = basePrice * 0.15 // 15% discount for 1TB+
	} else if req.BandwidthGB >= 500 {
		discount = basePrice * 0.10 // 10% discount for 500GB+
	}
	finalPrice := basePrice - discount

	quote := models.CircleQuote{
		CircleID:        circleID,
		RequesterID:     userID,
		BandwidthGB:     req.BandwidthGB,
		DurationMonths:  req.DurationMonths,
		BasePrice:       basePrice,
		DiscountAmount:  discount,
		FinalPrice:      finalPrice,
		Requirements:    req.Requirements,
		Status:          "pending",
		ExpiresAt:       time.Now().Add(7 * 24 * time.Hour), // Valid for 7 days
	}

	if err := db.Social().Create(&quote).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create quote"})
		return
	}

	// Notify circle members
	BroadcastToCircle(circleID.String(), "new_quote_request", gin.H{
		"quote_id":      quote.ID,
		"bandwidth_gb":  req.BandwidthGB,
		"duration":      req.DurationMonths,
		"final_price":   finalPrice,
		"requester_id":  userID,
	})

	c.JSON(http.StatusCreated, quote)
}

// getCircleQuotes returns all quotes for a circle
func getCircleQuotes(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}

	var quotes []models.CircleQuote
	if err := db.Social().
		Preload("Requester").
		Where("circle_id = ?", circleID).
		Order("created_at DESC").
		Find(&quotes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch quotes"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"quotes": quotes})
}

// acceptQuote accepts an enterprise quote
func acceptQuote(c *gin.Context) {
	userID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	quoteID, err := uuid.Parse(c.Param("quoteId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid quote ID"})
		return
	}

	var quote models.CircleQuote
	if err := db.Social().Preload("Circle").First(&quote, "id = ?", quoteID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Quote not found"})
		return
	}

	// Verify requester
	if quote.RequesterID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can only accept your own quotes"})
		return
	}

	// Check if expired
	if time.Now().After(quote.ExpiresAt) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Quote has expired"})
		return
	}

	// Update quote status
	quote.Status = "accepted"
	quote.AcceptedAt = &[]time.Time{time.Now()}[0]
	if err := db.Social().Save(&quote).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to accept quote"})
		return
	}

	// Create circle session
	session := models.CircleSession{
		CircleID:       quote.CircleID,
		BuyerID:        userID,
		QuoteID:        &quoteID,
		TotalGB:        quote.BandwidthGB,
		UsedGB:         0,
		DurationMonths: quote.DurationMonths,
		Status:         "active",
		StartedAt:      time.Now(),
		ExpiresAt:      &[]time.Time{time.Now().AddDate(0, quote.DurationMonths, 0)}[0],
	}

	if err := db.Social().Create(&session).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create session"})
		return
	}

	// Reserve bandwidth from pool
	quote.Circle.BandwidthPoolGB -= quote.BandwidthGB
	db.Social().Save(&quote.Circle)

	// Distribute revenue to providers (simplified - even split for now)
	go distributeRevenue(quote)

	// Notify circle
	BroadcastToCircle(quote.CircleID.String(), "quote_accepted", gin.H{
		"quote_id":    quoteID,
		"session_id":  session.ID,
		"revenue":     quote.FinalPrice,
	})

	c.JSON(http.StatusOK, gin.H{
		"message":    "Quote accepted",
		"quote":      quote,
		"session":    session,
	})
}

// createCircleSession creates a session using circle pool bandwidth
func createCircleSession(c *gin.Context) {
	userID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}

	var req struct {
		BandwidthGB float64 `json:"bandwidth_gb" binding:"required,gt=0"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check pool availability
	var circle models.Circle
	if err := db.Social().First(&circle, "id = ?", circleID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Circle not found"})
		return
	}

	if circle.BandwidthPoolGB < req.BandwidthGB {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient pool bandwidth"})
		return
	}

	// Select provider from pool (round-robin or based on availability)
	providerID := selectProviderFromPool(circleID)
	if providerID == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "No providers available in pool"})
		return
	}

	// Create session
	session := models.CircleSession{
		CircleID:   circleID,
		BuyerID:    userID,
		ProviderID: *providerID,
		TotalGB:    req.BandwidthGB,
		UsedGB:     0,
		Status:     "active",
		StartedAt:  time.Now(),
	}

	if err := db.Social().Create(&session).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create session"})
		return
	}

	// Reserve bandwidth
	circle.BandwidthPoolGB -= req.BandwidthGB
	db.Social().Save(&circle)

	c.JSON(http.StatusCreated, session)
}

// getCircleSessions returns sessions for a circle
func getCircleSessions(c *gin.Context) {
	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}

	var sessions []models.CircleSession
	if err := db.Social().
		Preload("Buyer").
		Preload("Provider").
		Where("circle_id = ?", circleID).
		Order("created_at DESC").
		Find(&sessions).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch sessions"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"sessions": sessions})
}

// getCircleRevenue returns revenue for a circle member
func getCircleRevenue(c *gin.Context) {
	userID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}

	var revenues []models.CircleRevenue
	if err := db.Social().
		Where("circle_id = ? AND provider_id = ?", circleID, userID).
		Order("created_at DESC").
		Find(&revenues).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch revenue"})
		return
	}

	var totalEarned, totalClaimed float64
	for _, r := range revenues {
		totalEarned += r.Amount
		if r.Claimed {
			totalClaimed += r.Amount
		}
	}

	var revenueResponses []CircleRevenueResponse
	for _, r := range revenues {
		status := "pending"
		if r.Claimed {
			status = "paid"
		}
		
		// Map 1:1 to maintain compatibility with frontend expected fields
		revenueResponses = append(revenueResponses, CircleRevenueResponse{
			RevenueID:            r.ID,
			PeriodStart:          r.CreatedAt, // Approximation
			PeriodEnd:            r.CreatedAt,
			TotalPoolRevenue:     r.Amount,    // Approximation
			ProviderID:           r.ProviderID,
			ProviderSharePercent: 0.0,         // Placeholder balance
			ProviderRevenue:      r.Amount,
			SessionsCount:        1,
			Status:               status,
			PaidAt:               r.ClaimedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"revenues":      revenueResponses,
		"total_earned":  totalEarned,
		"total_claimed": totalClaimed,
		"available":     totalEarned - totalClaimed,
	})
}

// claimRevenue claims earned revenue
func claimRevenue(c *gin.Context) {
	userID, err := getCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	circleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid circle ID"})
		return
	}

	// Get unclaimed revenue
	var revenues []models.CircleRevenue
	if err := db.Social().
		Where("circle_id = ? AND provider_id = ? AND claimed = ?", circleID, userID, false).
		Find(&revenues).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch revenue"})
		return
	}

	if len(revenues) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No revenue to claim"})
		return
	}

	var totalAmount float64
	for _, r := range revenues {
		r.Claimed = true
		r.ClaimedAt = &[]time.Time{time.Now()}[0]
		db.Social().Save(&r)
		totalAmount += r.Amount
	}

	// Credit provider's internal wallet with the claimed revenue amount.
	if totalAmount > 0 {
		var wallet models.Wallet
		if err := db.DB.Where("user_id = ?", userID).First(&wallet).Error; err == nil {
			wallet.BalanceSOL += totalAmount
			if saveErr := db.DB.Save(&wallet).Error; saveErr == nil {
				ledger := models.WalletLedgerEntry{
					WalletID:    wallet.ID,
					Amount:      totalAmount,
					BalanceAfter: wallet.BalanceSOL,
					Type:        models.TransactionEarning,
					Description: fmt.Sprintf("Circle pool revenue claim (%d records)", len(revenues)),
				}
				db.DB.Create(&ledger)
			} else {
				log.Printf("[claimRevenue] Failed to save wallet for user %s: %v", userID, saveErr)
			}
		} else {
			log.Printf("[claimRevenue] Failed to find wallet for user %s: %v", userID, err)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message":       "Revenue claimed",
		"amount":        totalAmount,
		"transactions":  len(revenues),
	})
}

// Helper functions

func selectProviderFromPool(circleID uuid.UUID) *uuid.UUID {
	// Get available providers from circle
	var members []models.CircleMember
	if err := db.Social().
		Where("circle_id = ?", circleID).
		Order("last_assigned_at ASC NULLS FIRST").
		Find(&members).Error; err != nil {
		return nil
	}

	if len(members) == 0 {
		return nil
	}

	// Select first available and update last assigned
	providerID := members[0].UserID
	now := time.Now()
	members[0].LastAssignedAt = &now
	db.Social().Save(&members[0])

	return &providerID
}

func distributeRevenue(quote models.CircleQuote) {
	// Get circle members
	var members []models.CircleMember
	db.Social().Where("circle_id = ?", quote.CircleID).Find(&members)

	if len(members) == 0 {
		return
	}

	// REP-005: Use on-chain ProviderRegistry.total_bandwidth_served as the
	// authoritative contribution weight; fall back to DB ContributedBandwidthGB.
	oracle := solana.GetOracleClient()
	capacities := make([]float64, len(members))
	var totalContribution float64
	for i, m := range members {
		var cap float64
		if oracle != nil {
			var u models.User
			db.DB.Select("wallet_address").First(&u, "id = ?", m.UserID)
			if u.WalletAddress != nil && *u.WalletAddress != "" {
				if pubkey, err := sol.PublicKeyFromBase58(*u.WalletAddress); err == nil {
					if reg, err := oracle.ReadProviderRegistry(context.Background(), pubkey); err == nil {
						cap = float64(reg.TotalBandwidthServed) / (1024 * 1024 * 1024)
					}
				}
			}
		}
		if cap == 0 {
			cap = m.ContributedBandwidthGB
		}
		capacities[i] = cap
		totalContribution += cap
	}

	// Distribute revenue proportionally
	for i, member := range members {
		share := 0.0
		if totalContribution > 0 {
			share = (capacities[i] / totalContribution) * quote.FinalPrice
		}

		revenue := models.CircleRevenue{
			CircleID:      quote.CircleID,
			ProviderID:    member.UserID,
			QuoteID:       &quote.ID,
			Amount:        share,
			RevenueType:   "enterprise_quote",
		}

		db.Social().Create(&revenue)
	}
}

func BroadcastToCircle(circleID string, msgType string, data interface{}) {
	// Get circle members
	var members []models.CircleMember
	db.Social().Where("circle_id = ?", circleID).Find(&members)

	// Broadcast to each member
	for _, member := range members {
		ws.BroadcastToUser(member.UserID.String(), msgType, data)
	}
}
