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
		auth.POST("/refresh", StrictRateLimit(), refreshSession)
		auth.POST("/logout", StrictRateLimit(), logoutSession)
		log.Printf("[AUTH] Wallet-only mode enabled (/auth/dev/login disabled)")
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
	Address      string `json:"address" binding:"required"`
	Signature    string `json:"signature" binding:"required"`
	Nonce        string `json:"nonce" binding:"required"` // The signed message
	ReferralCode string `json:"referral_code,omitempty"`   // Optional invite code (new users only)
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
	user, found, lookupErr := findUserForWalletLogin(req.Address)
	if lookupErr != nil {
		log.Printf("[AUTH] DB error looking up wallet %s: %v", req.Address, lookupErr)
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Database error"})
		return
	}
	if !found {
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

		// Create wallet only when missing (retries / email conflict can reuse an existing user_id).
		var existingWallet models.Wallet
		walletErr := tx.Where("user_id = ?", user.ID).First(&existingWallet).Error
		if walletErr != nil {
			if !errors.Is(walletErr, gorm.ErrRecordNotFound) {
				tx.Rollback()
				log.Printf("[AUTH] Failed to look up wallet for %s: %v", req.Address, walletErr)
				c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to create wallet"})
				return
			}
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
		}

		if err := tx.Commit().Error; err != nil {
			tx.Rollback()
			log.Printf("[AUTH] Transaction commit failed for %s: %v", req.Address, err)
			c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Transaction commit failed"})
			return
		}

		log.Printf("[AUTH] Created new user %s for wallet %s", newID, req.Address)
		if code := strings.TrimSpace(req.ReferralCode); code != "" {
			ProcessReferralSignup(user.ID, code)
		}
	} else {
		// Reconcile wallet_address when user was found via email/linked wallet but profile was stale.
		if user.WalletAddress == nil || *user.WalletAddress != req.Address {
			if err := db.DB.Model(&user).Update("wallet_address", req.Address).Error; err != nil {
				log.Printf("[AUTH] Failed to update wallet_address for user %s: %v", user.ID, err)
			} else {
				user.WalletAddress = &req.Address
			}
		}
		// User exists -> Check if account has scheduled deletion and cancel it
		if user.ScheduledDeletionAt != nil {
			db.DB.Model(&user).Update("scheduled_deletion_at", nil)
			user.ScheduledDeletionAt = nil
			log.Printf("[AUTH] Cancelled scheduled deletion for user %s on wallet login", user.ID)
		}
	}

	// Keep linked_wallets in sync with profile identity (marketplace escrow requires it).
	if err := ensurePrimaryLinkedSolana(db.DB, user.ID, req.Address, &req.Signature, &req.Nonce); err != nil {
		log.Printf("[AUTH] ensurePrimaryLinkedSolana for %s: %v", req.Address, err)
	}

	// 4. Issue JWT
	cfg, err := config.Load()
	if err != nil {
		log.Printf("[AUTH] Failed to load config for token generation: %v", err)
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Internal configuration error"})
		return
	}

	authSession, err := issueAuthSession(user, req.Address, cfg.Auth.JWTSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to generate token"})
		return
	}

	authSession.User = user
	applyAuthSessionCookies(c, authSession)
	c.JSON(http.StatusOK, authSession)
}

