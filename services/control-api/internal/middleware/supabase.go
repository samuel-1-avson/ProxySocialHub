package middleware

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/authstate"
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
	userID, _, familyID, expiresAt, err := redis.ConsumeWSTicketSession(ticket)
	if err != nil || userID == "" {
		return false
	}
	role, err := authstate.Validate(userID, familyID, true)
	if err != nil || time.Now().After(expiresAt) {
		return false
	}
	c.Set("auth_session_id", familyID)
	c.Set("auth_expires_at", expiresAt)
	c.Set("userID", userID)
	if uid, err := uuid.Parse(userID); err == nil {
		c.Set("user_id", uid)
	}
	c.Set("userRole", role)
	c.Set("auth_type", "ws_ticket")
	return true
}

func bindAccountClaims(c *gin.Context, claims *crypto.CustomClaims) bool {
	if claims.Kind != "" && claims.Kind != crypto.TokenKindExtension && claims.Kind != crypto.TokenKindProviderNode {
		return false
	}
	role, err := authstate.Validate(claims.UserID, claims.SessionID, claims.Kind == "")
	if err != nil || !bindExtensionDeviceClaims(c, claims) {
		return false
	}
	c.Set("userID", claims.UserID)
	uid, err := uuid.Parse(claims.UserID)
	if err != nil {
		return false
	}
	c.Set("user_id", uid)
	c.Set("userRole", role)
	c.Set("auth_session_id", claims.SessionID)
	if claims.ExpiresAt != nil {
		c.Set("auth_expires_at", claims.ExpiresAt.Time)
	}
	markProviderNodeClaims(c, claims)
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
			if !bindAccountClaims(c, claims) {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "account or session inactive"})
				return
			}
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
			bindAccountClaims(c, claims)
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
