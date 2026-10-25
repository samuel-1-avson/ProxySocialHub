package api

import (
	"crypto/hmac"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/crypto"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

var adminCfg *config.AdminConfig

// InitAdminConfig stores the admin config for use by login handlers.
func InitAdminConfig(cfg *config.AdminConfig) {
	adminCfg = cfg
}

// RegisterAdminAuthRoutes registers the public admin auth endpoints (no auth required).
func RegisterAdminAuthRoutes(r *gin.RouterGroup) {
	r.POST("/login", adminLogin)
}

// RegisterAdminMeRoute registers the authenticated /me, /logout and /invalidate endpoints.
// Logout is behind the admin middleware: it needs the caller's session id, and an
// unauthenticated logout could not revoke anything.
func RegisterAdminMeRoute(r *gin.RouterGroup) {
	r.GET("/me", adminMe)
	r.POST("/logout", adminLogout)
	r.POST("/invalidate", adminInvalidateSession)
}

// ========== TOTP (RFC 6238) — stdlib-only implementation ==========

// totpCode computes the 6-digit TOTP code for a base32-encoded secret at time t.
func totpCode(secretBase32 string, t time.Time) (string, error) {
	// Pad secret to 8-byte boundary
	padded := strings.ToUpper(strings.TrimSpace(secretBase32))
	if n := len(padded) % 8; n != 0 {
		padded += strings.Repeat("=", 8-n)
	}
	key, err := base32.StdEncoding.DecodeString(padded)
	if err != nil {
		return "", fmt.Errorf("invalid TOTP secret: %w", err)
	}

	// Counter = floor(unix / 30)
	counter := uint64(math.Floor(float64(t.Unix()) / 30))
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, counter)

	mac := hmac.New(sha1.New, key)
	mac.Write(buf)
	h := mac.Sum(nil)

	// Dynamic truncation
	offset := h[len(h)-1] & 0x0f
	code := (uint32(h[offset]&0x7f)<<24 |
		uint32(h[offset+1])<<16 |
		uint32(h[offset+2])<<8 |
		uint32(h[offset+3])) % 1_000_000

	return fmt.Sprintf("%06d", code), nil
}

// verifyTOTP checks the provided code against ±1 time-step window (±30 s).
func verifyTOTP(secretBase32, code string) bool {
	now := time.Now()
	for _, delta := range []time.Duration{-30 * time.Second, 0, 30 * time.Second} {
		expected, err := totpCode(secretBase32, now.Add(delta))
		if err != nil {
			return false
		}
		if subtle.ConstantTimeCompare([]byte(code), []byte(expected)) == 1 {
			return true
		}
	}
	return false
}

// ========== Session Blocklist (Redis) ==========

const adminSessionBlocklistPrefix = "admin:session:blocked:"

// blockAdminSession adds the token's JTI (or the full token) to a Redis
// blocklist with TTL equal to the remaining session lifetime.
func blockAdminSession(jti string, ttl time.Duration) error {
	return redisClient.BlockAdminSession(jti, ttl)
}

// IsAdminSessionBlocked returns true if the given JTI has been invalidated.
func IsAdminSessionBlocked(jti string) bool {
	return redisClient.IsAdminSessionBlocked(jti)
}

// ========== Handlers ==========

type adminLoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
	TOTPCode string `json:"totp_code"` // required when account has TOTPSecret set
}

type adminLoginResponse struct {
	Token string      `json:"token"`
	Admin adminIdentity `json:"admin"`
}

type adminIdentity struct {
	Username string `json:"username"`
	Role     string `json:"role"`
}

// adminLogin validates credentials and returns a signed admin JWT.
func adminLogin(c *gin.Context) {
	if adminCfg == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Admin config not initialized"})
		return
	}

	var req adminLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username and password are required"})
		return
	}

	// Find matching account using constant-time comparison to prevent timing attacks
	var matched *config.AdminAccount
	for i := range adminCfg.Accounts {
		acc := &adminCfg.Accounts[i]
		usernameMatch := subtle.ConstantTimeCompare([]byte(req.Username), []byte(acc.Username)) == 1
		passwordMatch := subtle.ConstantTimeCompare([]byte(req.Password), []byte(acc.Password)) == 1
		if usernameMatch && passwordMatch {
			matched = acc
			break
		}
	}

	if matched == nil {
		// Uniform delay to prevent username enumeration
		time.Sleep(300 * time.Millisecond)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	// TOTP MFA — required when the account has a secret configured.
	if matched.TOTPSecret != "" {
		if req.TOTPCode == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "TOTP code required", "mfa_required": true})
			return
		}
		if !verifyTOTP(matched.TOTPSecret, req.TOTPCode) {
			time.Sleep(300 * time.Millisecond)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid TOTP code"})
			return
		}
	}

	// Generate a deterministic stable UUID for this admin account
	// (not a DB user — admin accounts live in config only)
	adminID := uuid.NewSHA1(uuid.NameSpaceURL, []byte("admin:"+matched.Username))

	ttl := time.Duration(adminCfg.SessionTTLHr) * time.Hour
	// The jti lets a logout or an invalidation revoke this one session.
	token, err := crypto.GenerateTokenWithID(adminID, matched.Role, matched.Username, "", adminCfg.JWTSecret, ttl, uuid.NewString())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, adminLoginResponse{
		Token: token,
		Admin: adminIdentity{
			Username: matched.Username,
			Role:     matched.Role,
		},
	})
}

// adminLogout blocklists the current session token so it cannot be reused.
func adminLogout(c *gin.Context) {
	jti := c.GetString("adminJTI")
	if jti != "" {
		// Block until the token would have expired anyway.
		ttl := 4 * time.Hour
		if exp, ok := c.Get("adminTokenExp"); ok {
			if t, ok := exp.(time.Time); ok && time.Until(t) > 0 {
				ttl = time.Until(t)
			}
		}
		_ = blockAdminSession(jti, ttl)
	}
	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}

// adminInvalidateSession allows a super-admin to forcibly revoke any admin
// session by JTI — useful when a credential is compromised.
func adminInvalidateSession(c *gin.Context) {
	role := c.GetString("adminRole")
	if role != "superadmin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only superadmin can invalidate sessions"})
		return
	}

	var req struct {
		JTI string        `json:"jti" binding:"required"`
		TTL time.Duration `json:"ttl_seconds"` // how long to blocklist (seconds)
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ttl := req.TTL * time.Second
	if ttl <= 0 || ttl > 24*time.Hour {
		ttl = 24 * time.Hour // default: blocklist for 24 h
	}

	if err := blockAdminSession(req.JTI, ttl); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to invalidate session"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Session invalidated", "jti": req.JTI})
}

// adminMe returns the identity of the currently authenticated admin.
func adminMe(c *gin.Context) {
	username := c.GetString("adminUsername")
	role := c.GetString("adminRole")

	c.JSON(http.StatusOK, gin.H{
		"username": username,
		"role":     role,
	})
}