// findUserForWalletLogin resolves a profile by wallet_address or wallet signup email.
func findUserForWalletLogin(address string) (models.User, bool, error) {
	var user models.User
	if err := db.DB.Where("wallet_address = ?", address).First(&user).Error; err == nil {
		return user, true, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return models.User{}, false, err
	}

	email := address + "@wallet.proxyhubb.com"
	hash := models.HashEmail(email)
	q := db.DB.Where("email = ?", email)
	if hash != "" {
		q = db.DB.Where("email = ? OR email_hash = ?", email, hash)
	}
	if err := q.First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return models.User{}, false, nil
		}
		return models.User{}, false, err
	}
	return user, true, nil
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
	if err := syncApprovedProviderRole(&user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to synchronize provider role"})
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
	userIDValue, exists := c.Get("user_id")
	if !exists {
		tokenString := ""
		authHeader := c.GetHeader("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			tokenString = strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
		} else if cookieToken, err := c.Cookie(accessTokenStorageKey); err == nil {
			tokenString = strings.TrimSpace(cookieToken)
		}

		if tokenString == "" {
			c.JSON(http.StatusUnauthorized, ErrorResponse{Error: "Missing or invalid authorization token"})
			return
		}

		cfg, _ := config.Load()
		claims, err := crypto.ValidateToken(tokenString, cfg.Auth.JWTSecret)
		if err != nil {
			c.JSON(http.StatusUnauthorized, ErrorResponse{Error: "Invalid token"})
			return
		}
		userIDValue = claims.UserID
	}

	var user models.User
	if err := db.DB.Where("id = ?", userIDValue).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, ErrorResponse{Error: "User not found"})
		return
	}
	if err := syncApprovedProviderRole(&user); err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to synchronize provider role"})
		return
	}

	type SanitizedUser struct {
		ID                    uuid.UUID         `json:"id"`
		Email                 string            `json:"email"`
		Role                  string            `json:"role"`
		Status                models.UserStatus `json:"status"`
		TrustTier             models.TrustTier  `json:"trust_tier"`
		KYCStatus             models.KYCStatus  `json:"kyc_status"`
		DisplayName           *string           `json:"display_name,omitempty"`
		Username              *string           `json:"username,omitempty"`
		Bio                   *string           `json:"bio,omitempty"`
		AvatarURL             *string           `json:"avatar_url,omitempty"`
		CoverImageURL         *string           `json:"cover_image_url,omitempty"`
		Location              *string           `json:"location,omitempty"`
		ISP                   *string           `json:"isp,omitempty"`
		Website               *string           `json:"website,omitempty"`
		SocialLinks           models.JSONMap    `json:"social_links,omitempty"`
		Skills                []string          `json:"skills,omitempty"`
		ProfessionalTitle     *string           `json:"professional_title,omitempty"`
		ExperienceYears       int               `json:"experience_years"`
		Languages             []string          `json:"languages,omitempty"`
		PrimarySpecialization *string           `json:"primary_specialization,omitempty"`
		BusinessName          *string           `json:"business_name,omitempty"`
		FollowersCount        int               `json:"followers_count"`
		FollowingCount        int               `json:"following_count"`
		ReviewsCount          int               `json:"reviews_count"`
		AvgRating             float64           `json:"avg_rating"`
		Verified              bool              `json:"verified"`
		ProviderSince         *time.Time        `json:"provider_since,omitempty"`
		TotalBandwidthSold    float64           `json:"total_bandwidth_sold"`
		WalletAddress         *string           `json:"wallet_address,omitempty"`
		EmailVerified         bool              `json:"email_verified"`
		IsOnline              bool              `json:"is_online"`
		LastSeenAt            *time.Time        `json:"last_seen_at,omitempty"`
		ScheduledDeletionAt   *time.Time        `json:"scheduled_deletion_at,omitempty"`
		CreatedAt             time.Time         `json:"created_at"`
		UpdatedAt             time.Time         `json:"updated_at"`
	}

	response := SanitizedUser{
		ID:                    user.ID,
		Email:                 user.Email,
		Role:                  user.Role,
		Status:                user.Status,
		TrustTier:             user.TrustTier,
		KYCStatus:             user.KYCStatus,
		DisplayName:           user.DisplayName,
		Username:              user.Username,
		Bio:                   user.Bio,
		AvatarURL:             user.AvatarURL,
		CoverImageURL:         user.CoverImageURL,
		Location:              user.Location,
		ISP:                   user.ISP,
		Website:               user.Website,
		SocialLinks:           user.SocialLinks,
		Skills:                user.Skills,
		ProfessionalTitle:     user.ProfessionalTitle,
		ExperienceYears:       user.ExperienceYears,
		Languages:             user.Languages,
		PrimarySpecialization: user.PrimarySpecialization,
		BusinessName:          user.BusinessName,
		FollowersCount:        user.FollowersCount,
		FollowingCount:        user.FollowingCount,
		ReviewsCount:          user.ReviewsCount,
		AvgRating:             user.AvgRating,
		Verified:              user.Verified,
		ProviderSince:         user.ProviderSince,
		TotalBandwidthSold:    user.TotalBandwidthSold,
		WalletAddress:         user.WalletAddress,
		EmailVerified:         user.EmailVerified,
		IsOnline:              user.IsOnline,
		LastSeenAt:            user.LastSeenAt,
		ScheduledDeletionAt:   user.ScheduledDeletionAt,
		CreatedAt:             user.CreatedAt,
		UpdatedAt:             user.UpdatedAt,
	}

	c.JSON(http.StatusOK, response)
}
