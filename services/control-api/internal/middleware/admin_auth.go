package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/config"
	"github.com/proxyhubb/control-api/internal/crypto"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

// AdminAuthMiddleware validates tokens signed with the admin JWT secret.
// It is completely separate from the Supabase/user auth middleware.
func AdminAuthMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenString := ""
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			tokenString = strings.TrimPrefix(authHeader, "Bearer ")
		}

		if tokenString == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Admin authorization required"})
			return
		}

		// BE-HIGH-04: with no admin secret configured, a token signed with an empty key would
		// validate, so anyone could mint an admin token. Refuse to authenticate at all.
		if strings.TrimSpace(cfg.Admin.JWTSecret) == "" {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "Admin authentication is not configured"})
			return
		}

		claims, err := crypto.ValidateToken(tokenString, cfg.Admin.JWTSecret)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired admin token"})
			return
		}

		// Verify this is actually an admin token (not a user JWT that leaked in)
		if claims.Role != "admin" && claims.Role != "superadmin" && claims.Role != "sysops" && claims.Role != "support" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Insufficient admin privileges"})
			return
		}

		// A logged-out or force-invalidated session carries a revoked jti.
		if claims.ID != "" && redisClient.IsAdminSessionBlocked(claims.ID) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Admin session has been revoked"})
			return
		}
		c.Set("adminJTI", claims.ID)
		if claims.ExpiresAt != nil {
			c.Set("adminTokenExp", claims.ExpiresAt.Time)
		}

		// Set context values consumed by RequirePermission / RequireRole
		c.Set("userID", claims.UserID)
		c.Set("userEmail", claims.Email)
		c.Set("userRole", "admin") // All admin accounts map to "admin" role for RBAC
		c.Set("adminUsername", claims.Email)
		c.Set("adminRole", claims.Role) // Granular role: superadmin | sysops | support
		c.Set("user_id", claims.UserID)

		c.Next()
	}
}
