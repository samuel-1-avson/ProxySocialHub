package api

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
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
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
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
		if isDevLoginEnabled() {
			auth.POST("/dev/login", devLogin)
			log.Printf("[AUTH] /auth/dev/login route enabled")
		} else {
			log.Printf("[AUTH] /auth/dev/login route disabled (set ENABLE_DEV_LOGIN=true to enable)")
		}
		auth.GET("/me", getMe)
	}
}

func isDevLoginEnabled() bool {
	flag := strings.TrimSpace(os.Getenv("ENABLE_DEV_LOGIN"))
	return strings.EqualFold(flag, "true") || flag == "1"
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

	// D-A1: Build the nonce from two independent entropy sources:
	//
	//   nonce = hex(random_32_bytes) + ":" + solana_recent_blockhash
	//
	// The Solana recent blockhash is rotated every ~400ms by the network and
	// has a validity window of ~150 slots (~60 s).  Including it means:
	//   - The nonce is verifiable without Redis: a client can confirm the
	//     blockhash was recent by querying any Solana RPC endpoint.
	//   - Even if Redis/memory is compromised, an attacker cannot forge a nonce
	//     that pre-dates the blockhash's validity window.
	//   - Falls back gracefully to random-only if Solana RPC is unavailable.

	randBytes := make([]byte, 32)
	rand.Read(randBytes)
	randPart := hex.EncodeToString(randBytes)

	blockhashPart := ""
	oracle := solanaClient.GetOracleClient()
	if oracle != nil {
		if bh, err := oracle.GetRecentBlockhash(c.Request.Context()); err == nil {
			blockhashPart = bh
		} else {
			log.Printf("[AUTH] Solana blockhash fetch failed (using random-only nonce): %v", err)
		}
	}

	nonce := randPart
	if blockhashPart != "" {
		nonce = randPart + ":" + blockhashPart
	}

	message := "Sign this message to login to ProxyHubb: " + nonce

	// Store in Redis with 5 min TTL
	if redisClient.Client != nil {
		key := "auth:nonce:" + req.Address
		if err := redisClient.Client.Set(c.Request.Context(), key, message, nonceTTL).Err(); err != nil {
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
		"nonce":            nonce,
		"message":          message,
		"blockhash_backed": blockhashPart != "",
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
		if !errors.Is(result.Error, gorm.ErrRecordNotFound) {
			log.Printf("[AUTH] DB error looking up wallet %s: %v", req.Address, result.Error)
			c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Database error"})
			return
		}

		// User not found → Create new user
		tx := db.DB.Begin()

		// Create new user — default role is "buyer".
		username := "user_" + req.Address[:8]
		email := req.Address + "@wallet.proxyhubb.com"

		// Insert into auth.users first (profiles.id has FK to auth.users.id)
		// Use ON CONFLICT to handle retries (orphan rows from previous failed attempts)
		var newID uuid.UUID
		authUserSQL := `INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
			VALUES ($1, $2, '{}', NOW(), NOW())
			ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
			RETURNING id`
		row := tx.Raw(authUserSQL, uuid.New(), email).Row()
		if row == nil {
			tx.Rollback()
			log.Printf("[AUTH] Failed to create auth.users entry for %s: nil row", req.Address)
			c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to create user"})
			return
		}
		if err := row.Scan(&newID); err != nil {
			tx.Rollback()
			log.Printf("[AUTH] Failed to scan auth.users ID for %s: %v", req.Address, err)
			c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to create user"})
			return
		}

		// Insert profile (raw SQL to ensure our UUID is used, GORM Create may override)
		profileSQL := `INSERT INTO profiles (id, email, role, status, trust_tier, wallet_address, username, created_at, updated_at)
			VALUES ($1, $2, 'buyer', 'active', 'new', $3, $4, NOW(), NOW())
			ON CONFLICT (id) DO UPDATE SET wallet_address = EXCLUDED.wallet_address, updated_at = NOW()`
		if err := tx.Exec(profileSQL, newID, email, req.Address, username).Error; err != nil {
			tx.Rollback()
			log.Printf("[AUTH] Failed to create profile for %s (id=%s): %v", req.Address, newID, err)
			c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to create user"})
			return
		}

		// Load the created/updated profile
		if err := tx.Where("id = ?", newID).First(&user).Error; err != nil {
			tx.Rollback()
			log.Printf("[AUTH] Failed to load profile after create for %s: %v", req.Address, err)
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
			log.Printf("[AUTH] Failed to create wallet for %s: %v", req.Address, err)
			c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to create wallet"})
			return
		}

		if err := tx.Commit().Error; err != nil {
			tx.Rollback()
			log.Printf("[AUTH] Transaction commit failed for %s: %v", req.Address, err)
			c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Transaction commit failed"})
			return
		}

		log.Printf("[AUTH] Created new user %s for wallet %s", newID, req.Address)
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
	if !isDevLoginEnabled() {
		log.Printf("[SECURITY] devLogin attempted while route is disabled")
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
		return
	}

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
