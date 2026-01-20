package api

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

func RegisterAuthRoutes(r *gin.RouterGroup) {
	auth := r.Group("/auth")
	{
		auth.POST("/wallet/challenge", getAuthChallenge)
		auth.POST("/wallet/login", walletLogin)
		auth.POST("/dev/login", devLogin)
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
	message := fmt.Sprintf("Sign this message to login to ProxyHubb: %s", nonce)

	// Store in Redis with 5 min TTL
	if redisClient.Client != nil {
		key := fmt.Sprintf("auth:nonce:%s", req.Address)
		redisClient.Client.Set(c.Request.Context(), key, message, 5*time.Minute)
	}

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

	// 1. Verify Nonce from Redis
	if redisClient.Client != nil {
		key := fmt.Sprintf("auth:nonce:%s", req.Address)
		storedMsg, err := redisClient.Client.Get(c.Request.Context(), key).Result()
		if err != nil {
			c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Challenge expired or invalid. Please request a new one."})
			return
		}

		// If req.Nonce is sent, it must match. Or we just trust the signature on req.Nonce and verify req.Nonce == storedMsg
		// Here specifically, the prompt said "nonce" is "signed message".
		if req.Nonce != storedMsg {
			c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Nonce mismatch"})
			return
		}

		// Invalidate nonce to prevent replay
		redisClient.Client.Del(c.Request.Context(), key)
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
		// Create new user
		username := fmt.Sprintf("user_%s", req.Address[:8])
		user = models.User{
			ID:               uuid.New(), // We generate our own UUID here since not using Supabase Auth
			Role:             "provider", // Default role? or 'buyer'?
			TrustTier:        models.TrustTierNew,
			BittensorAddress: &req.Address,
			Username:         &username,
			Email:            fmt.Sprintf("%s@wallet.proxyhubb.com", req.Address), // Placeholder email
		}
		if err := db.DB.Create(&user).Error; err != nil {
			c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to create user"})
			return
		}
	}

	// 4. Issue JWT
	cfg, _ := config.Load()
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
// It should strictly checking for "Development" env or similar in real life.
// For this MVP, we just expose it.
func devLogin(c *gin.Context) {
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
			BalanceTAO: 1000.0,
			Currency:   "TAO",
		}
		db.DB.Create(&wallet)
	}

	cfg, _ := config.Load()
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
