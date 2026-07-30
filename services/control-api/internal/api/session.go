package api

import (
	"context"
	cryptoRand "crypto/rand"
	"encoding/hex"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"

	solanaGo "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/sessionintent"
	"github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
)

func RegisterSessionRoutes(r *gin.RouterGroup) {
	sessions := r.Group("/sessions")
	{
		sessions.POST("", createSession)
		sessions.POST("/", createSession)
		sessions.GET("/intents", listSessionIntents)
		sessions.GET("/intents/", listSessionIntents)
		sessions.GET("/intents/:id", getSessionIntent)
		sessions.GET("/intents/:id/", getSessionIntent)
		sessions.POST("/intent", createSessionIntent)
		sessions.POST("/intent/", createSessionIntent)
		sessions.POST("/instant", createInstantSession)
		sessions.POST("/from-listing", createSessionFromListing) // P2P: buy from a specific provider listing

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
	PreferredTier           string   `json:"preferred_tier"`            // "Gold", "Silver", "Bronze"
}

type createSessionIntentRequest struct {
	createSessionRequestV4
	ListingID     string  `json:"listing_id,omitempty"`
	MaxPricePerGB float64 `json:"max_price_per_gb,omitempty"`
}

func generateCredentials() (string, string) {
	user := make([]byte, 8)
	pass := make([]byte, 16)
	cryptoRand.Read(user)
	cryptoRand.Read(pass)
	return hex.EncodeToString(user), hex.EncodeToString(pass)
}

func legacyDirectSessionCreationEnabled() bool {
	if !isTruthyEnv(os.Getenv("PROXYHUB_ALLOW_LEGACY_DIRECT_SESSIONS")) {
		return false
	}

	appEnv := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	ginMode := strings.ToLower(strings.TrimSpace(os.Getenv("GIN_MODE")))
	if appEnv == "production" || appEnv == "prod" || appEnv == "staging" || ginMode == "release" {
		return isTruthyEnv(os.Getenv("PROXYHUB_ALLOW_LEGACY_DIRECT_SESSIONS_IN_PROD"))
	}
	return true
}

func blockDeprecatedDirectSessionCreation(c *gin.Context, flow string) bool {
	if legacyDirectSessionCreationEnabled() {
		return false
	}

	c.Header("Deprecation", "true")
	c.JSON(http.StatusGone, gin.H{
		"error":       "Direct legacy session creation is deprecated",
		"deprecated":  true,
		"flow":        flow,
		"replacement": "Create a marketplace order, confirm Solana escrow payment, then fetch credentials from /v1/orders/:id/credentials.",
		"intent_path": "/v1/sessions/intent",
		"order_path":  "/v1/orders",
	})
	return true
}

// selectProviderNode picks the best available healthy provider node,
// preferring the requested country and using weighted-random selection by quality score.
func selectProviderNode(targetGeo string, connectionType string) (*models.ProviderNode, error) {
	query := db.DB.Where("status = ? AND deleted_at IS NULL", models.NodeOnline)
	if connectionType != "" {
		query = query.Where("connection_type = ?", connectionType)
	}

	// Try country-matched nodes first
	if targetGeo != "" {
		var geoNodes []models.ProviderNode
		query.Where("country = ?", targetGeo).
			Order("quality_score DESC").
			Limit(10).
			Find(&geoNodes)
		if len(geoNodes) > 0 {
			return weightedRandomNode(geoNodes), nil
		}
	}

	// Fallback: best quality globally
	var nodes []models.ProviderNode
	query.Order("quality_score DESC").Limit(10).Find(&nodes)
	if len(nodes) == 0 {
		return nil, fmt.Errorf("no healthy provider nodes available")
	}
	return weightedRandomNode(nodes), nil
}

// weightedRandomNode selects a node probabilistically, weighted by quality score.
// Higher quality nodes are more likely to be chosen, preventing monopoly by a single top node.
func weightedRandomNode(nodes []models.ProviderNode) *models.ProviderNode {
	if len(nodes) == 1 {
		return &nodes[0]
	}
	total := 0.0
	for _, n := range nodes {
		total += n.QualityScore
	}
	if total <= 0 {
		return &nodes[0]
	}
	pick := rand.Float64() * total
	cumulative := 0.0
	for i, n := range nodes {
		cumulative += n.QualityScore
		if pick <= cumulative {
			return &nodes[i]
		}
	}
	return &nodes[len(nodes)-1]
}

func createSessionIntent(c *gin.Context) {
	var req createSessionIntentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Type != "rotating" && req.Type != "sticky" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid session type"})
		return
	}
	if req.MaxPricePerGB < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "max_price_per_gb must be >= 0"})
		return
	}

	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var user models.User
	if result := db.DB.First(&user, "id = ?", userUUID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	resolvedTier := resolveUserTrustTier(c.Request.Context(), userUUID.String(), user)
	tierConfig := models.GetTierConfig(resolvedTier)
	applyRoutingProfileDefaults(&req.createSessionRequestV4)

	activeSessionCount := countActiveSessions(userUUID)
	if int(activeSessionCount) >= tierConfig.MaxConcurrency {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error":      "Session limit reached",
			"limit":      tierConfig.MaxConcurrency,
			"current":    activeSessionCount,
			"trust_tier": resolvedTier,
		})
		return
	}

	listingID := ""
	if trimmedListingID := strings.TrimSpace(req.ListingID); trimmedListingID != "" {
		listingUUID, err := uuid.Parse(trimmedListingID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing_id"})
			return
		}

		var listing models.ProxyListing
		if err := db.DB.Where("id = ? AND status = ?", listingUUID, models.ListingStatusActive).First(&listing).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Listing is not available"})
			return
		}

		listingID = listing.ID.String()
		if req.TargetGeo == "" {
			req.TargetGeo = listing.Country
		}
		if req.TargetISP == "" {
			req.TargetISP = listing.ISP
		}
		if req.MaxPricePerGB == 0 {
			req.MaxPricePerGB = listing.PricePerGB
		}
		if req.PreferredTier == "" {
			req.PreferredTier = listing.CurrentTier
		}
	}

	bandwidthLimit := computeBandwidthLimitForUser(userUUID, req.BandwidthLimit, tierConfig)
	rotationType, rotationInterval := normalizedRotationSettings(req.createSessionRequestV4)

	secret, err := sessionintent.ResolveSigningSecret()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Session intent signing is not configured"})
		return
	}

	tokenString, claims, err := sessionintent.Issue(secret, sessionintent.Params{
		UserID:                  userUUID,
		ListingID:               listingID,
		SessionType:             req.Type,
		TrustTier:               string(resolvedTier),
		BandwidthLimit:          bandwidthLimit,
		TargetGeo:               req.TargetGeo,
		TargetISP:               req.TargetISP,
		RoutingProfile:          req.RoutingProfile,
		AllowedDomains:          req.AllowedDomains,
		BlockedDomains:          req.BlockedDomains,
		RotationType:            rotationType,
		RotationIntervalSeconds: rotationInterval,
		TimeLimitMinutes:        req.TimeLimitMinutes,
		PreferredTier:           req.PreferredTier,
		RequestsPerMinute:       tierConfig.RequestsPerMinute,
		MaxConcurrency:          tierConfig.MaxConcurrency,
		MaxPricePerGB:           req.MaxPricePerGB,
	})
	if err != nil {
		logging.Error(err).Str("user_id", userUUID.String()).Msg("Failed to issue session intent")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to issue session intent"})
		return
	}

	if _, err := persistIssuedSessionIntent(userUUID, claims); err != nil {
		logging.Error(err).Str("user_id", userUUID.String()).Msg("Failed to persist session intent")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to persist session intent"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":           tokenString,
		"expires_at":      claims.ExpiresAt.Time,
		"lifecycle_state": string(models.SessionIntentAuthorized),
		"intent": gin.H{
			"intent_id":                 claims.ID,
			"user_id":                   claims.UserID,
			"listing_id":                claims.ListingID,
			"session_type":              claims.SessionType,
			"trust_tier":                claims.TrustTier,
			"bandwidth_limit":           claims.BandwidthLimit,
			"target_geo":                claims.TargetGeo,
			"target_isp":                claims.TargetISP,
			"routing_profile":           claims.RoutingProfile,
			"allowed_domains":           claims.AllowedDomains,
			"blocked_domains":           claims.BlockedDomains,
			"rotation_type":             claims.RotationType,
			"rotation_interval_seconds": claims.RotationIntervalSeconds,
			"time_limit_minutes":        claims.TimeLimitMinutes,
			"preferred_tier":            claims.PreferredTier,
			"requests_per_minute":       claims.RequestsPerMinute,
			"max_concurrency":           claims.MaxConcurrency,
			"max_price_per_gb":          claims.MaxPricePerGB,
		},
	})
}

