package api

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"time"

	"sync"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

// memStoreEntry holds nonce with expiration time
type memStoreEntry struct {
	value     string
	expiresAt time.Time
}

var (
	// Fallback in-memory store for when Redis is unavailable (dev mode)
	// Now includes TTL support
	memStore      = make(map[string]memStoreEntry)
	memStoreMutex sync.RWMutex

	// Nonce TTL (5 minutes)
	nonceTTL = 5 * time.Minute
)

func RegisterAuthRoutes(r *gin.RouterGroup) {
	auth := r.Group("/auth")
	{
		// Rate limited auth endpoints — uses Redis-backed StrictRateLimit (10 req/min per IP).
		// Falls back to in-memory if Redis is unavailable.
		auth.POST("/wallet/challenge", StrictRateLimit(), getAuthChallenge)
		auth.POST("/wallet/login", StrictRateLimit(), walletLogin)
		auth.POST("/dev/login", devLogin)
		auth.GET("/me", getMe)
	}
}

type ChallengeRequest struct {
	Address string `json:"address" binding:"required"`
}

type LoginRequest struct {
	Address   string `json:"address" binding:"required"`
	Signature string `json:"signature" binding:"required"`
	Nonce     string `json:"nonce" binding:"required"` // The signed message
}

func getAuthChallenge(c *gin.Context) {
	var req ChallengeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	// Generate 32 bytes random nonce
	bytes := make([]byte, 32)
	rand.Read(bytes)
	nonce := hex.EncodeToString(bytes)

	// Message to sign
	message := "Sign this message to login to ProxyHubb: " + nonce

	// Store in Redis with 5 min TTL
	if redisClient.Client != nil {
		key := "auth:nonce:" + req.Address
		err := redisClient.Client.Set(c.Request.Context(), key, message, nonceTTL).Err()
		if err != nil {
			log.Printf("[AUTH] Redis nonce store failed for address=%s", maskAddress(req.Address))
		}
	}

	// Always store in memory as fallback with TTL
	memStoreMutex.Lock()
	memStore[req.Address] = memStoreEntry{
		value:     message,
		expiresAt: time.Now().Add(nonceTTL),
	}
	memStoreMutex.Unlock()

	c.JSON(http.StatusOK, gin.H{
		"nonce":   nonce,
		"message": message,
	})
}

func walletLogin(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	// 1. Verify Nonce from Redis (or Fallback)
	var storedMsg string
	var gotFromRedis bool

	if redisClient.Client != nil {
		key := "auth:nonce:" + req.Address
		val, err := redisClient.Client.Get(c.Request.Context(), key).Result()
		if err == nil {
			storedMsg = val
			gotFromRedis = true
			// Invalidate nonce to prevent replay
			redisClient.Client.Del(c.Request.Context(), key)
		}
	}

	if !gotFromRedis {
		// Fallback to MemStore with TTL check
		memStoreMutex.RLock()
		entry, ok := memStore[req.Address]
		memStoreMutex.RUnlock()

		if ok && time.Now().Before(entry.expiresAt) {
			storedMsg = entry.value
			// Invalidate
			memStoreMutex.Lock()
			delete(memStore, req.Address)
			memStoreMutex.Unlock()
		} else {
			// Clean up expired entry if exists
			if ok {
				memStoreMutex.Lock()
				delete(memStore, req.Address)
				memStoreMutex.Unlock()
			}
			c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Challenge expired or invalid. Please request a new one."})
			return
		}
	}

	// Verify Message Content
	if req.Nonce != storedMsg {
		log.Printf("[AUTH] Nonce mismatch for address=%s", maskAddress(req.Address))
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Nonce mismatch"})
		return
	}

	// 2. Verify Signature
	// Try Solana (Ed25519) first
	var isValid bool
	pubKeyBytes, err := base58.Decode(req.Address)
	if err == nil && len(pubKeyBytes) == 32 {
		sigBytes, err := base58.Decode(req.Signature)
		if err == nil && len(sigBytes) == 64 {
			// Verify using standard Ed25519
			if ed25519.Verify(pubKeyBytes, []byte(req.Nonce), sigBytes) {
				isValid = true
			}
		}
	}

	if !isValid {
		RecordAuditLog(c, models.AuditAuthLoginFailed, models.AuditSeverityWarning, nil, "wallet", req.Address, "Invalid signature login attempt", false)
		c.JSON(http.StatusUnauthorized, ErrorResponse{Error: "Invalid signature (Solana verification failed)"})
		return
	}

	// 3. Find or Create User
	var user models.User
	result := db.DB.Where("wallet_address = ?", req.Address).First(&user)
	if result.Error != nil {
		// Start transaction for atomic user + wallet creation
		tx := db.DB.Begin()

		// Create new user — default role is "user" (buyer).
		// Providers must go through the provider onboarding flow to gain elevated permissions.
		username := "user_" + req.Address[:8]
		email := req.Address + "@wallet.proxyhubb.com"
		user = models.User{
			ID:            uuid.New(),
			Role:          "user",
			TrustTier:     models.TrustTierNew,
			WalletAddress: &req.Address,
			Username:      &username,
			Email:         email,
		}

		if err := tx.Create(&user).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to create user"})
			return
		}

		// Create Wallet immediately with default spending limits
		wallet := models.Wallet{
			UserID:     user.ID,
			BalanceSOL: 0,
		}
		wallet.InitializeWithDefaultLimits(models.TrustTierNew)

		if err := tx.Create(&wallet).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to create wallet"})
			return
		}

		if err := tx.Commit().Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Transaction commit failed"})
			return
		}
	}

	// 4. Issue JWT
	cfg, err := config.Load()
	if err != nil {
		log.Printf("[AUTH] Failed to load config for token generation: %v", err)
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Internal configuration error"})
		return
	}

	token, err := crypto.GenerateToken(
		user.ID,
		user.Role,
		user.Email,
		req.Address,
		cfg.Auth.JWTSecret,
		24*time.Hour,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user":  user,
	})
}

