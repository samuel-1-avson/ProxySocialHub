package api

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterProviderTokenRoutes registers provider token management routes (protected)
func RegisterProviderTokenRoutes(rg *gin.RouterGroup) {
	tokens := rg.Group("/provider/tokens")
	{
		tokens.GET("", listProviderTokens)
		tokens.POST("", createProviderToken)
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
	ID        uuid.UUID  `json:"id"`
	Name      string     `json:"name"`
	Masked    string     `json:"masked"`
	IsActive  bool       `json:"is_active"`
	LastUsed  time.Time  `json:"last_used"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// listProviderTokens returns all tokens for the current user
func listProviderTokens(c *gin.Context) {
	currentUserID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	userID := currentUserID.(uuid.UUID)
	
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
		result[i] = TokenListItem{
			ID:        t.ID,
			Name:      t.Name,
			Masked:    maskToken(t.Token),
			IsActive:  t.IsActive,
			LastUsed:  t.LastUsed,
			ExpiresAt: t.ExpiresAt,
			CreatedAt: t.CreatedAt,
		}
	}
	
	c.JSON(http.StatusOK, gin.H{"tokens": result})
}

// CreateTokenRequest is the request to create a new token
type CreateTokenRequest struct {
	Name      string `json:"name" binding:"required,max=100"`
	ExpiresIn int    `json:"expires_in"` // Days until expiration, 0 = no expiration
}

// createProviderToken creates a new provider token
func createProviderToken(c *gin.Context) {
	currentUserID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	userID := currentUserID.(uuid.UUID)
	
	var req CreateTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	// Generate raw token
	rawToken, err := models.GenerateRawToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}
	
	// Hash token for storage using HMAC-SHA256 (keyed by TOKEN_HMAC_SECRET)
	hashedToken := models.HashToken(rawToken)
	
	// Calculate expiration
	var expiresAt *time.Time
	if req.ExpiresIn > 0 {
		exp := time.Now().Add(time.Duration(req.ExpiresIn) * 24 * time.Hour)
		expiresAt = &exp
	}
	
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
	currentUserID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	userID := currentUserID.(uuid.UUID)
	
	tokenID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid token ID"})
		return
	}
	
	// Soft delete - only user's own tokens
	result := db.DB.Where("id = ? AND user_id = ?", tokenID, userID).Delete(&models.ProviderToken{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Token not found"})
		return
	}
	
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
	NodeID   uuid.UUID `json:"node_id,omitempty"` // Node ID to use for registration
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
	
	jwtToken, err := crypto.GenerateToken(
		token.UserID,
		"provider",
		"", // No email for CLI tokens
		"", // No wallet for CLI tokens
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
// (JWT_SECRET env var) and claim names that tunnel.rs expects: user_id / role / exp.
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

	// Claims must match the struct expected by tunnel.rs:
	//   user_id string, role string, exp usize
	claims := jwt.MapClaims{
		"user_id": token.UserID.String(),
		"role":    "provider",
		"exp":     time.Now().Add(30 * 24 * time.Hour).Unix(), // 30 days
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
		"expires_in":    int((30 * 24 * time.Hour).Seconds()),
	})
}

// Helper functions

func maskToken(token string) string {
	if len(token) < 12 {
		return "****"
	}
	return token[:4] + "****" + token[len(token)-4:]
}

// getOrCreateNodeID returns an existing node ID or creates a new one
func getOrCreateNodeID(token models.ProviderToken) uuid.UUID {
	// Check if there's already a node registered with this token
	var registration models.ProviderNodeRegistration
	if err := db.DB.Where("token_id = ? AND is_active = ?", token.ID, true).
		First(&registration).Error; err == nil {
		return registration.NodeID
	}
	
	// Create new node
	node := models.Node{
		UserID:         token.UserID,  // Required by DB constraint
		ProviderUserID: token.UserID,
		IsHealthy:      true,
	}
	if err := db.DB.Create(&node).Error; err != nil {
		// Fallback - return a new UUID that won't be persisted
		return uuid.New()
	}
	
	// Create registration record
	registration = models.ProviderNodeRegistration{
		UserID:    token.UserID,
		TokenID:   token.ID,
		NodeID:    node.ID,
		FirstSeen: time.Now(),
		LastSeen:  time.Now(),
		IsActive:  true,
	}
	db.DB.Create(&registration)
	
	return node.ID
}
