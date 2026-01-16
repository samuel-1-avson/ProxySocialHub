package api

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// ========== Rate Limiting Middleware ==========

type rateLimiter struct {
	requests map[string]*requestCounter
	mu       sync.RWMutex
	limit    int           // Max requests per window
	window   time.Duration // Time window
}

type requestCounter struct {
	count     int
	expiresAt time.Time
}

var limiter *rateLimiter

func init() {
	limiter = &rateLimiter{
		requests: make(map[string]*requestCounter),
		limit:    100,              // 100 requests
		window:   time.Minute,      // per minute
	}

	// Cleanup goroutine
	go func() {
		ticker := time.NewTicker(time.Minute)
		for range ticker.C {
			limiter.cleanup()
		}
	}()
}

func (r *rateLimiter) cleanup() {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	for key, counter := range r.requests {
		if now.After(counter.expiresAt) {
			delete(r.requests, key)
		}
	}
}

func (r *rateLimiter) allow(key string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	counter, exists := r.requests[key]

	if !exists || now.After(counter.expiresAt) {
		r.requests[key] = &requestCounter{
			count:     1,
			expiresAt: now.Add(r.window),
		}
		return true
	}

	if counter.count >= r.limit {
		return false
	}

	counter.count++
	return true
}

func (r *rateLimiter) getRemaining(key string) int {
	r.mu.RLock()
	defer r.mu.RUnlock()

	counter, exists := r.requests[key]
	if !exists {
		return r.limit
	}

	if time.Now().After(counter.expiresAt) {
		return r.limit
	}

	return r.limit - counter.count
}

// RateLimitMiddleware limits requests per IP/user
func RateLimitMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Use user ID if authenticated, otherwise use IP
		key := c.GetString("userID")
		if key == "" {
			key = c.ClientIP()
		}

		if !limiter.allow(key) {
			remaining := limiter.getRemaining(key)
			c.Header("X-RateLimit-Limit", "100")
			c.Header("X-RateLimit-Remaining", "0")
			c.Header("Retry-After", "60")

			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":     "Rate limit exceeded",
				"limit":     limiter.limit,
				"remaining": remaining,
				"retry_after": 60,
			})
			c.Abort()
			return
		}

		remaining := limiter.getRemaining(key)
		c.Header("X-RateLimit-Limit", "100")
		c.Header("X-RateLimit-Remaining", string(rune(remaining)))

		c.Next()
	}
}

// RateLimitWithConfig creates a rate limiter with custom config
func RateLimitWithConfig(limit int, window time.Duration) gin.HandlerFunc {
	customLimiter := &rateLimiter{
		requests: make(map[string]*requestCounter),
		limit:    limit,
		window:   window,
	}

	return func(c *gin.Context) {
		key := c.GetString("userID")
		if key == "" {
			key = c.ClientIP()
		}

		if !customLimiter.allow(key) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":       "Rate limit exceeded",
				"retry_after": int(window.Seconds()),
			})
			c.Abort()
			return
		}
		c.Next()
	}
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

// ValidatePhone checks if phone number is valid (Ghana format)
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
