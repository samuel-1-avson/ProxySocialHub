package api

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterBulkRoutes wires all Bulk Proxy Pool API endpoints under the provided router group.
func RegisterBulkRoutes(protected *gin.RouterGroup) {
	bulk := protected.Group("/bulk")
	{
		// Proxy pool management (API keys must carry proxy:read / proxy:write)
		bulk.POST("/pools", requireBulkScope("proxy:write"), CreatePool)
		bulk.GET("/pools", requireBulkScope("proxy:read"), ListPools)
		bulk.GET("/pools/:pool_id/endpoints", requireBulkScope("proxy:read"), GetPoolEndpoints)
		bulk.DELETE("/pools/:pool_id", requireBulkScope("proxy:write"), DeletePool)

		// API key lifecycle is JWT/session only — never via another API key
		keys := bulk.Group("/api-keys")
		keys.Use(requireSessionAuthForKeyManagement())
		{
			keys.POST("", CreateAPIKey)
			keys.GET("", ListAPIKeys)
			keys.DELETE("/:key_id", RevokeAPIKey)
		}
	}
}

const maxBulkAPIKeys = 10

var allowedBulkScopes = map[string]struct{}{
	"proxy:read":    {},
	"proxy:write":   {},
	"orders:create": {},
}

const defaultOrdersCreateRateLimitPerMin = 20


// requireSessionAuthForKeyManagement blocks API-key auth from minting/listing/revoking keys.
func requireSessionAuthForKeyManagement() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetString("auth_type") == "api_key" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "API key management requires a user session (JWT), not an API key",
				"code":  "session_required",
			})
			return
		}
		c.Next()
	}
}

// requireBulkScope enforces proxy:* scopes for API-key callers. JWT/session callers pass.
func requireBulkScope(required string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetString("auth_type") != "api_key" {
			c.Next()
			return
		}
		raw, exists := c.Get("api_key_permissions")
		if !exists {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Permission denied"})
			return
		}
		perms, _ := raw.([]string)
		if bulkKeyHasScope(perms, required) {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"error":    "API key does not have required permission",
			"required": required,
		})
	}
}

func bulkKeyHasScope(perms []string, required string) bool {
	for _, p := range perms {
		p = strings.TrimSpace(p)
		if p == required || p == "admin" || p == string(models.PermissionAdmin) {
			return true
		}
		// write implies read for bulk pool operations
		if required == "proxy:read" && p == "proxy:write" {
			return true
		}
	}
	return false
}

func parseAllowedBulkScopes(scopes string) ([]string, error) {
	if strings.TrimSpace(scopes) == "" {
		return []string{"proxy:read", "proxy:write"}, nil
	}
	parts := strings.Split(scopes, ",")
	out := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, part := range parts {
		tok := strings.TrimSpace(part)
		if tok == "" {
			continue
		}
		if _, ok := allowedBulkScopes[tok]; !ok {
			return nil, fmt.Errorf("unsupported scope %q (allowed: proxy:read, proxy:write, orders:create)", tok)
		}
		if _, ok := seen[tok]; ok {
			continue
		}
		seen[tok] = struct{}{}
		out = append(out, tok)
	}
	if len(out) == 0 {
		return []string{"proxy:read", "proxy:write"}, nil
	}
	return out, nil
}

// ─── Request / response types ────────────────────────────────────────────────

type createPoolRequest struct {
	Name        string `json:"name" binding:"required,min=1,max=100"`
	Description string `json:"description"`
	Size        int    `json:"size"`
	SessionType string `json:"session_type"`
	BytesLimit  int64  `json:"bytes_limit"`
}

