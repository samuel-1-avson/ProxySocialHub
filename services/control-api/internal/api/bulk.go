package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
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
		// Proxy pool management
		bulk.POST("/pools", CreatePool)
		bulk.GET("/pools", ListPools)
		bulk.GET("/pools/:pool_id/endpoints", GetPoolEndpoints)
		bulk.DELETE("/pools/:pool_id", DeletePool)

		// API key management
		bulk.POST("/api-keys", CreateAPIKey)
		bulk.GET("/api-keys", ListAPIKeys)
		bulk.DELETE("/api-keys/:key_id", RevokeAPIKey)
	}
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
		password := fmt.Sprintf("%s-proxy-%03d", pool.ID.String(), i+1)
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

	// Build permission list
	scopes := req.Scopes
	if scopes == "" {
		scopes = "proxy:read,proxy:write"
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

	permissions := []string{"proxy:read", "proxy:write"}
	if scopes != "" {
		// Parse comma-separated scopes
		perms := []string{}
		start := 0
		for i := 0; i <= len(scopes); i++ {
			if i == len(scopes) || scopes[i] == ',' {
				tok := scopes[start:i]
				if tok != "" {
					perms = append(perms, tok)
				}
				start = i + 1
			}
		}
		if len(perms) > 0 {
			permissions = perms
		}
	}

	apiKey := models.APIKey{
		ID:          uuid.New(),
		UserID:      userID,
		Name:        req.Name,
		KeyHash:     keyHash,
		KeyPrefix:   keyPrefix,
		Permissions: permissions,
		ExpiresAt:   req.ExpiresAt,
	}

	if err := db.DB.Create(&apiKey).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create API key"})
		return
	}

	// Return the full key exactly once
	c.JSON(http.StatusCreated, gin.H{
		"key":        plaintextKey,
		"id":         apiKey.ID,
		"name":       apiKey.Name,
		"prefix":     keyPrefix,
		"scopes":     permissions,
		"expires_at": apiKey.ExpiresAt,
		"created_at": apiKey.CreatedAt,
	})
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

	c.Status(http.StatusNoContent)
}
