package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// AuthMiddleware validates JWT tokens and extracts user information
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Get Authorization header
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Authorization header required",
			})
			return
		}

		// Check Bearer prefix
		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid authorization format. Use: Bearer <token>",
			})
			return
		}

		tokenString := parts[1]

		// Validate token
		claims, err := ValidateAccessToken(tokenString)
		if err != nil {
			if err == ErrExpiredToken {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
					"error": "Token has expired",
					"code":  "token_expired",
				})
				return
			}
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid token",
			})
			return
		}

		// Set user info in context for downstream handlers
		c.Set("userID", claims.UserID)
		c.Set("userRole", claims.Role)

		c.Next()
	}
}

// RequireRole creates middleware that requires specific roles
func RequireRole(allowedRoles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		role := c.GetString("userRole")
		if role == "" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "Access denied: no role found",
			})
			return
		}

		for _, allowedRole := range allowedRoles {
			if role == allowedRole {
				c.Next()
				return
			}
		}

		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"error": "Access denied: insufficient permissions",
		})
	}
}

// OptionalAuth allows requests without auth but still extracts user if present
func OptionalAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.Next()
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			c.Next()
			return
		}

		claims, err := ValidateAccessToken(parts[1])
		if err == nil {
			c.Set("userID", claims.UserID)
			c.Set("userRole", claims.Role)
		}

		c.Next()
	}
}