func createSession(c *gin.Context) {
	if blockDeprecatedDirectSessionCreation(c, "direct_session") {
		return
	}

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

	resolvedTier := resolveUserTrustTier(c.Request.Context(), userID, user)
	// Get tier configuration
	tierConfig := models.GetTierConfig(resolvedTier)

	applyRoutingProfileDefaults(&req)

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
	activeSessionCount := countActiveSessions(userUUID)

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

	// Apply tier + plan bandwidth limit
	bandwidthLimit := computeBandwidthLimitForUser(userUUID, req.BandwidthLimit, tierConfig)
	if bandwidthLimit == 0 {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "Plan bandwidth quota exhausted. Upgrade your subscription or wait for the next billing period.",
			"code":  "plan_bandwidth_quota",
		})
		return
	}

	// Pick the best available canonical provider node. Runtime fields are now
	// carried on provider_nodes; nodes remains only a compatibility mirror.
	var node models.ProviderNode
	nodeQuery := db.DB.Where("is_healthy = true AND active_connections < max_connections AND deleted_at IS NULL")
	if req.TargetGeo != "" {
		nodeQuery = nodeQuery.Where("country = ?", req.TargetGeo)
	}
	if req.PreferredTier != "" {
		nodeQuery = nodeQuery.Where("tier = ?", req.PreferredTier)
	}
	if err := nodeQuery.Order("quality_score DESC").First(&node).Error; err != nil {
		// Retry without geo/tier filter if requested but none match.
		if req.TargetGeo != "" || req.PreferredTier != "" {
			retryQuery := db.DB.Where("is_healthy = true AND active_connections < max_connections AND deleted_at IS NULL")
			// Try without geo first if tier was also set, or vice versa
			if req.PreferredTier != "" {
				retryQuery = retryQuery.Where("tier = ?", req.PreferredTier)
			}
			if err = retryQuery.Order("quality_score DESC").First(&node).Error; err != nil {
				// Final fallback: best global node
				err = db.DB.Where("is_healthy = true AND active_connections < max_connections AND deleted_at IS NULL").
					Order("quality_score DESC").First(&node).Error
			}
		}
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "No provider nodes available right now. Please try again shortly."})
			return
		}
	}
	nodeID := node.ID

	session := models.Session{
		UserID:          userUUID,
		NodeID:          &nodeID,
		Type:            models.SessionType(req.Type),
		Status:          models.SessionActive,
		CredentialsUser: credUser,
		CredentialsPass: credPass,
		BandwidthLimit:  bandwidthLimit,
		Config:          "{}",
	}

	if result := db.DB.Create(&session); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create session"})
		return
	}

	// METER-002: Lock session parameters on-chain so the edge gateway can
	// verify bandwidth_limit against an immutable PDA rather than trusting Redis.
	go func(sess models.Session) {
		oracle := solana.GetOracleClient()
		if oracle == nil {
			return
		}
		var sidBytes [16]byte
		copy(sidBytes[:], sess.ID[:])
		var buyerWallet, sellerWallet solanaGo.PublicKey
		if user.WalletAddress != nil && *user.WalletAddress != "" {
			buyerWallet, _ = solanaGo.PublicKeyFromBase58(*user.WalletAddress)
		}
		if node.Hotkey != "" {
			sellerWallet, _ = solanaGo.PublicKeyFromBase58(node.Hotkey)
		}
		ctx2, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		sig, err := oracle.LockSessionCommitment(ctx2, solana.LockSessionCommitmentParams{
			SessionID:           sidBytes,
			BuyerWallet:         buyerWallet,
			SellerWallet:        sellerWallet,
			BandwidthLimitBytes: uint64(sess.BandwidthLimit),
			PricePerGBLamports:  uint64(node.BasePricePerGB * 1e9),
		})
		if err != nil {
			logging.Error(err).Str("session_id", sess.ID.String()).Msg("createSession: LockSessionCommitment failed (non-fatal)")
			return
		}
		logging.Info().Str("sig", sig).Str("session_id", sess.ID.String()).Msg("createSession: session commitment anchored on-chain")
	}(session)

	// N-05: Store encrypted credential backup (non-fatal if it fails).
	credSvc := crypto.NewCredentialService()
	if err := credSvc.StoreCredentials(session.ID, credUser, credPass); err != nil {
		logging.Error(err).Str("session_id", session.ID.String()).Msg("Failed to store encrypted credentials — continuing")
	}

	// N-02: Persist per-session configuration record.
	rotationType, rotationInterval := normalizedRotationSettings(req)
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

	// Store in Redis for Gateway authentication — includes provider routing so the
	// edge-gateway knows which node IP/port to forward traffic through.
	sessionData := &redisClient.SessionData{
		UserID:                  userID,
		ProviderID:              node.UserID.String(),
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
		// Routing fields — edge-gateway uses these to forward traffic
		NodeID:     node.ID.String(),
		NodeHost:   node.IPAddress,
		NodePort:   node.Port,
		PricePerGB: node.BasePricePerGB,
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

	buyerHost, buyerPort, buyerEndpoint := BuyerProxyConnectInfo()

	c.JSON(http.StatusCreated, gin.H{
		"session": session,
		"proxy_credentials": gin.H{
			"username": credUser,
			"password": credPass,
			"host":     buyerHost,
			"port":     buyerPort,
			"protocol": "http",
			"endpoint": buyerEndpoint,
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
	if err := models.ValidateSessionStatusTransition(session.Status, models.SessionTerminated); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	now := time.Now().UTC()
	// Update DB
	if result := db.DB.Model(&session).Updates(map[string]interface{}{
		"status":   models.SessionTerminated,
		"end_time": now,
	}); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to terminate session"})
		return
	}
	session.Status = models.SessionTerminated
	session.EndTime = now

	redisClient.DeleteSession(session.CredentialsUser)

	// Increment total_sessions_served on the provider node that served this session
	if session.NodeID != nil {
		db.DB.Model(&models.ProviderNode{}).
			Where("id = ?", session.NodeID).
			UpdateColumn("total_sessions_served", gorm.Expr("total_sessions_served + 1"))

		// Record provider earning asynchronously.
		// Prefer order/listing USD rate converted to SOL; fall back to PricePerGBSOL.
		platformFee := resolvePlatformFee()
		pricePerGBSOL := resolveSessionEarningPricePerGBSOL(session)
		go recordProviderEarning(session, session.BytesUsed, pricePerGBSOL, platformFee)
	}

	if _, escrowBacked, err := ensureUsageProofForSessionSettlement(session, now); err != nil {
		logging.Error(err).Str("session_id", session.ID.String()).Msg("Failed to create usage proof while terminating session")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create usage proof"})
		return
	} else if escrowBacked {
		go anchorUsageProofAndSettle(session.ID.String(), now)
	} else {
		// Preserve legacy behavior for non-order sessions while escrow-backed
		// marketplace sessions use the proof-first finalization path above.
		go settleSessionOnChain(session)
	}

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
	if blockDeprecatedDirectSessionCreation(c, "instant_session") {
		return
	}

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

	// 2. Select best provider node using geographic routing
	node, nodeErr := selectProviderNode(req.TargetCountry, "")
	if nodeErr != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "No provider nodes available for your request"})
		return
	}

	// 3. Create Session
	credUser, credPass := generateCredentials()

	// Default limit if 0 (e.g. 1GB safety cap if not specified)
	if req.BandwidthLimit == 0 {
		req.BandwidthLimit = 1 * 1024 * 1024 * 1024
	}

	nodeID := node.ID
	session := models.Session{
		UserID:          userUUID,
		NodeID:          &nodeID,
		Type:            models.SessionUniversal,
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

	// 4. Store in Redis for Gateway — includes provider routing info
	sessionData := &redisClient.SessionData{
		UserID:         userID,
		ProviderID:     node.UserID.String(),
		SessionID:      session.ID.String(),
		Type:           "universal",
		Status:         "active",
		BandwidthLimit: req.BandwidthLimit,
		TrustTier:      "verified",
		TargetGeo:      req.TargetCountry,
		ExpiresAt:      time.Now().Add(24 * time.Hour),
		CreatedAt:      time.Now(),
		PricePerGB:     node.BasePricePerGB,
	}

	// Store
	if err := redisClient.StoreSession(credUser, sessionData, 24*time.Hour); err != nil {
		c.JSON(http.StatusCreated, gin.H{"warning": "Redis sync failed", "session": session})
		return
	}

	buyerHost, buyerPort, buyerEndpoint := BuyerProxyConnectInfo()

	c.JSON(http.StatusCreated, gin.H{
		"session": session,
		"proxy_credentials": gin.H{
			"username": credUser,
			"password": credPass,
			"host":     buyerHost,
			"port":     buyerPort,
			"protocol": "http",
			"endpoint": buyerEndpoint,
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

	txHash, err := oracle.SettleEscrow(ctx, "api.session.complete", solana.SettleEscrowParams{
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

// =============================================================================
// P2P SESSION: Buy from a specific provider listing
// =============================================================================

type createSessionFromListingRequest struct {
	ListingID      string `json:"listing_id" binding:"required"`
	Type           string `json:"type"`            // "rotating" | "sticky" — defaults to listing's rotation_type
	BandwidthLimit int64  `json:"bandwidth_limit"` // bytes; 0 = listing minimum
}

// createSessionFromListing is the true P2P endpoint.
// The consumer picks a provider's marketplace listing → a session is created
// linked to that listing and the provider's best node → billing worker credits
// the provider on every settlement cycle.
func createSessionFromListing(c *gin.Context) {
	if blockDeprecatedDirectSessionCreation(c, "from_listing") {
		return
	}

	var req createSessionFromListingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// --- Auth ---
	consumerUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// --- Load listing ---
	listingID, err := uuid.Parse(req.ListingID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing_id"})
		return
	}

	var listing models.ProxyListing
	if err := db.DB.Preload("Seller").First(&listing, "id = ?", listingID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
		return
	}

	// --- Validate listing is purchasable ---
	if listing.Status != models.ListingStatusActive {
		c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("Listing is not available (status: %s)", listing.Status)})
		return
	}
	if listing.AvailableBandwidthGB <= 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Listing has no available bandwidth"})
		return
	}

	// --- Prevent self-purchase ---
	if listing.SellerID == consumerUUID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "You cannot buy from your own listing"})
		return
	}

	// --- Concurrency cap ---
	var activeSessions int64
	db.DB.Model(&models.Session{}).
		Where("listing_id = ? AND status = ?", listingID, models.SessionActive).
		Count(&activeSessions)
	if int(activeSessions) >= listing.MaxConcurrency {
		c.JSON(http.StatusConflict, gin.H{
			"error":  "This listing has reached its maximum concurrent sessions",
			"limit":  listing.MaxConcurrency,
			"active": activeSessions,
		})
		return
	}

	// --- Wallet balance check ---
	// Consumer must have at least enough SOL for the minimum purchase (1 GB at listing price).
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", consumerUUID).First(&wallet).Error; err != nil {
		c.JSON(http.StatusPaymentRequired, gin.H{"error": "Wallet not found. Please set up your wallet first."})
		return
	}
	minGB := listing.MinPurchaseGB
	if minGB <= 0 {
		minGB = 1
	}
	minCostSOL := billing.USDToSOL(listing.PricePerGB * minGB)
	if wallet.BalanceSOL < minCostSOL {
		c.JSON(http.StatusPaymentRequired, gin.H{
			"error":           "Insufficient SOL balance",
			"required_sol":    minCostSOL,
			"your_balance":    wallet.BalanceSOL,
			"listing_price":   listing.PricePerGB,
			"min_purchase_gb": minGB,
		})
		return
	}

	// --- Find the best available node for this provider ---
	var node models.ProviderNode
	nodeErr := db.DB.
		Where("user_id = ? AND is_healthy = true AND active_connections < max_connections AND deleted_at IS NULL", listing.SellerID).
		Order("quality_score DESC").
		First(&node).Error
	if nodeErr != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Provider has no available nodes right now. Try again shortly."})
		return
	}

	// --- Session type ---
	sessionType := models.SessionType(req.Type)
	if sessionType != models.SessionRotating && sessionType != models.SessionSticky {
		// Default: use listing's rotation type, fall back to rotating
		if listing.RotationType == "sticky" {
			sessionType = models.SessionSticky
		} else {
			sessionType = models.SessionRotating
		}
	}

	// --- Bandwidth limit ---
	bandwidthLimit := req.BandwidthLimit
	if bandwidthLimit <= 0 {
		bandwidthLimit = int64(listing.AvailableBandwidthGB * 1024 * 1024 * 1024)
	}

	// --- Load consumer trust tier ---
	var consumer models.User
	if err := db.DB.First(&consumer, "id = ?", consumerUUID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Consumer user not found"})
		return
	}

	// --- Distributed lock to prevent race on concurrent buys of the same listing ---
	lockKey := "session:listing:" + listingID.String()
	lockVal := uuid.New().String()
	acquired, err := redisClient.AcquireLock(lockKey, lockVal, 5*time.Second)
	if err != nil || !acquired {
		c.JSON(http.StatusConflict, gin.H{"error": "Listing is being purchased concurrently. Please retry."})
		return
	}
	defer redisClient.ReleaseLock(lockKey)

	// --- Generate credentials ---
	credUser, credPass := generateCredentials()

	// --- Create session in DB ---
	nodeID := node.ID
	session := models.Session{
		UserID:          consumerUUID,
		NodeID:          &nodeID,
		ListingID:       &listingID,
		Type:            sessionType,
		Status:          models.SessionActive,
		CredentialsUser: credUser,
		CredentialsPass: credPass,
		BandwidthLimit:  bandwidthLimit,
		Config:          "{}",
		StartTime:       time.Now(),
	}
	if err := db.DB.Create(&session).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create session"})
		return
	}

	// --- Mark listing as used (increment orders, decrement available bandwidth) ---
	db.DB.Model(&listing).Updates(map[string]interface{}{
		"orders_count":           listing.OrdersCount + 1,
		"available_bandwidth_gb": listing.AvailableBandwidthGB - minGB,
	})

	// --- Store encrypted credential backup ---
	credSvc := crypto.NewCredentialService()
	if err := credSvc.StoreCredentials(session.ID, credUser, credPass); err != nil {
		logging.Error(err).Str("session_id", session.ID.String()).Msg("Failed to store encrypted credentials — continuing")
	}

	// --- Push to Redis for edge-gateway routing ---
	sessionData := &redisClient.SessionData{
		UserID:         consumerUUID.String(),
		SessionID:      session.ID.String(),
		ProviderID:     listing.SellerID.String(),
		Type:           string(sessionType),
		Status:         "active",
		BandwidthLimit: bandwidthLimit,
		BandwidthUsed:  0,
		TrustTier:      string(consumer.TrustTier),
		TargetGeo:      listing.Country,
		TargetISP:      listing.ISP,
		ExpiresAt:      time.Now().Add(24 * time.Hour),
		CreatedAt:      time.Now(),
		// P2P routing fields — edge-gateway routes traffic to this exact node
		ListingID:              listingID.String(),
		NodeID:                 marketplace.GatewayRoutingNodeID(&node),
		NodeHost:               node.IPAddress,
		NodePort:               node.Port,
		PricePerGB:             listing.PricePerGB,
		CredentialPasswordHash: marketplace.HashCredentialPassword(credPass),
	}
	if err := redisClient.StoreSession(credUser, sessionData, 24*time.Hour); err != nil {
		logging.Error(err).Str("session_id", session.ID.String()).Msg("Redis sync failed for P2P session")
		c.JSON(http.StatusCreated, gin.H{
			"session":       session,
			"redis_warning": "Session created but Redis sync failed — contact support if proxy doesn't work",
		})
		return
	}

	sellerName := ""
	if listing.Seller != nil {
		if listing.Seller.DisplayName != nil && *listing.Seller.DisplayName != "" {
			sellerName = *listing.Seller.DisplayName
		} else if listing.Seller.Username != nil && *listing.Seller.Username != "" {
			sellerName = *listing.Seller.Username
		}
	}

	logging.Info().
		Str("session_id", session.ID.String()).
		Str("consumer_id", consumerUUID.String()).
		Str("provider_id", listing.SellerID.String()).
		Str("listing_id", listingID.String()).
		Str("node_id", node.ID.String()).
		Float64("price_per_gb", listing.PricePerGB).
		Msg("P2P session created")

	buyerHost, buyerPort, buyerEndpoint := BuyerProxyConnectInfo()

	c.JSON(http.StatusCreated, gin.H{
		"session": session,
		"proxy_credentials": gin.H{
			"username": credUser,
			"password": credPass,
			"host":     buyerHost,
			"port":     buyerPort,
			"protocol": "http",
			"endpoint": buyerEndpoint,
		},
		"provider": gin.H{
			"id":            listing.SellerID,
			"name":          sellerName,
			"listing_title": listing.Title,
			"price_per_gb":  listing.PricePerGB,
			"proxy_type":    listing.ProxyType,
			"country":       listing.Country,
			"quality_score": node.QualityScore,
		},
		"session_info": gin.H{
			"type":               sessionType,
			"bandwidth_limit_gb": float64(bandwidthLimit) / (1024 * 1024 * 1024),
			"min_cost_sol":       minCostSOL,
			"node_latency_ms":    node.LatencyMs,
		},
	})
}

