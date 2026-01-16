package api

import (
	"crypto/rand"
	"encoding/hex"
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
		sessions.POST("/", createSession)
		sessions.GET("/", listSessions)
		sessions.GET("/:id", getSession)
		sessions.POST("/:id/terminate", terminateSession)
	}
}

type createSessionRequest struct {
	Type           string `json:"type" binding:"required,oneof=rotating sticky"`
	BandwidthLimit int64  `json:"bandwidth_limit"` // optional, in bytes
	TargetGeo      string `json:"target_geo"`      // optional, country/region
	TargetISP      string `json:"target_isp"`      // optional, specific ISP
}

func generateCredentials() (string, string) {
	user := make([]byte, 8)
	pass := make([]byte, 16)
	rand.Read(user)
	rand.Read(pass)
	return hex.EncodeToString(user), hex.EncodeToString(pass)
}

func createSession(c *gin.Context) {
	var req createSessionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user ID from JWT token
	userID := c.GetString("userID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

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
	}

	if result := db.DB.Create(&session); result.Error != nil {
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
	userID := c.GetString("userID")

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

	c.JSON(http.StatusOK, gin.H{
		"session":         session,
		"bandwidth_used":  usage,
		"bandwidth_limit": bandwidthLimit,
		"percent_used":    float64(usage) / float64(bandwidthLimit) * 100,
	})
}

func listSessions(c *gin.Context) {
	userID := c.GetString("userID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var sessions []models.Session
	if result := db.DB.Where("user_id = ?", userID).Order("created_at DESC").Find(&sessions); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch sessions"})
		return
	}

	// Enrich with usage data
	sessionResponses := make([]gin.H, len(sessions))
	for i, session := range sessions {
		usage, _ := redisClient.GetUsage(session.CredentialsUser)
		sessionResponses[i] = gin.H{
			"session":        session,
			"bandwidth_used": usage,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"sessions": sessionResponses,
		"count":    len(sessions),
	})
}

func terminateSession(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetString("userID")

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

	// Remove from Redis
	redisClient.DeleteSession(session.CredentialsUser)

	c.JSON(http.StatusOK, gin.H{"status": "terminated"})
}