type bulkCreateAPIKeyRequest struct {
	Name      string     `json:"name" binding:"required,min=1,max=100"`
	Scopes    string     `json:"scopes"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
}

type poolEndpoint struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	SessionType string `json:"session_type"`
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// currentUserID extracts the authenticated user's UUID from the gin context.
// The Supabase middleware stores it as uuid.UUID under "user_id".
func currentUserID(c *gin.Context) (uuid.UUID, bool) {
	v, exists := c.Get("user_id")
	if !exists {
		return uuid.Nil, false
	}
	switch id := v.(type) {
	case uuid.UUID:
		return id, true
	case string:
		parsed, err := uuid.Parse(id)
		if err != nil {
			return uuid.Nil, false
		}
		return parsed, true
	}
	return uuid.Nil, false
}

// sha256hex returns the lower-case hex-encoded SHA-256 digest of s.
func sha256hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// bulkEndpointHMACSecret resolves the server-side key used to derive pool
// endpoint passwords. Staging/production require BULK_ENDPOINT_HMAC_SECRET or
// JWT_SECRET — the hardcoded fallback is development-only (BE-06 / SEC).
func bulkEndpointHMACSecret() (string, error) {
	secret := strings.TrimSpace(os.Getenv("BULK_ENDPOINT_HMAC_SECRET"))
	if secret == "" {
		secret = strings.TrimSpace(os.Getenv("JWT_SECRET"))
	}
	if secret != "" {
		return secret, nil
	}
	env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	switch env {
	case "", "development", "dev", "test", "local":
		return "proxyhubb-dev-bulk-endpoint-secret", nil
	default:
		return "", fmt.Errorf("BULK_ENDPOINT_HMAC_SECRET (or JWT_SECRET) required when APP_ENV=%s", env)
	}
}

// bulkEndpointPassword derives a stable per-endpoint secret from a server-side
// HMAC key so knowing only the pool UUID is not enough to reconstruct passwords.
func bulkEndpointPassword(poolID uuid.UUID, index int) (string, error) {
	secret, err := bulkEndpointHMACSecret()
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = fmt.Fprintf(mac, "%s:%d", poolID.String(), index)
	return hex.EncodeToString(mac.Sum(nil)), nil
}

// ─── Pool handlers ────────────────────────────────────────────────────────────

// CreatePool godoc
// POST /v1/bulk/pools
func CreatePool(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	var req createPoolRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Apply defaults
	if req.Size == 0 {
		req.Size = 10
	}
	if req.SessionType == "" {
		req.SessionType = "rotating"
	}

	// Validate
	if req.Size < 1 || req.Size > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "size must be between 1 and 100"})
		return
	}
	if req.SessionType != "rotating" && req.SessionType != "sticky" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session_type must be 'rotating' or 'sticky'"})
		return
	}

	pool := models.ProxyPool{
		ID:          uuid.New(),
		UserID:      userID,
		Name:        req.Name,
		Description: req.Description,
		Size:        req.Size,
		SessionType: req.SessionType,
		Status:      "active",
		BytesLimit:  req.BytesLimit,
	}

	if err := db.DB.Create(&pool).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create pool"})
		return
	}

	c.JSON(http.StatusCreated, pool)
}

// ListPools godoc
// GET /v1/bulk/pools
func ListPools(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	var pools []models.ProxyPool
	if err := db.DB.
		Where("user_id = ? AND status != ?", userID, "deleted").
		Order("created_at DESC").
		Find(&pools).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list pools"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"pools": pools,
		"total": len(pools),
	})
}

// GetPoolEndpoints godoc
// GET /v1/bulk/pools/:pool_id/endpoints
func GetPoolEndpoints(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	poolIDStr := c.Param("pool_id")
	poolID, err := uuid.Parse(poolIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid pool_id"})
		return
	}

	var pool models.ProxyPool
	if err := db.DB.Where("id = ? AND user_id = ? AND status != ?", poolID, userID, "deleted").
		First(&pool).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "pool not found"})
		return
	}

	// Build endpoint list
	poolShort := pool.ID.String()
	if len(poolShort) > 8 {
		poolShort = poolShort[:8]
	}

	proxyHost, proxyPort, _ := BuyerProxyConnectInfo()
	endpoints := make([]poolEndpoint, pool.Size)
	for i := 0; i < pool.Size; i++ {
		username := fmt.Sprintf("pool-%s-%03d", poolShort, i+1)
		password, err := bulkEndpointPassword(pool.ID, i+1)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
			return
		}
		endpoints[i] = poolEndpoint{
			Host:        proxyHost,
			Port:        proxyPort,
			Username:    username,
			Password:    password,
			SessionType: pool.SessionType,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"pool_id":   pool.ID,
		"endpoints": endpoints,
		"count":     len(endpoints),
	})
}

// DeletePool godoc
// DELETE /v1/bulk/pools/:pool_id
func DeletePool(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	poolIDStr := c.Param("pool_id")
	poolID, err := uuid.Parse(poolIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid pool_id"})
		return
	}

	result := db.DB.Model(&models.ProxyPool{}).
		Where("id = ? AND user_id = ?", poolID, userID).
		Update("status", "deleted")

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete pool"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "pool not found"})
		return
	}

	c.Status(http.StatusNoContent)
}

// ─── API key handlers ─────────────────────────────────────────────────────────

// CreateAPIKey godoc
// POST /v1/bulk/api-keys
func CreateAPIKey(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	var req bulkCreateAPIKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var activeCount int64
	if err := db.DB.Model(&models.APIKey{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Count(&activeCount).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check API key limit"})
		return
	}
	if activeCount >= maxBulkAPIKeys {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("Maximum of %d active API keys allowed. Please revoke an existing key first.", maxBulkAPIKeys),
			"code":  "max_keys_reached",
		})
		return
	}

	permissions, err := parseAllowedBulkScopes(req.Scopes)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Use the existing helper which generates a pk_<hex> key.
	// We want a phub_ prefix instead, so we generate manually.
	keyBytes := make([]byte, 32)
	if _, err := rand.Read(keyBytes); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate key"})
		return
	}
	plaintextKey := "phub_" + hex.EncodeToString(keyBytes)

	keyHash := sha256hex(plaintextKey)
	// Key prefix: "phub_" (5 chars) + first 8 hex chars = 13 chars total; store only 8 chars after prefix
	keyPrefix := plaintextKey[5:13] // first 8 hex chars of the random part

	apiKey := models.APIKey{
		ID:              uuid.New(),
		UserID:          userID,
		Name:            req.Name,
		KeyHash:         keyHash,
		KeyPrefix:       keyPrefix,
		Permissions:     permissions,
		RateLimitPerMin: rateLimitForBulkScopes(permissions),
		ExpiresAt:       req.ExpiresAt,
	}

	if err := db.DB.Create(&apiKey).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create API key"})
		return
	}

	actor := userID
	RecordAuditLog(c, models.AuditAPIKeyCreated, models.AuditSeverityInfo, &actor, "api_key", apiKey.ID.String(),
		fmt.Sprintf("Created API key %q scopes=%v rate=%d/min", apiKey.Name, permissions, apiKey.RateLimitPerMin), true)

	// Return the full key exactly once
	c.JSON(http.StatusCreated, gin.H{
		"key":                   plaintextKey,
		"id":                    apiKey.ID,
		"name":                  apiKey.Name,
		"prefix":                keyPrefix,
		"scopes":                permissions,
		"rate_limit_per_minute": apiKey.RateLimitPerMin,
		"expires_at":            apiKey.ExpiresAt,
		"created_at":            apiKey.CreatedAt,
	})
}

func rateLimitForBulkScopes(scopes []string) int {
	for _, s := range scopes {
		if s == "orders:create" {
			return defaultOrdersCreateRateLimitPerMin
		}
	}
	return 100
}

// ListAPIKeys godoc
// GET /v1/bulk/api-keys
func ListAPIKeys(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	var keys []models.APIKey
	if err := db.DB.
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Order("created_at DESC").
		Find(&keys).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list API keys"})
		return
	}

	// Build response — never include KeyHash, never include the full plaintext key
	type keyItem struct {
		ID          uuid.UUID  `json:"id"`
		Name        string     `json:"name"`
		KeyPrefix   string     `json:"key_prefix"`
		Permissions []string   `json:"permissions"`
		LastUsedAt  *time.Time `json:"last_used_at,omitempty"`
		ExpiresAt   *time.Time `json:"expires_at,omitempty"`
		CreatedAt   time.Time  `json:"created_at"`
	}

	items := make([]keyItem, len(keys))
	for i, k := range keys {
		items[i] = keyItem{
			ID:          k.ID,
			Name:        k.Name,
			KeyPrefix:   k.KeyPrefix,
			Permissions: k.Permissions,
			LastUsedAt:  k.LastUsedAt,
			ExpiresAt:   k.ExpiresAt,
			CreatedAt:   k.CreatedAt,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"api_keys": items,
		"total":    len(items),
	})
}

// RevokeAPIKey godoc
// DELETE /v1/bulk/api-keys/:key_id
func RevokeAPIKey(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	keyIDStr := c.Param("key_id")
	keyID, err := uuid.Parse(keyIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid key_id"})
		return
	}

	now := time.Now()
	result := db.DB.Model(&models.APIKey{}).
		Where("id = ? AND user_id = ? AND revoked_at IS NULL", keyID, userID).
		Update("revoked_at", now)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke API key"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "API key not found"})
		return
	}

	actor := userID
	RecordAuditLog(c, models.AuditAPIKeyRevoked, models.AuditSeverityInfo, &actor, "api_key", keyID.String(),
		"Revoked API key", true)

	c.Status(http.StatusNoContent)
}
