package api

import (
	"context"
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
	"github.com/proxyhubb/control-api/internal/custody"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
)

// memStoreMaxEntries is when getAuthChallenge starts purging expired in-memory challenges.
const memStoreMaxEntries = 10000

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
		auth.POST("/google", StrictRateLimit(), googleLogin)
		auth.POST("/mfa/verify", StrictRateLimit(), verifyMFALogin)
		auth.POST("/refresh", StrictRateLimit(), refreshSession)
		auth.POST("/logout", StrictRateLimit(), logoutSession)
		log.Printf("[AUTH] Wallet + Google sign-in enabled (/auth/dev/login disabled)")
		auth.GET("/me", getMe)
		auth.GET("/capabilities", authCapabilities)
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
	ReferralCode string `json:"referral_code,omitempty"`  // Optional invite code (new users only)
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
	if len(memStore) >= memStoreMaxEntries {
		// Entries are only removed when their address logs in, so drop expired ones here.
		now := time.Now()
		for addr, e := range memStore {
			if now.After(e.expiresAt) {
				delete(memStore, addr)
			}
		}
	}
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

// getAndDeleteScript is GETDEL, which the RedisClient interface does not expose.
const getAndDeleteScript = `local v = redis.call('GET', KEYS[1])
if v then redis.call('DEL', KEYS[1]) end
return v`

// consumeLoginChallenge returns the pending sign-in challenge for address and removes it
// from both the Redis copy and the in-memory fallback, so a signed challenge works once.
// getAuthChallenge writes both copies. Walletlogin used to delete only the Redis copy when
// it found one, so the in-memory copy let the same signature log in a second time within
// the TTL. Redis is read and deleted in one script so two concurrent logins cannot both
// succeed.
func consumeLoginChallenge(ctx context.Context, address string) (string, bool) {
	var msg string
	found := false

	if redisClient.Client != nil {
		if val, err := redisClient.Client.Eval(ctx, getAndDeleteScript, []string{"auth:nonce:" + address}).Text(); err == nil {
			msg, found = val, true
		}
	}

	memStoreMutex.Lock()
	entry, inMem := memStore[address]
	delete(memStore, address)
	memStoreMutex.Unlock()

	if !found && inMem && time.Now().Before(entry.expiresAt) {
		msg, found = entry.value, true
	}
	return msg, found
}

func walletLogin(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	// 1. Consume the challenge. It is single use (BE-HIGH-03).
	storedMsg, ok := consumeLoginChallenge(c.Request.Context(), req.Address)
	if !ok {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Challenge expired or invalid. Please request a new one."})
		return
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
		recordFailedWalletLogin(c, req.Address)
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
	if found && !user.IsActive() {
		c.JSON(http.StatusForbidden, gin.H{"error": "Account is unavailable"})
		return
	}
	if !found {
		// User not found → Create new user (default role "buyer").
		tx := db.DB.Begin()
		username := "user_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
		email := req.Address + "@wallet.proxyhubb.com"
		address := req.Address

		created, err := createAccount(tx, email, username, &address)
		if err != nil {
			tx.Rollback()
			log.Printf("[AUTH] Failed to create account for %s: %v", req.Address, err)
			msg := "Failed to create user"
			if errors.Is(err, errAccountWallet) {
				msg = "Failed to create wallet"
			}
			c.JSON(http.StatusInternalServerError, ErrorResponse{Error: msg})
			return
		}
		user = created

		if err := tx.Commit().Error; err != nil {
			tx.Rollback()
			log.Printf("[AUTH] Transaction commit failed for %s: %v", req.Address, err)
			c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Transaction commit failed"})
			return
		}

		log.Printf("[AUTH] Created new user %s for wallet %s", user.ID, req.Address)
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

	}

	// Keep linked_wallets in sync with profile identity (marketplace escrow requires it).
	if err := ensurePrimaryLinkedSolana(db.DB, user.ID, req.Address, &req.Signature, &req.Nonce); err != nil {
		log.Printf("[AUTH] ensurePrimaryLinkedSolana for %s: %v", req.Address, err)
	} else if routingErr := applyWithdrawalRoutingForSolana(db.DB, user, req.Address); routingErr != nil {
		// P0-4: login-proven primary also maintains withdrawal routing +
		// cooldown. Best-effort: never fail a valid login over routing sync.
		log.Printf("[AUTH] wallet login: withdrawal routing sync failed for %s: %v", user.ID, routingErr)
	}

	// 4. Issue JWT
	cfg, err := config.Load()
	if err != nil {
		log.Printf("[AUTH] Failed to load config for token generation: %v", err)
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Internal configuration error"})
		return
	}

	completeLoginOrChallenge(c, user, cfg.Auth.JWTSecret)
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
		c.JSON(http.StatusUnauthorized, ErrorResponse{Error: "Authentication required"})
		return
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
		// ManagedWallet is set when ProxyHubb holds the user's wallet (Google sign-up).
		ManagedWallet *managedWalletInfo `json:"managed_wallet,omitempty"`
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
	if w, err := custody.FindWallet(db.DB, user.ID); err == nil {
		response.ManagedWallet = &managedWalletInfo{Address: w.Address, Chain: w.Chain}
	}

	c.JSON(http.StatusOK, response)
}

// managedWalletInfo is the public part of a server-held wallet: never key material.
type managedWalletInfo struct {
	Address string `json:"address"`
	Chain   string `json:"chain"`
}
