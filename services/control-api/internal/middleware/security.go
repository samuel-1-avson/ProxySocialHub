// internal/middleware/security.go
// Additional security middleware implementations

package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// RequestSizeLimiter limits request body size
type RequestSizeLimiter int64

func (l RequestSizeLimiter) Handle(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, int64(l))
	c.Next()
}

// ContentTypeValidator validates Content-Type header
type ContentTypeValidator []string

func (v ContentTypeValidator) Handle(c *gin.Context) {
	if c.Request.Method == "GET" || c.Request.Method == "DELETE" {
		c.Next()
		return
	}

	contentType := c.ContentType()
	
	// Allow empty content-type for GET/DELETE
	if contentType == "" {
		c.Next()
		return
	}

	for _, allowed := range v {
		if strings.HasPrefix(contentType, allowed) {
			c.Next()
			return
		}
	}

	c.JSON(http.StatusUnsupportedMediaType, gin.H{
		"error": "Content-Type not supported",
		"allowed": v,
	})
	c.Abort()
}

// StrictCORS returns production-ready CORS middleware
func StrictCORS(allowedOrigins []string, environment string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		
		allowed := false
		
		// Check whitelist
		for _, o := range allowedOrigins {
			if strings.TrimSpace(o) == origin {
				allowed = true
				break
			}
			// Support wildcard subdomains
			if strings.HasPrefix(o, "*.") {
				suffix := o[1:] // Remove *
				if strings.HasSuffix(origin, suffix) {
					allowed = true
					break
				}
			}
		}
		
		// Development fallback (only in development)
		if !allowed && environment == "development" && origin != "" {
			allowed = true
		}
		
		if allowed && origin != "" {
			c.Header("Access-Control-Allow-Origin", origin)
		}
		
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", 
			"Content-Type, Authorization, X-Requested-With, X-Session-ID, X-API-Key")
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Max-Age", "86400")
		
		// Security headers
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-XSS-Protection", "1; mode=block")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		
		c.Next()
	}
}

// RequireAdmin ensures user has admin role
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, exists := c.Get("userRole")
		if !exists {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Authentication required",
			})
			return
		}

		if role.(string) != "admin" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "Admin access required",
			})
			return
		}

		c.Next()
	}
}

// RequirePlatformModerator allows marketplace moderation for admin and moderator roles.
func RequirePlatformModerator() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, exists := c.Get("userRole")
		if !exists {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
			return
		}
		switch role.(string) {
		case "admin", "moderator", "superadmin":
			c.Next()
		default:
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Moderator access required"})
		}
	}
}

// SecurityHeaders adds security headers to all responses
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Prevent clickjacking
		c.Header("X-Frame-Options", "DENY")
		
		// Prevent MIME type sniffing
		c.Header("X-Content-Type-Options", "nosniff")
		
		// XSS protection
		c.Header("X-XSS-Protection", "1; mode=block")
		
		// Referrer policy
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		
		// HSTS (only in production)
		if os.Getenv("GO_ENV") == "production" {
			c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
		}
		
		// Content Security Policy
		// NOTE: If the frontend requires inline scripts/styles, implement nonce-based
		// CSP generation tied to the SSR render cycle instead of 'unsafe-inline'.
		csp := "default-src 'self'; " +
			"script-src 'self'; " +
			"style-src 'self'; " +
			"img-src 'self' data: https:; " +
			"font-src 'self'; " +
			"connect-src 'self'; " +
			"frame-ancestors 'none'; " +
			"base-uri 'self'; " +
			"form-action 'self';"
		c.Header("Content-Security-Policy", csp)
		
		// Permissions policy
		c.Header("Permissions-Policy", 
			"accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()")
		
		c.Next()
	}
}

// RequestID adds unique request ID for tracing
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" {
			requestID = generateRequestID()
		}
		
		c.Set("requestID", requestID)
		c.Header("X-Request-ID", requestID)
		
		c.Next()
	}
}

func generateRequestID() string {
	// Simple UUID-like generation
	// In production, use proper UUID library
	return "req_" + randomString(16)
}

func randomString(n int) string {
	// Use cryptographically secure random bytes, then hex-encode to get a readable string.
	// We need n/2 raw bytes to produce n hex characters; round up for odd n.
	raw := make([]byte, (n+1)/2)
	if _, err := rand.Read(raw); err != nil {
		// Extremely unlikely; fall back to a fixed placeholder rather than panic.
		return "req_fallback_id"
	}
	return hex.EncodeToString(raw)[:n]
}
