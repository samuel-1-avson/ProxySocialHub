package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/ratelimiter"
	"github.com/proxyhubb/control-api/internal/redis"
)

// ========== Redis-Backed Rate Limiting Middleware ==========
// This implementation uses Redis for distributed rate limiting,
// allowing horizontal scaling across multiple API instances.
// Falls back to in-memory if Redis is unavailable.

// RateLimitMiddleware provides distributed rate limiting using Redis
func RateLimitMiddleware() gin.HandlerFunc {
	// Use the advanced rate limiter with sensible defaults
	config := ratelimiter.DefaultAdvancedRateLimitConfig()
	config.Limit = 100
	config.Window = time.Minute
	config.BurstCapacity = 20

	return ratelimiter.AdvancedRateLimit(config)
}

// RateLimitWithConfig creates a rate limiter with custom config
// Deprecated: Use ratelimiter.AdvancedRateLimit directly for more control
func RateLimitWithConfig(limit int, window time.Duration) gin.HandlerFunc {
	config := ratelimiter.AdvancedRateLimitConfig{
		Algorithm:     ratelimiter.TokenBucket,
		Limit:         limit,
		Window:        window,
		BurstCapacity: limit / 2,
		RefillRate:    float64(limit) / window.Seconds(),
		KeyFunc: func(c *gin.Context) string {
			if userID, exists := c.Get("userID"); exists {
				return "user:" + userID.(string)
			}
			return "ip:" + c.ClientIP()
		},
	}
	return ratelimiter.AdvancedRateLimit(config)
}

// StrictRateLimit provides stricter rate limiting for sensitive endpoints
func StrictRateLimit() gin.HandlerFunc {
	return ratelimiter.AdvancedRateLimit(ratelimiter.StrictAdvancedRateLimitConfig())
}

// IsRateLimiterHealthy checks if the rate limiting backend (Redis) is available
func IsRateLimiterHealthy() bool {
	return redis.Client != nil
}

// GetRateLimitStatus returns the current rate limit status for a key
func GetRateLimitStatus(key string) (limit, remaining int, resetTime time.Time, err error) {
	// This is a simplified status check
	// In production, you might want to query actual Redis state
	return 100, 100, time.Now().Add(time.Minute), nil
}

// ========== Input Validation Middleware ==========

// InputValidationMiddleware validates common input patterns
func InputValidationMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Check Content-Type for POST/PUT requests
		if c.Request.Method == "POST" || c.Request.Method == "PUT" || c.Request.Method == "PATCH" {
			contentType := c.GetHeader("Content-Type")
			if contentType != "" &&
				contentType != "application/json" &&
				contentType != "application/x-www-form-urlencoded" &&
				contentType != "multipart/form-data" {
				c.JSON(http.StatusUnsupportedMediaType, gin.H{
					"error": "Unsupported Content-Type",
				})
				c.Abort()
				return
			}
		}

		// Check for oversized requests (10MB max)
		if c.Request.ContentLength > 10*1024*1024 {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{
				"error":     "Request body too large",
				"max_bytes": 10 * 1024 * 1024,
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// ValidateUUID validates UUID path parameters
func ValidateUUID(paramName string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param(paramName)
		if id == "" {
			c.Next()
			return
		}

		// Simple UUID format check
		if len(id) != 36 {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "Invalid UUID format",
				"param":   paramName,
				"message": "UUID must be 36 characters",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// ValidateEmail checks if email parameter is valid
func ValidateEmail(email string) bool {
	// Basic email validation
	if len(email) < 5 || len(email) > 254 {
		return false
	}
	atIndex := -1
	for i, c := range email {
		if c == '@' {
			atIndex = i
			break
		}
	}
	if atIndex < 1 || atIndex > len(email)-4 {
		return false
	}
	return true
}

// ValidatePhone checks if phone number is valid
func ValidatePhone(phone string) bool {
	if len(phone) < 10 || len(phone) > 15 {
		return false
	}
	for _, c := range phone {
		if (c < '0' || c > '9') && c != '+' && c != ' ' && c != '-' {
			return false
		}
	}
	return true
}

// SanitizeInput removes potentially dangerous characters
func SanitizeInput(input string) string {
	// Remove null bytes and other control characters
	result := make([]byte, 0, len(input))
	for i := 0; i < len(input); i++ {
		if input[i] >= 32 || input[i] == '\t' || input[i] == '\n' || input[i] == '\r' {
			result = append(result, input[i])
		}
	}
	return string(result)
}

// SecureHeaders adds security headers
func SecureHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-XSS-Protection", "1; mode=block")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("Cache-Control", "no-store")
		c.Next()
	}
}
