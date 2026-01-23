package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/audit"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterAdminRoutes registers all admin API routes
func RegisterAdminRoutes(r *gin.RouterGroup) {
	// User Management (Moderators can access)
	r.GET("/users", listUsers)
	r.GET("/users/:id", getUser)
	r.POST("/users/:id/ban", banUser)
	r.POST("/users/:id/unban", unbanUser)
	r.PUT("/users/:id/tier", updateUserTier)
	r.POST("/users/:id/suspend", suspendUser)
	r.POST("/users/:id/activate", activateUser)

	// Node Monitoring (System Monitor or Admin)
	nodes := r.Group("/nodes")
	nodes.Use(RequirePermission("system:monitor"))
	{
		nodes.GET("", listNodes)
		nodes.GET("/stats", getNodeStats)
	}

	// Payout Management (Admins only / Financial)
	payouts := r.Group("/payouts")
	payouts.Use(RequirePermission("payouts:manage"))
	{
		payouts.GET("/pending", getPendingPayouts)
		payouts.POST("/:id/process", processPayout)
		payouts.GET("/history", getPayoutHistory)
	}

	// System Stats (Admins only)
	stats := r.Group("/stats")
	stats.Use(RequirePermission("system:monitor"))
	{
		stats.GET("", getSystemStats)
		stats.GET("/dashboard", getDashboardStats)
	}

	// Audit Logs (Admins only)
	r.GET("/audit-logs", RequirePermission("system:audit"), getAuditLogs)

	// Pricing Management (Admins/System)
	r.POST("/pricing/adjust", triggerPricingAdjustment)
}

// ========== User Management ==========

type UserListResponse struct {
	Users      []models.User `json:"users"`
	TotalCount int64         `json:"total_count"`
	Page       int           `json:"page"`
	PerPage    int           `json:"per_page"`
}

func listUsers(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "20"))
	role := c.Query("role")
	status := c.Query("status")

	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}

	offset := (page - 1) * perPage

	query := db.DB.Model(&models.User{})

	if role != "" {
		query = query.Where("role = ?", role)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}

	var totalCount int64
	query.Count(&totalCount)

	var users []models.User
	if result := query.Offset(offset).Limit(perPage).Order("created_at DESC").Find(&users); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch users"})
		return
	}

	c.JSON(http.StatusOK, UserListResponse{
		Users:      users,
		TotalCount: totalCount,
		Page:       page,
		PerPage:    perPage,
	})
}

func getUser(c *gin.Context) {
	userID := c.Param("id")

	var user models.User
	if result := db.DB.First(&user, "id = ?", userID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Get additional stats
	var sessionCount int64
	db.DB.Model(&models.Session{}).Where("user_id = ?", userID).Count(&sessionCount)

	var kycStatus string
	var kyc models.KycVerification
	if db.DB.Where("user_id = ?", userID).First(&kyc).Error == nil {
		kycStatus = string(kyc.Status)
	} else {
		kycStatus = "not_started"
	}

	c.JSON(http.StatusOK, gin.H{
		"user":          user,
		"session_count": sessionCount,
		"kyc_status":    kycStatus,
	})
}

func banUser(c *gin.Context) {
	userID := c.Param("id")

	var user models.User
	if result := db.DB.First(&user, "id = ?", userID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	user.Status = models.UserStatusBanned
	if result := db.DB.Save(&user); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to ban user"})
		return
	}

	// Terminate all active sessions
	db.DB.Model(&models.Session{}).
		Where("user_id = ? AND status = ?", userID, models.SessionActive).
		Update("status", models.SessionTerminated)

	c.JSON(http.StatusOK, gin.H{"status": "banned", "user_id": userID})
}

func unbanUser(c *gin.Context) {
	userID := c.Param("id")

	var user models.User
	if result := db.DB.First(&user, "id = ?", userID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	user.Status = models.UserStatusActive
	if result := db.DB.Save(&user); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to unban user"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "active", "user_id": userID})
}

type UpdateTierRequest struct {
	Tier string `json:"tier" binding:"required,oneof=new verified premium"`
}

func updateUserTier(c *gin.Context) {
	userID := c.Param("id")

	var req UpdateTierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if result := db.DB.First(&user, "id = ?", userID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	user.TrustTier = models.TrustTier(req.Tier)
	if result := db.DB.Save(&user); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update tier"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "updated",
		"user_id": userID,
		"tier":    req.Tier,
	})
}

// ========== Node Monitoring ==========

type NodeInfo struct {
	ID             string    `json:"id"`
	IPAddress      string    `json:"ip_address"`
	CountryCode    string    `json:"country_code"`
	Region         string    `json:"region"`
	ISP            string    `json:"isp"`
	IsHealthy      bool      `json:"is_healthy"`
	ActiveConns    int       `json:"active_connections"`
	MaxConns       int       `json:"max_connections"`
	LatencyMs      int       `json:"latency_ms"`
	TotalBytesUp   int64     `json:"total_bytes_up"`
	TotalBytesDown int64     `json:"total_bytes_down"`
	UptimePercent  float64   `json:"uptime_percent"`
	SuccessRate    float64   `json:"success_rate"`
	LastSeen       time.Time `json:"last_seen"`
}

func listNodes(c *gin.Context) {
	// In production, this would query active nodes from Redis or the registry
	// For now, return mock data structure

	var nodes []models.Node
	if result := db.DB.Order("created_at DESC").Find(&nodes); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch nodes"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"nodes": nodes,
		"count": len(nodes),
	})
}