// tierOrdinal returns a comparable integer for a TrustTier so that the
// lower of two tiers can be determined.  new=0, verified=1, premium=2.
func tierOrdinal(t models.TrustTier) int {
	switch t {
	case models.TrustTierVerified:
		return 1
	case models.TrustTierPremium:
		return 2
	default: // TrustTierNew
		return 0
	}
}

func resolveUserTrustTier(ctx context.Context, userID string, user models.User) models.TrustTier {
	resolvedTier := user.TrustTier
	if user.WalletAddress != nil && *user.WalletAddress != "" {
		if oracle := solana.GetOracleClient(); oracle != nil {
			if pubkey, err := solanaGo.PublicKeyFromBase58(*user.WalletAddress); err == nil {
				if att, err := oracle.ReadKYCAttestation(ctx, pubkey); err == nil {
					switch att.TrustTier {
					case solana.KYCTierNew:
						resolvedTier = models.TrustTierNew
					case solana.KYCTierVerified:
						resolvedTier = models.TrustTierVerified
					case solana.KYCTierPremium:
						resolvedTier = models.TrustTierPremium
					}
					if tierOrdinal(resolvedTier) < tierOrdinal(user.TrustTier) {
						logging.Warn().
							Str("user_id", userID).
							Str("db_tier", string(user.TrustTier)).
							Str("chain_tier", string(resolvedTier)).
							Msg("session policy: on-chain trust tier lower than DB — using chain value")
					}
				}
			}
		}
	}
	return resolvedTier
}

