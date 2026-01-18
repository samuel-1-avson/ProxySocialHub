package middleware

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/redis"
)

var ctx = context.Background()

// RateLimitConfig defines rate limiting configuration
type RateLimitConfig struct {
	// Requests per window
	Limit int
	// Window duration
	Window time.Duration
	// Key function to identify client (default: IP)
	KeyFunc func(*gin.Context) string
}

// DefaultRateLimitConfig returns sensible defaults
func DefaultRateLimitConfig() RateLimitConfig {
	return RateLimitConfig{
		Limit:  100,         // 100 requests
		Window: time.Minute, // per minute
		KeyFunc: func(c *gin.Context) string {
			// Use user ID if authenticated, otherwise IP
			if userID, exists := c.Get("userID"); exists {
				return "user:" + userID.(string)
			}
			return "ip:" + c.ClientIP()
		},
	}
}

// Stricter rate limit for auth endpoints
func AuthRateLimitConfig() RateLimitConfig {
	return RateLimitConfig{
		Limit:  10,          // 10 requests
		Window: time.Minute, // per minute
		KeyFunc: func(c *gin.Context) string {
			return "auth:" + c.ClientIP()
		},
	}
}

// RateLimit middleware using Redis token bucket
func RateLimit(config RateLimitConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		if redis.Client == nil {
			// Redis not available, skip rate limiting
			c.Next()
			return
		}

		key := "ratelimit:" + config.KeyFunc(c)

		// Get current count
		count, err := redis.Client.Incr(ctx, key).Result()
		if err != nil {
			// Redis error, allow request
			c.Next()
			return
		}

		// Set expiry on first request
		if count == 1 {
			redis.Client.Expire(ctx, key, config.Window)
		}

		// Check limit
		if count > int64(config.Limit) {
			c.Header("X-RateLimit-Limit", strconv.Itoa(config.Limit))
			c.Header("X-RateLimit-Remaining", "0")
			c.Header("X-RateLimit-Reset", strconv.FormatInt(time.Now().Add(config.Window).Unix(), 10))
			c.Header("Retry-After", strconv.Itoa(int(config.Window.Seconds())))

			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":       "Rate limit exceeded",
				"message":     "Too many requests. Please try again later.",
				"retry_after": int(config.Window.Seconds()),
			})
			c.Abort()
			return
		}

		// Set rate limit headers
		remaining := config.Limit - int(count)
		if remaining < 0 {
			remaining = 0
		}
		c.Header("X-RateLimit-Limit", strconv.Itoa(config.Limit))
		c.Header("X-RateLimit-Remaining", strconv.Itoa(remaining))

		c.Next()
	}
}

// RateLimitByEndpoint returns different limits for different endpoints
func RateLimitByEndpoint() gin.HandlerFunc {
	defaultConfig := DefaultRateLimitConfig()
	authConfig := AuthRateLimitConfig()

	return func(c *gin.Context) {
		path := c.FullPath()

		// Stricter limits for auth endpoints
		if path == "/v1/auth/login" || path == "/v1/auth/register" {
			RateLimit(authConfig)(c)
			return
		}

		// Default limits for everything else
		RateLimit(defaultConfig)(c)
	}
}
