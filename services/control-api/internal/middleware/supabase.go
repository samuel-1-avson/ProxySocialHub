package middleware

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/crypto"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// SupabaseAuthMiddleware authenticates requests using the self-hosted JWT or
// provider CLI token. Supabase Auth is no longer used — all tokens are issued
// by this backend.
func SupabaseAuthMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenString := ""
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			tokenString = strings.Replace(authHeader, "Bearer ", "", 1)
		} else {
			// Fallback to query parameter (e.g. for WebSockets)
			tokenString = c.Query("token")
			if tokenString == "" {
				if cookieToken, err := c.Cookie("proxyhubb_token"); err == nil {
					tokenString = cookieToken
				}
			}
		}

		if tokenString == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization header or token parameter required"})
			return
		}

		// 1. Local JWT verification (wallet auth / email auth)
		if claims, err := crypto.ValidateToken(tokenString, cfg.Auth.JWTSecret); err == nil {
			c.Set("userID", claims.UserID)
			if uid, err := uuid.Parse(claims.UserID); err == nil {
				c.Set("user_id", uid)
			}
			c.Set("userEmail", claims.Email)
			c.Set("userRole", claims.Role)
			c.Next()
			return
		}

		// 2. Provider CLI token
		if providerToken, _ := validateProviderToken(tokenString); providerToken != nil {
			c.Set("userID", providerToken.UserID.String())
			c.Set("user_id", providerToken.UserID)
			c.Set("token_id", providerToken.ID)
			c.Set("userEmail", "")
			c.Set("userRole", "provider")
			c.Set("auth_type", "provider_token")
			go func() {
				db.DB.Model(&models.ProviderToken{}).
					Where("id = ?", providerToken.ID).
					Update("last_used", time.Now())
			}()
			c.Next()
			return
		}

		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
	}
}

// SupabaseAuthMiddlewareOptional validates the self-hosted JWT if present,
// but does not abort if missing — the request proceeds as a guest.
func SupabaseAuthMiddlewareOptional(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenString := ""
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			tokenString = strings.Replace(authHeader, "Bearer ", "", 1)
		} else {
			tokenString = c.Query("token")
			if tokenString == "" {
				if cookieToken, err := c.Cookie("proxyhubb_token"); err == nil {
					tokenString = cookieToken
				}
			}
		}

		if tokenString == "" {
			c.Next()
			return
		}

		if claims, err := crypto.ValidateToken(tokenString, cfg.Auth.JWTSecret); err == nil {
			c.Set("userID", claims.UserID)
			if uid, err := uuid.Parse(claims.UserID); err == nil {
				c.Set("user_id", uid)
			}
			c.Set("userEmail", claims.Email)
			c.Set("userRole", claims.Role)
		}

		// Provider CLI token fallback
		if _, exists := c.Get("user_id"); !exists {
			if providerToken, _ := validateProviderToken(tokenString); providerToken != nil {
				c.Set("userID", providerToken.UserID.String())
				c.Set("user_id", providerToken.UserID)
				c.Set("userRole", "provider")
				c.Set("auth_type", "provider_token")
			}
		}

		c.Next()
	}
}

// RequireAuth aborts if user is not authenticated
func RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, exists := c.Get("user_id"); !exists {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
			return
		}
		c.Next()
	}
}
