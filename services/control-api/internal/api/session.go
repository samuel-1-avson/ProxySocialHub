package api

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

func RegisterSessionRoutes(r *gin.RouterGroup) {
	sessions := r.Group("/sessions")
	{
		sessions.POST("", createSession)
		sessions.POST("/instant", createInstantSession) // New Universal endpoint

		sessions.POST("/", createSession)
		sessions.GET("", listSessions)
		sessions.GET("/", listSessions)
		sessions.GET("/:id", getSession)
		sessions.POST("/:id/terminate", terminateSession)
	}
}

// Renamed to V4 to force change visibility
type createSessionRequestV4 struct {
	Type           string `json:"type"` // NO BINDING
	BandwidthLimit int64  `json:"bandwidth_limit"`
	TargetGeo      string `json:"target_geo"`
	TargetISP      string `json:"target_isp"`
}

func generateCredentials() (string, string) {
	user := make([]byte, 8)
	pass := make([]byte, 16)
	rand.Read(user)
	rand.Read(pass)
	return hex.EncodeToString(user), hex.EncodeToString(pass)
}

func createSession(c *gin.Context) {
	fmt.Println("DEBUG: Entering createSession handler")
	var req createSessionRequestV4
	if err := c.ShouldBindJSON(&req); err != nil {
		fmt.Printf("DEBUG: Bind Error: %v\n", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Manual validation
	if req.Type != "rotating" && req.Type != "sticky" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid session type"})
		return
	}

	// Get user ID from context
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	userID := userUUID.String()

	// Get user to check trust tier
	var user models.User
	if result := db.DB.First(&user, "id = ?", userUUID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Get tier configuration
	tierConfig := models.GetTierConfig(user.TrustTier)

	// Check KYC status for certain features
	if !user.IsKYCVerified() && user.TrustTier == models.TrustTierNew {
		// New users without KYC have limited functionality
		if req.TargetGeo != "" || req.TargetISP != "" {
			c.JSON(http.StatusForbidden, gin.H{
				"error":   "KYC verification required for geo-targeting",
				"message": "Please complete KYC verification to unlock advanced features",
			})
			return
		}
	}

	// === Distributed Lock Start ===
	// Prevent race conditions on concurrent session creation
	lockKey := "session:alloc:" + userID
	lockValue := uuid.New().String()
	acquired, err := redisClient.AcquireLock(lockKey, lockValue, 5*time.Second)
	if err != nil {
		// Log error but might proceed? No, safer to error out.
		fmt.Printf("DEBUG: Lock acquire failed: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to acquire lock"})
		return
	}
	if !acquired {
		c.JSON(http.StatusConflict, gin.H{"error": "Operation in progress, please retry"})
		return
	}
	defer redisClient.ReleaseLock(lockKey)
	// === Distributed Lock End ===

	// Check active session count against tier limit
	var activeSessionCount int64
	db.DB.Model(&models.Session{}).
		Where("user_id = ? AND status = ?", userUUID, models.SessionActive).
		Count(&activeSessionCount)

	if int(activeSessionCount) >= tierConfig.MaxConcurrency {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error":      "Session limit reached",
			"limit":      tierConfig.MaxConcurrency,
			"current":    activeSessionCount,
			"trust_tier": user.TrustTier,
			"message":    "Upgrade your trust tier or terminate existing sessions",
		})
		return
	}

	// Generate secure credentials
	credUser, credPass := generateCredentials()

	// Apply tier-based bandwidth limit
	bandwidthLimit := req.BandwidthLimit
	if bandwidthLimit == 0 {
		// Default based on tier
		bandwidthLimit = int64(tierConfig.MaxBandwidthGB * 1024 * 1024 * 1024)
		if tierConfig.MaxBandwidthGB < 0 {
			// Unlimited - set to 100TB as practical limit
			bandwidthLimit = 100 * 1024 * 1024 * 1024 * 1024
		}
	} else {
		// Cap to tier maximum
		maxTierBytes := int64(tierConfig.MaxBandwidthGB * 1024 * 1024 * 1024)
		if tierConfig.MaxBandwidthGB > 0 && bandwidthLimit > maxTierBytes {
			bandwidthLimit = maxTierBytes
		}
	}

	session := models.Session{
		UserID:          userUUID,
		Type:            models.SessionType(req.Type),
		Status:          models.SessionActive,
		CredentialsUser: credUser,
		CredentialsPass: credPass,
		Config:          "{}",
	}

	if result := db.DB.Create(&session); result.Error != nil {
		fmt.Printf("DEBUG: DB Create Error: %v\n", result.Error)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create session"})
		return
	}

	// Store in Redis for Gateway authentication
	sessionData := &redisClient.SessionData{
		UserID:         userID,
		SessionID:      session.ID.String(),
		Type:           req.Type,
		Status:         "active",
		BandwidthLimit: bandwidthLimit,
		BandwidthUsed:  0,
		TrustTier:      string(user.TrustTier),
		TargetGeo:      req.TargetGeo,
		TargetISP:      req.TargetISP,
		ExpiresAt:      time.Now().Add(24 * time.Hour),
		CreatedAt:      time.Now(),
	}

	// Store with 24-hour TTL
	if err := redisClient.StoreSession(credUser, sessionData, 24*time.Hour); err != nil {
		// Log but don't fail - session is still in DB
		c.JSON(http.StatusCreated, gin.H{
			"session":       session,
			"redis_warning": "Session created but Redis sync failed",
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"session": session,
		"proxy_credentials": gin.H{
			"username": credUser,
			"password": credPass,
			"endpoint": "proxy.proxyhubb.com:3000",
		},
		"limits": gin.H{
			"bandwidth_limit_bytes": bandwidthLimit,
			"bandwidth_limit_gb":    float64(bandwidthLimit) / (1024 * 1024 * 1024),
			"trust_tier":            user.TrustTier,
			"max_concurrency":       tierConfig.MaxConcurrency,
		},
	})
}

