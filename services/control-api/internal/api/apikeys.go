package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

// RegisterAPIKeyRoutes registers the API key management endpoints
func RegisterAPIKeyRoutes(r *gin.RouterGroup) {
	apiKeys := r.Group("/api-keys")
	{
		apiKeys.GET("", listAPIKeys)
		apiKeys.POST("", createAPIKey)
		apiKeys.GET("/:id", getAPIKey)
		apiKeys.DELETE("/:id", revokeAPIKey)
		apiKeys.PATCH("/:id", updateAPIKey)
	}
}

// createAPIKeyRequest is the request body for creating a new API key
type createAPIKeyRequest struct {
	Name            string   `json:"name" binding:"required,min=1,max=100"`
	Permissions     []string `json:"permissions"`
	RateLimitPerMin int      `json:"rate_limit_per_minute"`
	ExpiresInDays   *int     `json:"expires_in_days"` // Optional: days until expiration
}

// updateAPIKeyRequest is the request body for updating an API key
type updateAPIKeyRequest struct {
	Name            *string  `json:"name"`
	Permissions     []string `json:"permissions"`
	RateLimitPerMin *int     `json:"rate_limit_per_minute"`
}

// listAPIKeys returns all API keys for the authenticated user
func listAPIKeys(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}

	var apiKeys []models.APIKey
	if result := db.DB.Where("user_id = ?", userID).Order("created_at DESC").Find(&apiKeys); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch API keys"})
		return
	}

	// Convert to response format (without exposing hashes)
	responses := make([]models.APIKeyResponse, len(apiKeys))
	for i, key := range apiKeys {
		responses[i] = key.ToResponse()
	}

	c.JSON(http.StatusOK, gin.H{
		"api_keys": responses,
		"count":    len(responses),
	})
}

// createAPIKey creates a new API key for the user
func createAPIKey(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req createAPIKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}

	// Check how many active keys the user has (limit to 10)
	var count int64
	db.DB.Model(&models.APIKey{}).Where("user_id = ? AND revoked_at IS NULL", userID).Count(&count)
	if count >= 10 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Maximum of 10 active API keys allowed. Please revoke an existing key first.",
			"code":  "max_keys_reached",
		})
		return
	}

	// Calculate expiration if specified
	var expiresAt *time.Time
	if req.ExpiresInDays != nil && *req.ExpiresInDays > 0 {
		exp := time.Now().AddDate(0, 0, *req.ExpiresInDays)
		expiresAt = &exp
	}

	// Validate permissions
	validPerms := map[string]bool{
		"read": true, "write": true, "proxy": true, "admin": true,
	}
	for _, p := range req.Permissions {
		if !validPerms[p] {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid permission: " + p,
				"valid": []string{"read", "write", "proxy", "admin"},
			})
			return
		}
	}

	// Generate the API key
	userUUID, _ := uuid.Parse(userID)
	apiKey, plaintextKey, err := models.GenerateAPIKey(
		userUUID,
		req.Name,
		req.Permissions,
		req.RateLimitPerMin,
		expiresAt,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate API key"})
		return
	}

	// Save to database
	if result := db.DB.Create(apiKey); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save API key"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"api_key": apiKey.ToResponseWithKey(plaintextKey),
		"message": "API key created successfully. Save the key now - it won't be shown again!",
		"warning": "Store this key securely. You will not be able to see it again.",
	})
}

// getAPIKey returns details for a specific API key
func getAPIKey(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	keyID := c.Param("id")
	if keyID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Key ID required"})
		return
	}

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}

	var apiKey models.APIKey
	if result := db.DB.Where("id = ? AND user_id = ?", keyID, userID).First(&apiKey); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "API key not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"api_key":   apiKey.ToResponse(),
		"is_active": apiKey.IsActive(),
	})
}

// revokeAPIKey revokes an API key
func revokeAPIKey(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	keyID := c.Param("id")
	if keyID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Key ID required"})
		return
	}

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}

	var apiKey models.APIKey
	if result := db.DB.Where("id = ? AND user_id = ?", keyID, userID).First(&apiKey); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "API key not found"})
		return
	}

	if apiKey.RevokedAt != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "API key is already revoked"})
		return
	}

	apiKey.Revoke()
	if result := db.DB.Save(&apiKey); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to revoke API key"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "API key revoked successfully",
		"api_key": apiKey.ToResponse(),
	})
}