func applyRoutingProfileDefaults(req *createSessionRequestV4) {
	if req.RoutingProfile == "" {
		return
	}

	var rp models.RoutingProfile
	if err := db.DB.Where("slug = ? AND is_active = true", req.RoutingProfile).First(&rp).Error; err == nil {
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
		return
	}

	logging.Warn().Str("slug", req.RoutingProfile).Msg("Routing profile not found — ignoring")
}

func countActiveSessions(userUUID uuid.UUID) int64 {
	var activeSessionCount int64
	db.DB.Model(&models.Session{}).
		Where("user_id = ? AND status = ?", userUUID, models.SessionActive).
		Count(&activeSessionCount)
	return activeSessionCount
}

func computeBandwidthLimit(requestedLimit int64, tierConfig models.TierConfig) int64 {
	bandwidthLimit := requestedLimit
	if bandwidthLimit == 0 {
		bandwidthLimit = int64(tierConfig.MaxBandwidthGB * 1024 * 1024 * 1024)
		if tierConfig.MaxBandwidthGB < 0 {
			bandwidthLimit = 100 * 1024 * 1024 * 1024 * 1024
		}
		return bandwidthLimit
	}

	maxTierBytes := int64(tierConfig.MaxBandwidthGB * 1024 * 1024 * 1024)
	if tierConfig.MaxBandwidthGB > 0 && bandwidthLimit > maxTierBytes {
		return maxTierBytes
	}
	return bandwidthLimit
}

