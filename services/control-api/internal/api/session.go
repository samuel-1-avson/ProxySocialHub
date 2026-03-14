package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	solanaGo "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/solana"
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
		sessions.GET("/:id/", getSession)
		sessions.POST("/:id/terminate", terminateSession)
		sessions.POST("/:id/terminate/", terminateSession)
		sessions.DELETE("/:id", terminateSession)
		sessions.DELETE("/:id/", terminateSession)
	}
}

// Renamed to V4 to force change visibility
type createSessionRequestV4 struct {
	Type           string `json:"type"` // NO BINDING
	BandwidthLimit int64  `json:"bandwidth_limit"`
	TargetGeo      string `json:"target_geo"`
	TargetISP      string `json:"target_isp"`

	// N-03: Optional routing profile slug (e.g. "web-scraping", "gaming")
	RoutingProfile string `json:"routing_profile"`

	// N-02: Optional per-session access control overrides
	AllowedDomains          []string `json:"allowed_domains"`
	BlockedDomains          []string `json:"blocked_domains"`
	RotationType            string   `json:"rotation_type"`             // "none" | "per-request" | "time-based"
	RotationIntervalSeconds int      `json:"rotation_interval_seconds"` // 0 → profile/tier default
	TimeLimitMinutes        int      `json:"time_limit_minutes"`        // 0 = unlimited
}

func generateCredentials() (string, string) {
	user := make([]byte, 8)
	pass := make([]byte, 16)
	rand.Read(user)
	rand.Read(pass)
	return hex.EncodeToString(user), hex.EncodeToString(pass)
}