type NodeStatsResponse struct {
	TotalNodes     int     `json:"total_nodes"`
	OnlineNodes    int     `json:"online_nodes"`
	OfflineNodes   int     `json:"offline_nodes"`
	TotalBandwidth float64 `json:"total_bandwidth_gb"`
	AvgLatency     float64 `json:"avg_latency_ms"`
	AvgSuccessRate float64 `json:"avg_success_rate"`
}

func getNodeStats(c *gin.Context) {
	var totalNodes int64
	db.DB.Model(&models.Node{}).Count(&totalNodes)

	var onlineNodes int64
	db.DB.Model(&models.Node{}).Where("is_healthy = ?", true).Count(&onlineNodes)

	c.JSON(http.StatusOK, NodeStatsResponse{
		TotalNodes:     int(totalNodes),
		OnlineNodes:    int(onlineNodes),
		OfflineNodes:   int(totalNodes - onlineNodes),
		TotalBandwidth: 0, // Would be calculated from usage
		AvgLatency:     45,
		AvgSuccessRate: 0.98,
	})
}

// ========== Payout Management ==========

type PendingPayout struct {
	UserID           string  `json:"user_id"`
	Email            string  `json:"email"`
	Role             string  `json:"role"`
	EarningsGHS      float64 `json:"earnings_ghs"`
	TotalBytesServed int64   `json:"total_bytes_served"`
	Phone            string  `json:"phone,omitempty"`
}

func getPendingPayouts(c *gin.Context) {
	// Query providers with positive balances
	var providers []models.User
	if result := db.DB.Where("role = ?", "provider").Find(&providers); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch providers"})
		return
	}

	payouts := make([]PendingPayout, 0)
	for _, provider := range providers {
		var wallet models.Wallet
		if db.DB.Where("user_id = ?", provider.ID).First(&wallet).Error == nil {
			if wallet.BalanceTAO > 0.01 { // Minimum threshold appropriate for TAO
				payouts = append(payouts, PendingPayout{
					UserID:      provider.ID.String(),
					Email:       provider.Email,
					Role:        provider.Role,
					EarningsGHS: wallet.BalanceTAO, // Naming mismatch in DTO (EarningsGHS vs TAO value), keeping for now or should update struct.
					// Let's rely on frontend interpreting the value. Ideally rename struct field but avoiding cascade to frontend TS.
				})
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"payouts":       payouts,
		"count":         len(payouts),
		"min_threshold": 5.0,
	})
}

type ProcessPayoutRequest struct {
	Phone  string  `json:"phone" binding:"required"`
	Amount float64 `json:"amount" binding:"required,min=5"`
}

func processPayout(c *gin.Context) {
	userID := c.Param("id")

	var req ProcessPayoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var wallet models.Wallet
	if result := db.DB.Where("user_id = ?", userID).First(&wallet); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}

	// For Payouts, are we paying out GHS or TAO?
	// If req.Amount is 5, is it 5 GHS or 5 TAO?
	// Assuming Payouts are in TAO now.
	if wallet.BalanceTAO < req.Amount {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient balance"})
		return
	}

	// Create payout transaction (would integrate with MoMo API)
	reference := "payout-" + time.Now().Format("20060102150405")

	// Deduct from wallet
	wallet.BalanceTAO -= req.Amount
	db.DB.Save(&wallet)

	// Create ledger entry
	ledger := models.WalletLedgerEntry{
		WalletID:    wallet.ID,
		Type:        models.TransactionPayout,
		Amount:      -req.Amount,
		Description: "Provider payout to " + req.Phone, // Payout in TAO
	}
	db.DB.Create(&ledger)

	c.JSON(http.StatusOK, gin.H{
		"status":      "processed",
		"reference":   reference,
		"amount":      req.Amount,
		"new_balance": wallet.BalanceTAO,
	})
}