// devLogin is a BACKDOOR for E2E testing.
// SECURITY: Only available in development environment with secret token
func devLogin(c *gin.Context) {
	// CRITICAL SECURITY: Only allow in development mode
	appEnv := os.Getenv("APP_ENV")
	if appEnv != "development" && appEnv != "dev" && appEnv != "local" {
		log.Printf("[SECURITY] devLogin attempted in non-development environment")
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
		return
	}

	// ADDITIONAL SECURITY: Require a secret token
	devSecret := os.Getenv("DEV_LOGIN_SECRET")
	if devSecret == "" {
		// If no secret is configured, disable dev login entirely
		log.Printf("[SECURITY] devLogin attempted but DEV_LOGIN_SECRET not configured")
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
		return
	}

	// Validate secret token from header
	providedSecret := c.GetHeader("X-Dev-Login-Secret")
	if providedSecret != devSecret {
		log.Printf("[SECURITY] devLogin attempted with invalid secret")
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
		return
	}

	// Create or Get a "Dev User"
	devAddr := "5DTestAddressForGovernanceVerification"

	// Check user
	var user models.User
	result := db.DB.Where("wallet_address = ?", devAddr).First(&user)
	if result.Error != nil {
		// Dev user is a plain "user" with zero balance.
		// Tests that need SOL or provider permissions should set them up explicitly.
		user = models.User{
			ID:            uuid.New(),
			Role:          "user",
			TrustTier:     models.TrustTierNew,
			WalletAddress: &devAddr,
			Username:      func(s string) *string { return &s }("dev_tester"),
			Email:         "dev@test.com",
		}
		if err := db.DB.Create(&user).Error; err != nil {
			c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to create dev user"})
			return
		}

		// Zero balance — fund explicitly in tests via the faucet or admin endpoint.
		wallet := models.Wallet{
			UserID:     user.ID,
			BalanceSOL: 0.0,
		}
		wallet.InitializeWithDefaultLimits(models.TrustTierNew)
		db.DB.Create(&wallet)
	}

	cfg, err := config.Load()
	if err != nil {
		log.Printf("[AUTH] Failed to load config for dev token: %v", err)
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Internal configuration error"})
		return
	}

	token, err := crypto.GenerateToken(
		user.ID,
		user.Role,
		user.Email,
		devAddr,
		cfg.Auth.JWTSecret,
		24*time.Hour,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user":  user,
	})
}

// maskAddress masks an address for safe logging (shows first 6 and last 4 chars)
func maskAddress(addr string) string {
	if len(addr) <= 10 {
		return "***"
	}
	return addr[:6] + "..." + addr[len(addr)-4:]
}

// GetMe returns the current authenticated user's profile.
func GetMe(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}

	var user models.User
	if err := db.DB.Where("id = ?", userID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":             user.ID,
		"email":          user.Email,
		"role":           user.Role,
		"display_name":   user.DisplayName,
		"username":       user.Username,
		"avatar_url":     user.AvatarURL,
		"wallet_address": user.WalletAddress,
		"trust_tier":     user.TrustTier,
		"verified":       user.Verified,
		"created_at":     user.CreatedAt,
	})
}

// getMe returns the currently authenticated user
func getMe(c *gin.Context) {
	// Let's assume we need to parse the token to get the user ID.
	authHeader := c.GetHeader("Authorization")
	if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
		c.JSON(http.StatusUnauthorized, ErrorResponse{Error: "Missing or invalid authorization header"})
		return
	}
	tokenString := authHeader[7:]

	cfg, _ := config.Load()
	claims, err := crypto.ValidateToken(tokenString, cfg.Auth.JWTSecret)
	if err != nil {
		c.JSON(http.StatusUnauthorized, ErrorResponse{Error: "Invalid token"})
		return
	}

	var user models.User
	if err := db.DB.Where("id = ?", claims.UserID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, ErrorResponse{Error: "User not found"})
		return
	}

	c.JSON(http.StatusOK, user)
}
