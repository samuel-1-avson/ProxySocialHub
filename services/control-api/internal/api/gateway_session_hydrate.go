package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/logging"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/sessioncache"
)

// hydrateGatewaySession returns the dual-written session blob for edge auth when
// Redis session:{username} is missing (Sprint J0). Best-effort rewarms Redis.
//
// GET /v1/gateway/sessions/hydrate?username=<credentials_user>
func hydrateGatewaySession(c *gin.Context) {
	username := strings.TrimSpace(c.Query("username"))
	if username == "" {
		username = strings.TrimSpace(c.Param("username"))
	}
	if username == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username required", "code": "username_required"})
		return
	}
	if strings.Contains(username, ":") || len(username) > 120 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid username", "code": "username_invalid"})
		return
	}

	data, expiresAt, err := sessioncache.GetByUsername(username)
	if err != nil || data == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "session not found in gateway cache",
			"code":  "session_cache_miss",
		})
		return
	}

	status := strings.ToLower(strings.TrimSpace(data.Status))
	if status != "" && status != "active" {
		c.JSON(http.StatusConflict, gin.H{
			"error":  "session is not active",
			"code":   "session_inactive",
			"status": data.Status,
		})
		return
	}

	// Prefer live Redis usage counter when present; else keep payload value.
	if used, usageErr := redisClient.GetUsage(username); usageErr == nil && used > 0 {
		data.BandwidthUsed = used
	}

	ttl := time.Until(expiresAt)
	if ttl < time.Minute {
		ttl = time.Hour
	}
	if storeErr := redisClient.StoreSession(username, data, ttl); storeErr != nil {
		logging.Warn().Err(storeErr).Str("username", username).Msg("hydrate: redis rewarm failed (returning PG payload anyway)")
	}

	c.Header("X-Session-Hydrate", "pg-cache")
	c.JSON(http.StatusOK, gin.H{
		"username":   username,
		"source":     "session_gateway_cache",
		"rewarmed":   true,
		"expires_at": expiresAt.UTC().Format(time.RFC3339),
		"session":    data,
	})
}