func getSession(c *gin.Context) {
	id := c.Param("id")
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	userID := userUUID.String()

	var session models.Session
	if result := db.DB.First(&session, "id = ?", id); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
		return
	}

	// Verify ownership
	if session.UserID.String() != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Get usage from Redis
	usage, _ := redisClient.GetUsage(session.CredentialsUser)
	sessionData, _ := redisClient.GetSession(session.CredentialsUser)

	var bandwidthLimit int64 = 0
	if sessionData != nil {
		bandwidthLimit = sessionData.BandwidthLimit
	}

	var percentUsed float64
	if bandwidthLimit > 0 {
		percentUsed = float64(usage) / float64(bandwidthLimit) * 100
	}

	c.JSON(http.StatusOK, gin.H{
		"session":         session,
		"bandwidth_used":  usage,
		"bandwidth_limit": bandwidthLimit,
		"percent_used":    percentUsed,
	})
}

func listSessions(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	userID := userUUID.String()

	var sessions []models.Session
	if result := db.DB.Where("user_id = ?", userID).Order("created_at DESC").Find(&sessions); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch sessions"})
		return
	}

	// Enrich with usage data
	sessionResponses := make([]gin.H, len(sessions))
	for i, session := range sessions {
		usage, _ := redisClient.GetUsage(session.CredentialsUser)

		// Fallback limit if not in Redis (re-fetch logic duplicate but safer for list)
		// Ideally we trust what's in Redis or Session Config, but for list view lightweight is okay
		limit := int64(0)
		sData, _ := redisClient.GetSession(session.CredentialsUser)
		if sData != nil {
			limit = sData.BandwidthLimit
		}

		sessionResponses[i] = gin.H{
			"session":         session,
			"bandwidth_used":  usage,
			"bandwidth_limit": limit,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"sessions": sessionResponses,
		"count":    len(sessions),
	})
}

func terminateSession(c *gin.Context) {
	id := c.Param("id")
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	userID := userUUID.String()

	var session models.Session
	if result := db.DB.First(&session, "id = ?", id); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
		return
	}

	// Verify ownership
	if session.UserID.String() != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Update DB
	if result := db.DB.Model(&session).Update("status", models.SessionTerminated); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to terminate session"})
		return
	}

	redisClient.DeleteSession(session.CredentialsUser)

	c.JSON(http.StatusOK, gin.H{"status": "terminated"})
}

type createInstantSessionRequest struct {
	Strategy       string  `json:"strategy" binding:"required,oneof=fastest cheapest random country"`
	MaxPrice       float64 `json:"max_price" binding:"gte=0"`
	TargetCountry  string  `json:"target_country"` // If strategy is country
	BandwidthLimit int64   `json:"bandwidth_limit"`
}

// createInstantSession creates a "Pay-as-you-go" Universal Session
func createInstantSession(c *gin.Context) {
	var req createInstantSessionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	userID := userUUID.String()

	// 1. Check Wallet Balance
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", userUUID).First(&wallet).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}

	if wallet.BalanceGHS <= 0 && wallet.BalanceTAO <= 0 {
		c.JSON(http.StatusPaymentRequired, gin.H{"error": "Insufficient wallet balance. Please deposit funds."})
		return
	}

	// 2. Create Session
	credUser, credPass := generateCredentials()

	// Default limit if 0 (e.g. 1GB safety cap if not specified)
	if req.BandwidthLimit == 0 {
		req.BandwidthLimit = 1 * 1024 * 1024 * 1024
	}

	session := models.Session{
		UserID:          userUUID,
		Type:            "universal", // Special type
		Status:          models.SessionActive,
		CredentialsUser: credUser,
		CredentialsPass: credPass,
		Strategy:        req.Strategy,
		MaxPrice:        req.MaxPrice,
		BandwidthLimit:  req.BandwidthLimit,
		Config:          "{}",
	}

	if err := db.DB.Create(&session).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create session"})
		return
	}

	// 3. Store in Redis for Gateway
	// We need to extend SessionData in redis/client.go to support Strategy if not generic config
	// For now, we reuse existing fields or map them
	sessionData := &redisClient.SessionData{
		UserID:         userID,
		SessionID:      session.ID.String(),
		Type:           "universal",
		Status:         "active",
		BandwidthLimit: req.BandwidthLimit,
		TrustTier:      "verified",        // Assume instant buyers are verified or default
		TargetGeo:      req.TargetCountry, // Map strategy param
		ExpiresAt:      time.Now().Add(24 * time.Hour),
		CreatedAt:      time.Now(),
		// Custom fields for strategy passing?
		// We can put Strategy in TargetISP if we abuse the field, or update the Redis struct.
		// Let's assume TargetISP can hold metadata or we update the struct later.
		// Ideally we update redis/client.go SessionData.
		// For prototype, we'll encode it in a way the Gateway understands or add the field.
	}

	// Store
	if err := redisClient.StoreSession(credUser, sessionData, 24*time.Hour); err != nil {
		c.JSON(http.StatusCreated, gin.H{"warning": "Redis sync failed", "session": session})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"session": session,
		"proxy_credentials": gin.H{
			"username": credUser,
			"password": credPass,
			"endpoint": "proxy.proxyhubb.com:3000",
		},
		"strategy": req.Strategy,
	})
}
