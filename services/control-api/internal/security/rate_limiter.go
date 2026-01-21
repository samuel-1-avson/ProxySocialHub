// Package security provides rate limiting and security middleware
package security

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// RateLimiter implements a token bucket rate limiter
type RateLimiter struct {
	mu          sync.Mutex
	tokens      map[string]*bucket
	rate        int           // tokens per interval
	interval    time.Duration // refill interval
	maxTokens   int           // max tokens in bucket
	cleanupTick time.Duration // cleanup interval for expired entries
}

type bucket struct {
	tokens    int
	lastCheck time.Time
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(rate int, interval time.Duration, maxTokens int) *RateLimiter {
	rl := &RateLimiter{
		tokens:      make(map[string]*bucket),
		rate:        rate,
		interval:    interval,
		maxTokens:   maxTokens,
		cleanupTick: 5 * time.Minute,
	}

	// Start cleanup goroutine
	go rl.cleanup()

	return rl
}

// Allow checks if a request from the given key is allowed
func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	b, exists := rl.tokens[key]

	if !exists {
		rl.tokens[key] = &bucket{
			tokens:    rl.maxTokens - 1,
			lastCheck: now,
		}
		return true
	}

	// Refill tokens based on time elapsed
	elapsed := now.Sub(b.lastCheck)
	refill := int(elapsed/rl.interval) * rl.rate
	b.tokens = min(b.tokens+refill, rl.maxTokens)
	b.lastCheck = now

	if b.tokens > 0 {
		b.tokens--
		return true
	}

	return false
}

// RemainingTokens returns remaining tokens for a key
func (rl *RateLimiter) RemainingTokens(key string) int {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	if b, exists := rl.tokens[key]; exists {
		return b.tokens
	}
	return rl.maxTokens
}

// cleanup removes stale bucket entries
func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(rl.cleanupTick)
	defer ticker.Stop()

	for range ticker.C {
		rl.mu.Lock()
		threshold := time.Now().Add(-10 * time.Minute)
		for key, b := range rl.tokens {
			if b.lastCheck.Before(threshold) {
				delete(rl.tokens, key)
			}
		}
		rl.mu.Unlock()
	}
}

// Global rate limiters for different tiers
var (
	// Default rate limiter: 100 requests per minute
	DefaultLimiter = NewRateLimiter(100, time.Minute, 100)

	// API key rate limiter: Higher rate for authenticated apps
	APIKeyLimiter = NewRateLimiter(1000, time.Minute, 1000)

	// Strict rate limiter for sensitive endpoints
	StrictLimiter = NewRateLimiter(10, time.Minute, 10)
)

// RateLimitMiddleware returns a rate limiting middleware
func RateLimitMiddleware(limiter *RateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Use user ID if authenticated, otherwise IP
		key := c.ClientIP()
		if userID, exists := c.Get("user_id"); exists {
			key = userID.(string)
		}

		if !limiter.Allow(key) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":       "Rate limit exceeded",
				"retry_after": limiter.interval.Seconds(),
			})
			c.Abort()
			return
		}

		// Add rate limit headers
		c.Header("X-RateLimit-Remaining", string(rune(limiter.RemainingTokens(key))))
		c.Next()
	}
}

// SecurityHeaders adds security headers to responses
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Prevent clickjacking
		c.Header("X-Frame-Options", "DENY")
		// XSS protection
		c.Header("X-XSS-Protection", "1; mode=block")
		// Prevent MIME sniffing
		c.Header("X-Content-Type-Options", "nosniff")
		// Referrer policy
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		// Permissions policy
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")

		c.Next()
	}
}

// CSRFProtection provides CSRF protection for state-changing requests
func CSRFProtection() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Skip for safe methods
		if c.Request.Method == "GET" || c.Request.Method == "HEAD" || c.Request.Method == "OPTIONS" {
			c.Next()
			return
		}

		// Check for CSRF token in header
		token := c.GetHeader("X-CSRF-Token")
		if token == "" {
			// Also check for API key auth (exempt from CSRF)
			if _, exists := c.Get("api_key"); exists {
				c.Next()
				return
			}

			// For development, skip CSRF if explicitly disabled
			// In production, this should be removed
			if gin.Mode() == gin.DebugMode {
				c.Next()
				return
			}

			c.JSON(http.StatusForbidden, gin.H{"error": "CSRF token required"})
			c.Abort()
			return
		}

		// Validate token (simplified - in production use proper CSRF tokens)
		// This is a placeholder for actual CSRF validation
		c.Next()
	}
}

// IPWhitelist creates middleware that only allows specified IPs
func IPWhitelist(allowedIPs ...string) gin.HandlerFunc {
	allowed := make(map[string]bool)
	for _, ip := range allowedIPs {
		allowed[ip] = true
	}

	return func(c *gin.Context) {
		if !allowed[c.ClientIP()] {
			c.JSON(http.StatusForbidden, gin.H{"error": "IP not allowed"})
			c.Abort()
			return
		}
		c.Next()
	}
}

// AdminOnly restricts access to admin users
func AdminOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, exists := c.Get("user_role")
		if !exists || role != "admin" {
			c.JSON(http.StatusForbidden, gin.H{"error": "Admin access required"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
