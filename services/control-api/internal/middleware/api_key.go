package middleware

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// APIKeyAuth is a Gin middleware that authenticates requests using an X-API-Key header.
// It hashes the provided key with SHA-256 and looks it up in the database.
// On success it sets "user_id" (string) and "api_key_id" (uuid.UUID) in the gin context.
func APIKeyAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		rawKey := c.GetHeader("X-API-Key")
		if rawKey == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "invalid or missing API key",
			})
			return
		}

		// Hash the raw key for DB lookup
		sum := sha256.Sum256([]byte(rawKey))
		keyHash := hex.EncodeToString(sum[:])

		var apiKey models.APIKey
		if err := db.DB.Where("key_hash = ?", keyHash).First(&apiKey).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "invalid or missing API key",
			})
			return
		}

		// Check that the key is not revoked and not expired
		if !apiKey.IsActive() {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "invalid or missing API key",
			})
			return
		}

		// Set context values used by downstream handlers
		c.Set("user_id", apiKey.UserID)
		c.Set("userID", apiKey.UserID.String())
		c.Set("api_key_id", apiKey.ID)

		// Update last_used_at asynchronously to avoid adding latency
		go func() {
			now := time.Now()
			db.DB.Model(&models.APIKey{}).
				Where("id = ?", apiKey.ID).
				Update("last_used_at", now)
		}()

		c.Next()
	}
}