func createSession(c *gin.Context) {
	var req createSessionRequestV4
	if err := c.ShouldBindJSON(&req); err != nil {
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

	// N-03: Look up routing profile and apply defaults if slug provided.
	var routingProfile *models.RoutingProfile
	if req.RoutingProfile != "" {
		var rp models.RoutingProfile
		if err := db.DB.Where("slug = ? AND is_active = true", req.RoutingProfile).First(&rp).Error; err == nil {
			routingProfile = &rp
			// Apply profile defaults only when request didn't override them.
			if req.RotationType == "" {
				if rp.AutoRotation {
					req.RotationType = "time-based"
				} else {
					req.RotationType = "none"
				}
			}
			if req.RotationIntervalSeconds == 0 {
				req.RotationIntervalSeconds = rp.RotationInterval
			}
		} else {
			logging.Warn().Str("slug", req.RoutingProfile).Msg("Routing profile not found — ignoring")
		}
	}
	_ = routingProfile // may be used for future provider matching weight hints

	// === Distributed Lock Start ===
	// Prevent race conditions on concurrent session creation
	lockKey := "session:alloc:" + userID
	lockValue := uuid.New().String()
	acquired, err := redisClient.AcquireLock(lockKey, lockValue, 5*time.Second)
	if err != nil {
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create session"})
		return
	}

	// N-05: Store encrypted credential backup (non-fatal if it fails).
	credSvc := crypto.NewCredentialService()
	if err := credSvc.StoreCredentials(session.ID, credUser, credPass); err != nil {
		logging.Error(err).Str("session_id", session.ID.String()).Msg("Failed to store encrypted credentials — continuing")
	}

	// N-02: Persist per-session configuration record.
	rotationType := req.RotationType
	if rotationType == "" {
		rotationType = "none"
	}
	rotationInterval := req.RotationIntervalSeconds
	if rotationInterval == 0 {
		rotationInterval = 60
	}
	sessionCfg := models.SessionConfiguration{
		SessionID:        session.ID,
		UserID:           userUUID,
		AllowedDomains:   req.AllowedDomains,
		BlockedDomains:   req.BlockedDomains,
		RotationType:     rotationType,
		RotationInterval: rotationInterval,
		TimeLimitMinutes: req.TimeLimitMinutes,
	}
	if err := db.DB.Create(&sessionCfg).Error; err != nil {
		logging.Error(err).Str("session_id", session.ID.String()).Msg("Failed to persist session configuration — continuing")
	}

	// Store in Redis for Gateway authentication (N-02: include session config fields)
	sessionData := &redisClient.SessionData{
		UserID:                  userID,
		SessionID:               session.ID.String(),
		Type:                    req.Type,
		Status:                  "active",
		BandwidthLimit:          bandwidthLimit,
		BandwidthUsed:           0,
		TrustTier:               string(user.TrustTier),
		TargetGeo:               req.TargetGeo,
		TargetISP:               req.TargetISP,
		ExpiresAt:               time.Now().Add(24 * time.Hour),
		CreatedAt:               time.Now(),
		AllowedDomains:          req.AllowedDomains,
		BlockedDomains:          req.BlockedDomains,
		RotationType:            rotationType,
		RotationIntervalSeconds: rotationInterval,
		TimeLimitMinutes:        req.TimeLimitMinutes,
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

	// N-06: Filter by status. Default = active only; pass ?status=all for full history.
	query := db.DB.Where("user_id = ?", userID).Order("created_at DESC")
	if c.Query("status") != "all" {
		query = query.Where("status = ?", models.SessionActive)
	}

	var sessions []models.Session
	if result := query.Find(&sessions); result.Error != nil {
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

	// Trigger on-chain escrow settlement asynchronously so the API response is not blocked.
	go settleSessionOnChain(session)

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

	if wallet.BalanceSOL <= 0 {
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

// settleSessionOnChain calls the on-chain SettleEscrow instruction after a session ends.
// It runs in a goroutine — errors are logged but never bubble up to the HTTP handler.
func settleSessionOnChain(session models.Session) {
	ctx := context.Background()

	oracle := solana.GetOracleClient()
	if oracle == nil {
		logging.Warn().Str("session_id", session.ID.String()).Msg("SettleEscrow skipped: oracle client not initialized")
		return
	}

	// Load the session with its listing to get seller info
	var fullSession models.Session
	if err := db.DB.Preload("Listing").First(&fullSession, "id = ?", session.ID).Error; err != nil {
		logging.Error(err).Str("session_id", session.ID.String()).Msg("SettleEscrow: failed to load session")
		return
	}

	if fullSession.Listing == nil {
		logging.Warn().Str("session_id", session.ID.String()).Msg("SettleEscrow skipped: no listing attached")
		return
	}

	// Look up buyer's linked Solana wallet
	var buyer models.User
	if err := db.DB.Select("wallet_address").Where("id = ?", fullSession.UserID).First(&buyer).Error; err != nil || buyer.WalletAddress == nil {
		logging.Warn().Str("session_id", session.ID.String()).Msg("SettleEscrow skipped: buyer has no linked wallet")
		return
	}

	// Look up seller's linked Solana wallet
	var seller models.User
	if err := db.DB.Select("wallet_address").Where("id = ?", fullSession.Listing.SellerID).First(&seller).Error; err != nil || seller.WalletAddress == nil {
		logging.Warn().Str("session_id", session.ID.String()).Msg("SettleEscrow skipped: seller has no linked wallet")
		return
	}

	buyerPubkey, err := solanaGo.PublicKeyFromBase58(*buyer.WalletAddress)
	if err != nil {
		logging.Error(err).Str("session_id", session.ID.String()).Msg("SettleEscrow: invalid buyer pubkey")
		return
	}
	sellerPubkey, err := solanaGo.PublicKeyFromBase58(*seller.WalletAddress)
	if err != nil {
		logging.Error(err).Str("session_id", session.ID.String()).Msg("SettleEscrow: invalid seller pubkey")
		return
	}

	escrowPDA, _, err := oracle.GetEscrowPDA(buyerPubkey, sellerPubkey)
	if err != nil {
		logging.Error(err).Str("session_id", session.ID.String()).Msg("SettleEscrow: failed to derive PDA")
		return
	}

	bandwidthUsedGB := uint64(fullSession.BytesUsed) / (1024 * 1024 * 1024)

	txHash, err := oracle.SettleEscrow(ctx, solana.SettleEscrowParams{
		Buyer:           buyerPubkey,
		Seller:          sellerPubkey,
		EscrowPDA:       escrowPDA,
		BandwidthUsedGB: bandwidthUsedGB,
	})
	if err != nil {
		logging.Error(err).Str("session_id", session.ID.String()).Msg("SettleEscrow: on-chain transaction failed")
		return
	}

	// Store the settlement tx hash on the session for audit
	db.DB.Model(&models.Session{}).Where("id = ?", session.ID).Update("tx_hash", txHash)

	logging.Info().
		Str("session_id", session.ID.String()).
		Str("tx_hash", txHash).
		Uint64("bandwidth_gb", bandwidthUsedGB).
		Msg("SettleEscrow completed on-chain")
}
