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
		// Rate limited auth endpoints (10 requests/min per IP)
		auth.POST("/wallet/challenge", authRateLimit(), getAuthChallenge)
		auth.POST("/wallet/login", authRateLimit(), walletLogin)
		auth.POST("/dev/login", devLogin)
		auth.GET("/me", getMe)
	}
}

// authRateLimit provides rate limiting for auth endpoints
func authRateLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Simple in-memory rate limiter key
		key := c.ClientIP()

		// Check rate limit using memStore
		memStoreMutex.Lock()
		rateLimitKey := "ratelimit:" + key
		entry, exists := memStore[rateLimitKey]
		now := time.Now()

		if !exists || now.After(entry.expiresAt) {
			// New window: allow and start counting
			memStore[rateLimitKey] = memStoreEntry{
				value:     "1",
				expiresAt: now.Add(1 * time.Minute),
			}
			memStoreMutex.Unlock()
			c.Next()
			return
		}

		// Count requests in current window
		count := 0
		for _, v := range entry.value {
			count += int(v - '0')
		}
		count++

		if count > 10 { // Max 10 requests per minute
			memStoreMutex.Unlock()
			log.Printf("[SECURITY] Rate limit exceeded for IP=%s", maskAddress(key))
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":       "Too many authentication attempts. Please try again later.",
				"retry_after": 60,
			})
			return
		}

		// Update count
		memStore[rateLimitKey] = memStoreEntry{
			value:     string(rune('0' + count)),
			expiresAt: entry.expiresAt,
		}
		memStoreMutex.Unlock()
		c.Next()
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
		// Fallback to Bittensor Bridge
		client := GetBittensorClient()
		if client != nil {
			bridgeValid, err := client.VerifySignature(req.Address, req.Nonce, req.Signature)
			if err == nil && bridgeValid {
				isValid = true
			}
		}
	}

	if !isValid {
		c.JSON(http.StatusUnauthorized, ErrorResponse{Error: "Invalid signature (Solana/Bittensor verification failed)"})
		return
	}

	// 3. Find or Create User
	var user models.User
	result := db.DB.Where("bittensor_address = ?", req.Address).First(&user)
	if result.Error != nil {
		// Start transaction for atomic user + wallet creation
		tx := db.DB.Begin()

		// Create new user
		username := "user_" + req.Address[:8]
		email := req.Address + "@wallet.proxyhubb.com"
		user = models.User{
			ID:               uuid.New(), // We generate our own UUID here since not using Supabase Auth
			Role:             "provider", // Default role? or 'buyer'?
			TrustTier:        models.TrustTierNew,
			BittensorAddress: &req.Address,
			Username:         &username,
			Email:            email,
		}

		if err := tx.Create(&user).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to create user"})
			return
		}

		// Create Wallet immediately
		wallet := models.Wallet{
			UserID:      user.ID,
			BalanceSOL:  0,
			BalanceUSDT: 0,
			BalanceGHS:  0,
			Currency:    "MULTI",
		}

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
// SECURITY: Only available in development environment
func devLogin(c *gin.Context) {
	// CRITICAL SECURITY: Only allow in development mode
	appEnv := os.Getenv("APP_ENV")
	if appEnv != "development" && appEnv != "dev" && appEnv != "local" {
		log.Printf("[SECURITY] devLogin attempted in production environment")
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
		return
	}

	// Create or Get a "Dev User"
	devAddr := "5DTestAddressForGovernanceVerification"

	// Check user
	var user models.User
	result := db.DB.Where("bittensor_address = ?", devAddr).First(&user)
	if result.Error != nil {
		user = models.User{
			ID:               uuid.New(),
			Role:             "provider", // Provider role so we have voting power
			TrustTier:        models.TrustTierVerified,
			BittensorAddress: &devAddr,
			Username:         func(s string) *string { return &s }("dev_tester"),
			Email:            "dev@test.com",
		}
		if err := db.DB.Create(&user).Error; err != nil {
			c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to create dev user"})
			return
		}

		// Fund wallet
		wallet := models.Wallet{
			UserID:     user.ID,
			BalanceSOL: 1000.0,
			Currency:   "SOL",
		}
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