// updateAPIKey updates an API key's settings
func updateAPIKey(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	keyID := c.Param("id")
	if keyID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Key ID required"})
		return
	}

	var req updateAPIKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}

	var apiKey models.APIKey
	if result := db.DB.Where("id = ? AND user_id = ?", keyID, userID).First(&apiKey); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "API key not found"})
		return
	}

	if apiKey.RevokedAt != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot update a revoked API key"})
		return
	}

	// Apply updates
	if req.Name != nil && *req.Name != "" {
		apiKey.Name = *req.Name
	}
	if len(req.Permissions) > 0 {
		apiKey.Permissions = req.Permissions
	}
	if req.RateLimitPerMin != nil && *req.RateLimitPerMin > 0 {
		apiKey.RateLimitPerMin = *req.RateLimitPerMin
	}

	if result := db.DB.Save(&apiKey); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update API key"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "API key updated successfully",
		"api_key": apiKey.ToResponse(),
	})
}

// APIKeyAuthMiddleware authenticates requests using API keys
// API key can be provided via:
// - Authorization: Bearer pk_xxx header
// - X-API-Key: pk_xxx header
func APIKeyAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Check for API key in headers
		apiKey := ""

		// Try Authorization header first
		authHeader := c.GetHeader("Authorization")
		if strings.HasPrefix(authHeader, "Bearer pk_") {
			apiKey = strings.TrimPrefix(authHeader, "Bearer ")
		}

		// Try X-API-Key header
		if apiKey == "" {
			apiKey = c.GetHeader("X-API-Key")
		}

		// If no API key, continue to next middleware (might use JWT)
		if apiKey == "" || !strings.HasPrefix(apiKey, "pk_") {
			c.Next()
			return
		}

		// Hash the key to find it in database
		keyHash := models.HashAPIKey(apiKey)

		if db.DB == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
			c.Abort()
			return
		}

		var key models.APIKey
		if result := db.DB.Where("key_hash = ?", keyHash).First(&key); result.Error != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid API key",
				"code":  "invalid_api_key",
			})
			c.Abort()
			return
		}

		// Check if key is active
		if !key.IsActive() {
			reason := "revoked"
			if key.ExpiresAt != nil && time.Now().After(*key.ExpiresAt) {
				reason = "expired"
			}
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "API key is " + reason,
				"code":  "api_key_" + reason,
			})
			c.Abort()
			return
		}

		// Check rate limit
		if key.RateLimitPerMin > 0 {
			allowed, remaining, _ := redisClient.CheckAPIKeyRateLimit(key.KeyPrefix, key.RateLimitPerMin)

			// Set rate limit headers
			c.Header("X-RateLimit-Limit", strconv.Itoa(key.RateLimitPerMin))
			c.Header("X-RateLimit-Remaining", strconv.Itoa(remaining))
			c.Header("X-RateLimit-Reset", strconv.FormatInt(time.Now().Add(time.Minute).Unix(), 10))

			if !allowed {
				c.JSON(http.StatusTooManyRequests, gin.H{
					"error":       "Rate limit exceeded",
					"code":        "rate_limit_exceeded",
					"limit":       key.RateLimitPerMin,
					"retry_after": 60,
				})
				c.Abort()
				return
			}
		}

		// Update last used timestamp (async to not slow down request)
		go func() {
			key.UpdateLastUsed()
			db.DB.Model(&key).Update("last_used_at", key.LastUsedAt)
		}()

		// Set context values for downstream handlers
		c.Set("user_id", key.UserID.String())
		c.Set("api_key_id", key.ID.String())
		c.Set("api_key_permissions", key.Permissions)
		c.Set("api_key_rate_limit", key.RateLimitPerMin)
		c.Set("auth_type", "api_key")

		c.Next()
	}
}

// RequireAPIKeyPermission middleware checks if the API key has the required permission
func RequireAPIKeyPermission(permission models.APIKeyPermission) gin.HandlerFunc {
	return func(c *gin.Context) {
		authType := c.GetString("auth_type")

		// If not using API key, allow (JWT users have full access)
		if authType != "api_key" {
			c.Next()
			return
		}

		permissions, exists := c.Get("api_key_permissions")
		if !exists {
			c.JSON(http.StatusForbidden, gin.H{"error": "Permission denied"})
			c.Abort()
			return
		}

		perms := permissions.([]string)
		hasPermission := false
		for _, p := range perms {
			if p == string(permission) || p == string(models.PermissionAdmin) {
				hasPermission = true
				break
			}
		}

		if !hasPermission {
			c.JSON(http.StatusForbidden, gin.H{
				"error":    "API key does not have required permission",
				"required": string(permission),
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