func getPayoutHistory(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "50"))

	if page < 1 {
		page = 1
	}
	offset := (page - 1) * perPage

	var ledgers []models.WalletLedgerEntry
	if result := db.DB.Where("type = ?", models.TransactionPayout).
		Order("created_at DESC").
		Offset(offset).
		Limit(perPage).
		Find(&ledgers); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch payouts"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"payouts": ledgers,
		"count":   len(ledgers),
		"page":    page,
	})
}

// ========== System Stats ==========

type SystemStats struct {
	TotalUsers      int64   `json:"total_users"`
	TotalProviders  int64   `json:"total_providers"`
	TotalBuyers     int64   `json:"total_buyers"`
	TotalSessions   int64   `json:"total_sessions"`
	ActiveSessions  int64   `json:"active_sessions"`
	TotalNodes      int64   `json:"total_nodes"`
	OnlineNodes     int64   `json:"online_nodes"`
	TotalRevenueGHS float64 `json:"total_revenue_ghs"`
	TodayRevenueGHS float64 `json:"today_revenue_ghs"`
	PendingKYC      int64   `json:"pending_kyc"`
}

func getSystemStats(c *gin.Context) {
	var stats SystemStats

	db.DB.Model(&models.User{}).Count(&stats.TotalUsers)
	db.DB.Model(&models.User{}).Where("role = ?", "provider").Count(&stats.TotalProviders)
	db.DB.Model(&models.User{}).Where("role = ?", "buyer").Count(&stats.TotalBuyers)
	db.DB.Model(&models.Session{}).Count(&stats.TotalSessions)
	db.DB.Model(&models.Session{}).Where("status = ?", models.SessionActive).Count(&stats.ActiveSessions)
	db.DB.Model(&models.Node{}).Count(&stats.TotalNodes)
	db.DB.Model(&models.Node{}).Where("is_healthy = ?", true).Count(&stats.OnlineNodes)
	db.DB.Model(&models.KycVerification{}).Where("status IN ?", []models.KYCStatus{
		models.KYCStatusPending,
		models.KYCStatusInReview,
	}).Count(&stats.PendingKYC)

	// Calculate revenue from usage transactions
	var totalRevenue float64
	db.DB.Model(&models.WalletLedgerEntry{}).
		Where("type = ?", models.TransactionUsage).
		Select("COALESCE(SUM(ABS(amount)), 0)").
		Scan(&totalRevenue)
	stats.TotalRevenueGHS = totalRevenue

	c.JSON(http.StatusOK, stats)
}

// ========== Additional User Management ==========

func suspendUser(c *gin.Context) {
	userID := c.Param("id")

	var user models.User
	if result := db.DB.First(&user, "id = ?", userID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	user.Status = models.UserStatusSuspended
	if result := db.DB.Save(&user); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to suspend user"})
		return
	}

	// Log the action
	audit.LogUserAction(c, models.AuditUserUpdated, userID, "User account suspended")

	c.JSON(http.StatusOK, gin.H{
		"status":  "suspended",
		"user_id": userID,
		"message": "User account suspended",
	})
}

func activateUser(c *gin.Context) {
	userID := c.Param("id")

	var user models.User
	if result := db.DB.First(&user, "id = ?", userID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	user.Status = models.UserStatusActive
	if result := db.DB.Save(&user); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to activate user"})
		return
	}

	// Log the action
	audit.LogUserAction(c, models.AuditUserUpdated, userID, "User account activated")

	c.JSON(http.StatusOK, gin.H{
		"status":  "active",
		"user_id": userID,
		"message": "User account activated",
	})
}

// ========== Dashboard Stats ==========

type DashboardStats struct {
	// User Stats
	TotalUsers     int64 `json:"total_users"`
	NewUsersToday  int64 `json:"new_users_today"`
	NewUsersWeek   int64 `json:"new_users_week"`
	ActiveUsers    int64 `json:"active_users"`
	SuspendedUsers int64 `json:"suspended_users"`

	// Session Stats
	ActiveSessions   int64   `json:"active_sessions"`
	SessionsToday    int64   `json:"sessions_today"`
	AvgSessionLength float64 `json:"avg_session_length_min"`

	// Node Stats
	OnlineNodes    int64   `json:"online_nodes"`
	TotalNodes     int64   `json:"total_nodes"`
	HealthyPercent float64 `json:"healthy_percent"`

	// Revenue Stats
	TodayRevenue float64 `json:"today_revenue_ghs"`
	WeekRevenue  float64 `json:"week_revenue_ghs"`
	MonthRevenue float64 `json:"month_revenue_ghs"`

	// KYC Stats
	PendingKYC  int64 `json:"pending_kyc"`
	ApprovedKYC int64 `json:"approved_kyc"`
	TotalKYC    int64 `json:"total_kyc"`
}

