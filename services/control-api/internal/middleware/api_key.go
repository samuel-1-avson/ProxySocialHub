package middleware

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// extractAPIKey returns a bulk/general API key from X-API-Key or
// Authorization: Bearer phub_|pk_…. JWT bearer tokens are ignored here.
func extractAPIKey(c *gin.Context) string {
	if key := strings.TrimSpace(c.GetHeader("X-API-Key")); key != "" {
		return key
	}
	auth := c.GetHeader("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return ""
	}
	token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	if strings.HasPrefix(token, "phub_") || strings.HasPrefix(token, "pk_") {
		return token
	}
	return ""
}

// authenticateAPIKey looks up a plaintext API key and sets auth context on success.
// Returns true if authentication succeeded. On invalid/revoked keys it aborts with 401
// and returns false. Returns false without aborting when no key is present.
func authenticateAPIKey(c *gin.Context) (ok bool, aborted bool) {
	rawKey := extractAPIKey(c)
	if rawKey == "" {
		return false, false
	}

	if db.DB == nil {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
			"error": "database not available",
		})
		return false, true
	}

	sum := sha256.Sum256([]byte(rawKey))
	keyHash := hex.EncodeToString(sum[:])

	var apiKey models.APIKey
	if err := db.DB.Where("key_hash = ?", keyHash).First(&apiKey).Error; err != nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
			"error": "invalid or missing API key",
		})
		return false, true
	}

	if !apiKey.IsActive() {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
			"error": "invalid or missing API key",
		})
		return false, true
	}

	c.Set("user_id", apiKey.UserID)
	c.Set("userID", apiKey.UserID.String())
	c.Set("api_key_id", apiKey.ID)
	c.Set("api_key_permissions", []string(apiKey.Permissions))
	c.Set("api_key_rate_limit", apiKey.RateLimitPerMin)
	c.Set("auth_type", "api_key")

	gdb := db.DB
	keyID := apiKey.ID
	go func() {
		if gdb == nil {
			return
		}
		now := time.Now()
		gdb.Model(&models.APIKey{}).Where("id = ?", keyID).Update("last_used_at", now)
	}()

	return true, false
}

// APIKeyAuth requires a valid X-API-Key (or Bearer phub_/pk_) header.
func APIKeyAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		ok, aborted := authenticateAPIKey(c)
		if aborted {
			return
		}
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "invalid or missing API key",
			})
			return
		}
		c.Next()
	}
}

// RequireAuthOrAPIKey allows either an already-authenticated JWT/provider session
// (user_id set by optional auth middleware) or a valid API key (phub_ / pk_).
func RequireAuthOrAPIKey() gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, exists := c.Get("user_id"); exists {
			c.Next()
			return
		}

		ok, aborted := authenticateAPIKey(c)
		if aborted {
			return
		}
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Authentication required",
			})
			return
		}
		c.Next()
	}
}
