package api

import (
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterProviderTokenRoutes registers provider token management routes (protected)
func RegisterProviderTokenRoutes(rg *gin.RouterGroup) {
	tokens := rg.Group("/provider/tokens")
	{
		tokens.GET("", listProviderTokens)
		tokens.POST("", createProviderToken)
		tokens.POST("/:id/rotate", rotateProviderToken)
		tokens.DELETE("/:id", revokeProviderToken)
	}
}

// RegisterProviderAuthRoute registers the public CLI auth endpoint (unprotected)
func RegisterProviderAuthRoute(rg *gin.RouterGroup) {
	// CLI authentication endpoint - used by CLI to validate tokens
	// This is PUBLIC because it's used to authenticate the CLI
	rg.POST("/provider/auth", validateProviderToken)
}

// RegisterGatewayTokenRoute registers the public gateway-token endpoint on the
// given (unauthenticated) router group. It validates its own provider token so
// it does not need a prior auth session.
func RegisterGatewayTokenRoute(rg *gin.RouterGroup) {
	rg.POST("/provider/gateway-token", issueGatewayToken)
}

// TokenResponse is the response when creating a token
// The raw token is ONLY returned once at creation
type TokenResponse struct {
	ID        uuid.UUID  `json:"id"`
	Name      string     `json:"name"`
	Token     string     `json:"token"` // Raw token - ONLY returned at creation
	IsActive  bool       `json:"is_active"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// TokenListItem is the safe version returned in lists
type TokenListItem struct {
	ID            uuid.UUID  `json:"id"`
	Name          string     `json:"name"`
	Masked        string     `json:"masked"`
	IsActive      bool       `json:"is_active"`
	LastUsed      time.Time  `json:"last_used"`
	ExpiresAt     *time.Time `json:"expires_at,omitempty"`
	ExpiresInDays int        `json:"expires_in_days"`
	ExpiresSoon   bool       `json:"expires_soon"`
	IsExpired     bool       `json:"is_expired"`
	CreatedAt     time.Time  `json:"created_at"`
}

const gatewayTokenTTL = 1 * time.Hour

// listProviderTokens returns all tokens for the current user
func listProviderTokens(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var tokens []models.ProviderToken
	if err := db.DB.Where("user_id = ? AND deleted_at IS NULL", userID).
		Order("created_at DESC").
		Find(&tokens).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch tokens"})
		return
	}

	// Convert to safe response format
	result := make([]TokenListItem, len(tokens))
	for i, t := range tokens {
		expiresInDays, expiresSoon, isExpired := tokenExpiryStatus(t.ExpiresAt)
		result[i] = TokenListItem{
			ID:            t.ID,
			Name:          t.Name,
			Masked:        maskToken(t.Token),
			IsActive:      t.IsActive,
			LastUsed:      t.LastUsed,
			ExpiresAt:     t.ExpiresAt,
			ExpiresInDays: expiresInDays,
			ExpiresSoon:   expiresSoon,
			IsExpired:     isExpired,
			CreatedAt:     t.CreatedAt,
		}
	}

	c.JSON(http.StatusOK, gin.H{"tokens": result})
}

// rotateProviderToken revokes an existing provider token and creates a fresh replacement.
func rotateProviderToken(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	tokenID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid token ID"})
		return
	}

	var oldToken models.ProviderToken
	if err := db.DB.Where("id = ? AND user_id = ? AND deleted_at IS NULL", tokenID, userID).First(&oldToken).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Token not found"})
		return
	}

	rawToken, err := models.GenerateRawToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}
	hashedToken := models.HashToken(rawToken)
	exp := time.Now().Add(30 * 24 * time.Hour)
	name := oldToken.Name
	if name == "" {
		name = "Rotated provider token"
	}

	newToken := models.ProviderToken{
		UserID:    userID,
		Token:     hashedToken,
		Name:      name,
		IsActive:  true,
		ExpiresAt: &exp,
	}

	tx := db.DB.Begin()
	if err := tx.Model(&oldToken).Update("is_active", false).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to revoke old token"})
		return
	}
	if err := tx.Delete(&oldToken).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to revoke old token"})
		return
	}
	if err := tx.Create(&newToken).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save new token"})
		return
	}
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to rotate token"})
		return
	}

	c.JSON(http.StatusCreated, TokenResponse{
		ID:        newToken.ID,
		Name:      newToken.Name,
		Token:     rawToken,
		IsActive:  newToken.IsActive,
		ExpiresAt: newToken.ExpiresAt,
		CreatedAt: newToken.CreatedAt,
	})
}

// CreateTokenRequest is the request to create a new token
type CreateTokenRequest struct {
	Name      string `json:"name" binding:"required,max=100"`
	ExpiresIn int    `json:"expires_in"` // Days until expiration, 0/blank = 30-day default, capped at 90
	// Optional: bind this token to an existing provider_nodes row so CLI
	// validate/heartbeat use that node_id (not a newly auto-created one).
	NodeID string `json:"node_id"`
}

// createProviderToken creates a new provider token
func createProviderToken(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var req CreateTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var bindNodeID uuid.UUID
	if strings.TrimSpace(req.NodeID) != "" {
		parsed, err := uuid.Parse(strings.TrimSpace(req.NodeID))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node_id"})
			return
		}
		var pn models.ProviderNode
		if err := db.DB.Where("id = ? AND user_id = ?", parsed, userID).First(&pn).Error; err != nil {
			// Diagnostic only: distinguish a deleted node, a wrong account,
			// and a genuinely unknown id. The response stays a plain 404.
			detail := "unknown id"
			var diag models.ProviderNode
			if derr := db.DB.Unscoped().Where("id = ?", parsed).First(&diag).Error; derr == nil {
				switch {
				case diag.DeletedAt.Valid:
					detail = "node is deleted"
				case diag.UserID != userID:
					detail = "node belongs to a different account"
				default:
					detail = "lookup mismatch"
				}
			}
			logging.Warn().
				Str("node_id", parsed.String()).
				Str("user_id", userID.String()).
				Str("detail", detail).
				Msg("createProviderToken: node lookup miss")
			c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
			return
		}
		bindNodeID = pn.ID
	}

	// Generate raw token
	rawToken, err := models.GenerateRawToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	// Hash token for storage using HMAC-SHA256 (keyed by TOKEN_HMAC_SECRET)
	hashedToken := models.HashToken(rawToken)

	// Calculate expiration (Token Auto-Rotation)
	expiresInDays := req.ExpiresIn
	if expiresInDays <= 0 {
		expiresInDays = 30 // Default to 30 days
	}
	if expiresInDays > 90 {
		expiresInDays = 90 // Cap at a maximum of 90 days
	}
	exp := time.Now().Add(time.Duration(expiresInDays) * 24 * time.Hour)
	expiresAt := &exp

	// Create token record
	token := models.ProviderToken{
		UserID:    userID,
		Token:     hashedToken,
		Name:      req.Name,
		IsActive:  true,
		ExpiresAt: expiresAt,
	}

	if err := db.DB.Create(&token).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save token"})
		return
	}

	if bindNodeID != uuid.Nil {
		// Deactivate prior tokens bound to this node so stale AppData api_keys fail closed.
		var priorRegs []models.ProviderNodeRegistration
		if err := db.DB.Where("node_id = ? AND user_id = ? AND is_active = ?", bindNodeID, userID, true).
			Find(&priorRegs).Error; err == nil {
			for _, reg := range priorRegs {
				_ = db.DB.Model(&models.ProviderToken{}).
					Where("id = ? AND user_id = ? AND id <> ?", reg.TokenID, userID, token.ID).
					Updates(map[string]interface{}{"is_active": false}).Error
				_ = db.DB.Model(&models.ProviderNodeRegistration{}).
					Where("id = ?", reg.ID).
					Update("is_active", false).Error
			}
		}

		registration := models.ProviderNodeRegistration{
			UserID:    userID,
			TokenID:   token.ID,
			NodeID:    bindNodeID,
			FirstSeen: time.Now(),
			LastSeen:  time.Now(),
			IsActive:  true,
		}
		if err := db.DB.Create(&registration).Error; err != nil {
			logging.Warn().Err(err).
				Str("token_id", token.ID.String()).
				Str("node_id", bindNodeID.String()).
				Msg("createProviderToken: failed to bind token to node")
		}
	}

	// Return response with raw token (only time it's shown)
	c.JSON(http.StatusCreated, TokenResponse{
		ID:        token.ID,
		Name:      token.Name,
		Token:     rawToken, // ONLY returned once
		IsActive:  token.IsActive,
		ExpiresAt: token.ExpiresAt,
		CreatedAt: token.CreatedAt,
	})
}

// revokeProviderToken revokes a provider token
func revokeProviderToken(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	tokenID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid token ID"})
		return
	}

	// Soft delete + mark inactive so gateway-token checks and ops scripts stay consistent.
	result := db.DB.Model(&models.ProviderToken{}).
		Where("id = ? AND user_id = ?", tokenID, userID).
		Updates(map[string]interface{}{"is_active": false})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Token not found"})
		return
	}
	_ = db.DB.Where("id = ? AND user_id = ?", tokenID, userID).Delete(&models.ProviderToken{}).Error

	c.JSON(http.StatusOK, gin.H{"message": "Token revoked successfully"})
}

// ValidateTokenRequest is the request from CLI to validate a token
type ValidateTokenRequest struct {
	Token   string `json:"token" binding:"required"`
	Version string `json:"cli_version"` // CLI version for tracking
}

// ValidateTokenResponse is the response to CLI
type ValidateTokenResponse struct {
	Valid    bool      `json:"valid"`
	UserID   uuid.UUID `json:"user_id,omitempty"`
	TokenID  uuid.UUID `json:"token_id,omitempty"`
	Message  string    `json:"message,omitempty"`
	NodeID   uuid.UUID `json:"node_id,omitempty"`   // Node ID to use for registration
	JWTToken string    `json:"jwt_token,omitempty"` // JWT for subsequent authenticated requests
}

// validateProviderToken validates a token (called by CLI)
func validateProviderToken(c *gin.Context) {
	var req ValidateTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"valid": false, "message": err.Error()})
		return
	}

	// Hash the provided token using the same HMAC-SHA256 function
	hashedToken := models.HashToken(req.Token)

	// Find token
	var token models.ProviderToken
	if err := db.DB.Where("token = ? AND is_active = ? AND deleted_at IS NULL",
		hashedToken, true).First(&token).Error; err != nil {
		c.JSON(http.StatusUnauthorized, ValidateTokenResponse{
			Valid:   false,
			Message: "Invalid token",
		})
		return
	}

	// Check expiration
	if token.ExpiresAt != nil && time.Now().After(*token.ExpiresAt) {
		c.JSON(http.StatusUnauthorized, ValidateTokenResponse{
			Valid:   false,
			Message: "Token expired",
		})
		return
	}

	// Update last used
	token.LastUsed = time.Now()
	db.DB.Save(&token)

	// Generate or get node ID for this token
	nodeID := getOrCreateNodeID(token)

	// Generate a JWT token for subsequent authenticated requests
	// Use the same JWT secret as the main auth system
	cfg, err := config.Load()
	if err != nil {
		c.JSON(http.StatusInternalServerError, ValidateTokenResponse{
			Valid:   false,
			Message: "Failed to load config",
		})
		return
	}

	// BE-HIGH-02: mint a provider-node JWT, not a full user session. The kind claim
	// lets RestrictProviderToken confine it to the routes a headless node uses.
	jwtToken, err := crypto.GenerateProviderNodeToken(
		token.UserID,
		cfg.Auth.JWTSecret,
		30*24*time.Hour, // 30 days
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, ValidateTokenResponse{
			Valid:   false,
			Message: "Failed to generate JWT",
		})
		return
	}

	c.JSON(http.StatusOK, ValidateTokenResponse{
		Valid:    true,
		UserID:   token.UserID,
		TokenID:  token.ID,
		NodeID:   nodeID,
		JWTToken: jwtToken,
		Message:  "Token valid",
	})
}

// issueGatewayToken exchanges a provider API token for a short-lived JWT that
// the edge gateway tunnel server accepts.  The JWT uses the same HS256 secret
// (JWT_SECRET env var) and claim names that tunnel.rs expects: sub / role / exp.
func issueGatewayToken(c *gin.Context) {
	var req ValidateTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hashedToken := models.HashToken(req.Token)

	var token models.ProviderToken
	if err := db.DB.Where("token = ? AND is_active = ? AND deleted_at IS NULL",
		hashedToken, true).First(&token).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or inactive provider token"})
		return
	}

	if token.ExpiresAt != nil && time.Now().After(*token.ExpiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Provider token expired"})
		return
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		log.Printf("ERROR: JWT_SECRET env var is not set")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error: security misconfiguration"})
		return
	}

	now := time.Now()

	// Claims must match the struct expected by tunnel.rs:
	//   sub string, role string, exp usize
	//
	// knd marks this as a provider-node token. The node sends this same JWT to the control API
	// (leases, node list and heartbeats), and the auth middleware only accepts a token with no
	// kind when it carries a login session (sid); this one never does. With the kind set it is
	// checked against the account alone and confined to the node routes (RestrictProviderToken).
	claims := jwt.MapClaims{
		"sub":     token.UserID.String(),
		"user_id": token.UserID.String(), // Backward compatibility for legacy consumers.
		"role":    "provider",
		"knd":     crypto.TokenKindProviderNode,
		"iat":     now.Unix(),
		"exp":     now.Add(gatewayTokenTTL).Unix(),
		"iss":     "proxyhubb-control-api",
	}
	gatewayJWT, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(jwtSecret))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to issue gateway token"})
		return
	}

	// Update last used
	token.LastUsed = time.Now()
	db.DB.Save(&token)

	c.JSON(http.StatusOK, gin.H{
		"gateway_token": gatewayJWT,
		"user_id":       token.UserID,
		"expires_in":    int(gatewayTokenTTL.Seconds()),
	})
}

// Helper functions

func maskToken(token string) string {
	if len(token) < 12 {
		return "****"
	}
	return token[:4] + "****" + token[len(token)-4:]
}

func tokenExpiryStatus(expiresAt *time.Time) (int, bool, bool) {
	if expiresAt == nil {
		return 0, false, false
	}
	now := time.Now()
	if now.After(*expiresAt) {
		return 0, false, true
	}
	days := int(time.Until(*expiresAt).Hours() / 24)
	if days < 1 {
		days = 1
	}
	return days, days <= 7, false
}

// getOrCreateNodeID returns the canonical provider_nodes.id for a CLI token.
// New registrations create provider_nodes rows only (P2); legacy registrations
// that still point at nodes.id are resolved via provider_node_id or migration.
func getOrCreateNodeID(token models.ProviderToken) uuid.UUID {
	var registration models.ProviderNodeRegistration
	if err := db.DB.Where("token_id = ? AND is_active = ?", token.ID, true).
		First(&registration).Error; err == nil {
		if id := resolveRegistrationNodeID(registration.NodeID, token.UserID); id != uuid.Nil {
			return id
		}
	}

	return createProviderNodeForToken(token)
}

func resolveRegistrationNodeID(storedID, userID uuid.UUID) uuid.UUID {
	if storedID == uuid.Nil {
		return uuid.Nil
	}

	var pn models.ProviderNode
	if err := db.DB.Where("id = ? AND user_id = ?", storedID, userID).First(&pn).Error; err == nil {
		return pn.ID
	}

	var legacy models.Node
	if err := db.DB.Where("id = ? AND provider_user_id = ?", storedID, userID).First(&legacy).Error; err != nil {
		return uuid.Nil
	}
	if legacy.ProviderNodeID != nil && *legacy.ProviderNodeID != uuid.Nil {
		return *legacy.ProviderNodeID
	}

	return migrateLegacyNodeToProviderNode(legacy)
}

func migrateLegacyNodeToProviderNode(legacy models.Node) uuid.UUID {
	gatewayID := legacy.GatewayNodeID
	if gatewayID == "" {
		gatewayID = providerGatewayNodeID(legacy.ProviderUserID)
	}

	pn := models.ProviderNode{
		ID:             uuid.New(),
		UserID:         legacy.ProviderUserID,
		Name:           "Migrated CLI Node",
		IPAddress:      legacy.IPAddress,
		Country:        legacy.CountryCode,
		City:           legacy.City,
		Region:         legacy.Region,
		ISP:            legacy.ISP,
		ConnectionType: legacy.ConnectionType,
		Port:           legacy.Port,
		Status:         models.NodeOffline,
		GatewayNodeID:  gatewayID,
		IsHealthy:      legacy.IsHealthy,
	}
	if err := db.DB.Create(&pn).Error; err != nil {
		return uuid.Nil
	}

	_ = db.DB.Model(&legacy).Update("provider_node_id", pn.ID).Error
	return pn.ID
}

func createProviderNodeForToken(token models.ProviderToken) uuid.UUID {
	gatewayID := providerGatewayNodeID(token.UserID)
	pn := models.ProviderNode{
		ID:            uuid.New(),
		UserID:        token.UserID,
		Name:          "CLI Node",
		Status:        models.NodeOffline,
		GatewayNodeID: gatewayID,
		IsHealthy:     false,
	}
	if err := db.DB.Create(&pn).Error; err != nil {
		return uuid.New()
	}

	ensureNodePayoutWallet(pn.ID, token.UserID)

	registration := models.ProviderNodeRegistration{
		UserID:    token.UserID,
		TokenID:   token.ID,
		NodeID:    pn.ID,
		FirstSeen: time.Now(),
		LastSeen:  time.Now(),
		IsActive:  true,
	}
	_ = db.DB.Create(&registration).Error

	return pn.ID
}
