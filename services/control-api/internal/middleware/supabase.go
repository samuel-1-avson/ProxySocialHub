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
	"github.com/proxyhubb/control-api/internal/redis"
)

func authTokenFromRequest(c *gin.Context) string {
	authHeader := c.GetHeader("Authorization")
	if authHeader != "" {
		return strings.Replace(authHeader, "Bearer ", "", 1)
	}

	if cookieToken, err := c.Cookie("proxyhubb_token"); err == nil {
		return cookieToken
	}

	// Browsers cannot set Authorization headers on WebSocket handshakes, so the
	// realtime client passes the access token as ?token=. Restrict query-param
	// auth to genuine upgrade requests so regular API URLs never carry JWTs
	// (URL query strings are routinely logged).
	if isWebSocketUpgrade(c) {
		if t := strings.TrimSpace(c.Query("token")); t != "" {
			return t
		}
	}

	return ""
}

func isWebSocketUpgrade(c *gin.Context) bool {
	return strings.EqualFold(c.GetHeader("Upgrade"), "websocket") &&
		strings.Contains(strings.ToLower(c.GetHeader("Connection")), "upgrade")
}

// tryWSTicket resolves a short-lived single-use WS ticket (?ticket=) to auth
// context. Tickets keep JWTs out of URLs on upgrade requests.
func tryWSTicket(c *gin.Context) bool {
	if !isWebSocketUpgrade(c) {
		return false
	}
	ticket := strings.TrimSpace(c.Query("ticket"))
	if ticket == "" {
		return false
	}
	userID, role, err := redis.ConsumeWSTicket(ticket)
	if err != nil || userID == "" {
		return false
	}
	c.Set("userID", userID)
	if uid, err := uuid.Parse(userID); err == nil {
		c.Set("user_id", uid)
	}
	c.Set("userRole", role)
	c.Set("auth_type", "ws_ticket")
	return true
}

// SupabaseAuthMiddleware authenticates requests using the self-hosted JWT or
// provider CLI token. Supabase Auth is no longer used — all tokens are issued
// by this backend.
func SupabaseAuthMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Short-lived single-use WS ticket (preferred for upgrades — keeps JWT out of URL).
		if tryWSTicket(c) {
			c.Next()
			return
		}

		tokenString := authTokenFromRequest(c)

		if tokenString == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization header or auth cookie required"})
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
		// Short-lived single-use WS ticket (preferred for upgrades — keeps JWT out of URL).
		if tryWSTicket(c) {
			c.Next()
			return
		}

		tokenString := authTokenFromRequest(c)

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
