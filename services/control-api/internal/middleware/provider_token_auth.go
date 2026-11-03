package middleware

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/authstate"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// ProviderTokenAuth middleware accepts either:
// 1. A Supabase JWT token (existing auth)
// 2. A provider token (for CLI authentication)
// This allows the CLI to use provider tokens for HTTP API calls
func ProviderTokenAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			c.Abort()
			return
		}

		// Extract token from "Bearer <token>"
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization header format"})
			c.Abort()
			return
		}
		token := parts[1]

		// Try to validate as Supabase JWT first
		userID, err := validateJWT(token)
		if err == nil {
			c.Set("user_id", userID)
			c.Set("auth_type", "jwt")
			c.Next()
			return
		}

		// Not a valid JWT — try as provider token
		providerToken, err := validateProviderToken(token)
		if err == nil {
			c.Set("user_id", providerToken.UserID)
			c.Set("token_id", providerToken.ID)
			c.Set("auth_type", "provider_token")
			go updateTokenLastUsed(providerToken.ID)
			c.Next()
			return
		}

		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
		c.Abort()
	}
}

// validateJWT validates a self-hosted JWT using JWT_SECRET (HS256).
// Returns the user's UUID string (sub claim) on success.
func validateJWT(tokenStr string) (string, error) {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		return "", errors.New("JWT_SECRET not configured")
	}

	parsed, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())

	if err != nil || !parsed.Valid {
		return "", errors.New("invalid JWT")
	}

	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		return "", errors.New("invalid JWT claims")
	}

	sub, ok := claims["sub"].(string)
	if !ok || sub == "" {
		return "", errors.New("missing sub claim")
	}

	if kind, _ := claims["knd"].(string); kind != "" {
		return "", errors.New("browser access token required")
	}
	sid, _ := claims["sid"].(string)
	if _, err := authstate.Validate(sub, sid, true); err != nil {
		return "", err
	}
	return sub, nil
}

// validateProviderToken validates a provider token against the database.
func validateProviderToken(rawToken string) (*models.ProviderToken, error) {
	hash := models.HashToken(rawToken)

	var token models.ProviderToken
	if err := db.DB.Where("token = ? AND is_active = ? AND deleted_at IS NULL",
		hash, true).First(&token).Error; err != nil {
		return nil, err
	}

	if token.ExpiresAt != nil && token.ExpiresAt.Before(time.Now()) {
		return nil, errors.New("token expired")
	}

	if _, err := authstate.Validate(token.UserID.String(), "", false); err != nil {
		return nil, err
	}
	return &token, nil
}

// updateTokenLastUsed updates the last_used timestamp asynchronously.
func updateTokenLastUsed(tokenID uuid.UUID) {
	db.DB.Model(&models.ProviderToken{}).
		Where("id = ?", tokenID).
		Update("last_used", time.Now())
}