// computeBandwidthLimitForUser applies trust-tier caps and remaining plan bandwidth quota.
func computeBandwidthLimitForUser(userID uuid.UUID, requestedLimit int64, tierConfig models.TierConfig) int64 {
	limit := computeBandwidthLimit(requestedLimit, tierConfig)
	remainingGB, unlimited, _, err := PlanBandwidthRemainingGB(userID)
	if err != nil || unlimited {
		return limit
	}
	remainingBytes := int64(remainingGB * 1024 * 1024 * 1024)
	if remainingBytes <= 0 {
		return 0
	}
	if limit <= 0 || limit > remainingBytes {
		return remainingBytes
	}
	return limit
}

func normalizedRotationSettings(req createSessionRequestV4) (string, int) {
	rotationType := req.RotationType
	if rotationType == "" {
		rotationType = "none"
	}
	rotationInterval := req.RotationIntervalSeconds
	if rotationInterval == 0 {
		rotationInterval = 60
	}
	return rotationType, rotationInterval
}

// resolveSessionEarningPricePerGBSOL returns the SOL/GB rate used for provider
// earning rows. Marketplace order/listing prices are USD and must be converted.
func resolveSessionEarningPricePerGBSOL(session models.Session) float64 {
	var order models.Order
	if err := db.DB.Select("price_per_gb").Where("session_id = ?", session.ID).First(&order).Error; err == nil && order.PricePerGB > 0 {
		if sol := billing.USDToSOL(order.PricePerGB); sol > 0 {
			return sol
		}
	}
	if session.ListingID != nil {
		var listing models.ProxyListing
		if err := db.DB.Select("price_per_gb").First(&listing, "id = ?", *session.ListingID).Error; err == nil && listing.PricePerGB > 0 {
			if sol := billing.USDToSOL(listing.PricePerGB); sol > 0 {
				return sol
			}
		}
	}
	return PricePerGBSOL
}

// resolvePlatformFee returns the platform fee as a fraction (0.0–1.0).
// Reads the on-chain ProgramConfig PDA first; falls back to 10% if not set.
func resolvePlatformFee() float64 {
	if oracle := solana.GetOracleClient(); oracle != nil {
		if cfg, err := oracle.ReadProgramConfig(context.Background()); err == nil && cfg.PlatformFeeBPS > 0 {
			return float64(cfg.PlatformFeeBPS) / 10000.0
		}
	}
	return 0.10
}