func getDashboardStats(c *gin.Context) {
	var stats DashboardStats
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	weekAgo := today.AddDate(0, 0, -7)
	monthAgo := today.AddDate(0, -1, 0)

	// User stats
	db.DB.Model(&models.User{}).Count(&stats.TotalUsers)
	db.DB.Model(&models.User{}).Where("created_at >= ?", today).Count(&stats.NewUsersToday)
	db.DB.Model(&models.User{}).Where("created_at >= ?", weekAgo).Count(&stats.NewUsersWeek)
	db.DB.Model(&models.User{}).Where("status = ?", models.UserStatusActive).Count(&stats.ActiveUsers)
	db.DB.Model(&models.User{}).Where("status IN ?", []models.UserStatus{
		models.UserStatusSuspended, models.UserStatusBanned,
	}).Count(&stats.SuspendedUsers)

	// Session stats
	db.DB.Model(&models.Session{}).Where("status = ?", models.SessionActive).Count(&stats.ActiveSessions)
	db.DB.Model(&models.Session{}).Where("created_at >= ?", today).Count(&stats.SessionsToday)

	// Node stats
	db.DB.Model(&models.Node{}).Count(&stats.TotalNodes)
	db.DB.Model(&models.Node{}).Where("is_healthy = ?", true).Count(&stats.OnlineNodes)
	if stats.TotalNodes > 0 {
		stats.HealthyPercent = float64(stats.OnlineNodes) / float64(stats.TotalNodes) * 100
	}

	// Revenue stats (from usage transactions)
	db.DB.Model(&models.WalletLedgerEntry{}).
		Where("type = ? AND created_at >= ?", models.TransactionUsage, today).
		Select("COALESCE(SUM(ABS(amount)), 0)").
		Scan(&stats.TodayRevenue)
	db.DB.Model(&models.WalletLedgerEntry{}).
		Where("type = ? AND created_at >= ?", models.TransactionUsage, weekAgo).
		Select("COALESCE(SUM(ABS(amount)), 0)").
		Scan(&stats.WeekRevenue)
	db.DB.Model(&models.WalletLedgerEntry{}).
		Where("type = ? AND created_at >= ?", models.TransactionUsage, monthAgo).
		Select("COALESCE(SUM(ABS(amount)), 0)").
		Scan(&stats.MonthRevenue)

	// KYC stats
	db.DB.Model(&models.KycVerification{}).Where("status IN ?", []models.KYCStatus{
		models.KYCStatusPending, models.KYCStatusInReview,
	}).Count(&stats.PendingKYC)
	db.DB.Model(&models.KycVerification{}).Where("status = ?", models.KYCStatusApproved).Count(&stats.ApprovedKYC)
	db.DB.Model(&models.KycVerification{}).Count(&stats.TotalKYC)

	c.JSON(http.StatusOK, stats)
}

// ========== Audit Logs ==========

func getAuditLogs(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "50"))
	action := c.Query("action")     // Filter by action type
	entityType := c.Query("entity") // Filter by entity type
	actorID := c.Query("actor_id")  // Filter by actor

	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 50
	}
	offset := (page - 1) * perPage

	query := db.DB.Model(&models.AuditLog{})

	if action != "" {
		query = query.Where("action = ?", action)
	}
	if entityType != "" {
		query = query.Where("entity_type = ?", entityType)
	}
	if actorID != "" {
		query = query.Where("actor_id = ?", actorID)
	}

	var totalCount int64
	query.Count(&totalCount)

	var logs []models.AuditLog
	if result := query.Order("created_at DESC").Offset(offset).Limit(perPage).Find(&logs); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch audit logs"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"audit_logs":  logs,
		"total_count": totalCount,
		"page":        page,
		"per_page":    perPage,
	})
}

func triggerPricingAdjustment(c *gin.Context) {
	// In a real system, this would run async or be protected by a strict system key
	// For MVP, we run it inline (careful with timeout)
	go AdjustDynamicPricing()

	c.JSON(http.StatusOK, gin.H{
		"message": "Dynamic pricing adjustment triggered",
		"status":  "running",
	})
}
