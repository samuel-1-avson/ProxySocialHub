package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// AuthMiddleware is deprecated. Use middleware.SupabaseAuthMiddleware instead.
// Left here only if needed for interface compatibility, but logic removed to prevent misuse.
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Legacy auth middleware called"})
	}
}

// RolePermissions defines the permissions for each role
var RolePermissions = map[string][]string{
	"admin": {
		"*",
		"admin:access",
		"system:monitor",
	},
	"moderator": {
		"admin:access", // Moderators can access admin panel
		"users:read",
		"reports:read",
		"reports:resolve",
	},
	"provider": {
		"profile:read",
		"profile:update",
		"provider:dashboard",
		"listings:create",
		"listings:update",
		"orders:read", // Can read orders for their services
	},
	"user": {
		"profile:read",
		"profile:update",
		"listings:read",
		"orders:create", // Can buy
		"orders:read",   // Can read their own orders
	},
}

// HasPermission checks if a role has a specific permission
func HasPermission(role, permission string) bool {
	perms, ok := RolePermissions[role]
	if !ok {
		return false
	}
	for _, p := range perms {
		if p == "*" || p == permission {
			return true
		}
	}
	return false
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

// RequirePermission creates middleware that requires a specific permission
func RequirePermission(permission string) gin.HandlerFunc {
	return func(c *gin.Context) {
		role := c.GetString("userRole")
		if role == "" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "Access denied: no role found",
			})
			return
		}

		if HasPermission(role, permission) {
			c.Next()
			return
		}

		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"error": "Access denied: insufficient permissions",
		})
	}
}

// OptionalAuth is deprecated.
func OptionalAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
	}
}
