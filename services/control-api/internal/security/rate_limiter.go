package security

import (
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// RateLimiter implements a token bucket rate limiter
type RateLimiter struct {
	tokens         map[string]*bucket
	mu             sync.RWMutex
	maxTokens      int
	refillRate     int           // tokens per second
	refillInterval time.Duration // how often to refill
	cleanupTicker  *time.Ticker
	stopCleanup    chan struct{}
}

type bucket struct {
	tokens    int
	lastCheck time.Time
}

// NewRateLimiter creates a new rate limiter
// maxTokens: maximum tokens per bucket (burst capacity)
// refillRate: tokens added per second
func NewRateLimiter(maxTokens, refillRate int) *RateLimiter {
	rl := &RateLimiter{
		tokens:         make(map[string]*bucket),
		maxTokens:      maxTokens,
		refillRate:     refillRate,
		refillInterval: time.Second,
		stopCleanup:    make(chan struct{}),
	}

	// Start cleanup goroutine to remove stale buckets
	rl.cleanupTicker = time.NewTicker(5 * time.Minute)
	go rl.cleanupLoop()

	return rl
}

func (rl *RateLimiter) cleanupLoop() {
	for {
		select {
		case <-rl.cleanupTicker.C:
			rl.cleanup()
		case <-rl.stopCleanup:
			rl.cleanupTicker.Stop()
			return
		}
	}
}

func (rl *RateLimiter) cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	staleTime := time.Now().Add(-10 * time.Minute)
	for key, b := range rl.tokens {
		if b.lastCheck.Before(staleTime) {
			delete(rl.tokens, key)
		}
	}
}

// Stop stops the cleanup goroutine
func (rl *RateLimiter) Stop() {
	close(rl.stopCleanup)
}

// Allow checks if a request from the given key should be allowed
func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	b, exists := rl.tokens[key]

	if !exists {
		// Create new bucket with max tokens
		rl.tokens[key] = &bucket{
			tokens:    rl.maxTokens - 1, // Use one token for this request
			lastCheck: now,
		}
		return true
	}

	// Refill tokens based on time elapsed
	elapsed := now.Sub(b.lastCheck)
	tokensToAdd := int(elapsed.Seconds()) * rl.refillRate
	b.tokens = min(b.tokens+tokensToAdd, rl.maxTokens)
	b.lastCheck = now

	// Check if we have tokens
	if b.tokens > 0 {
		b.tokens--
		return true
	}

	return false
}

// RemainingTokens returns remaining tokens for a key
func (rl *RateLimiter) RemainingTokens(key string) int {
	rl.mu.RLock()
	defer rl.mu.RUnlock()

	if b, exists := rl.tokens[key]; exists {
		return b.tokens
	}
	return rl.maxTokens
}

// Global rate limiters for different endpoints
var (
	AuthRateLimiter    *RateLimiter
	GeneralRateLimiter *RateLimiter
	initOnce           sync.Once
)

// InitRateLimiters initializes the global rate limiters
func InitRateLimiters() {
	initOnce.Do(func() {
		// Auth endpoints: 10 requests per minute (stricter)
		AuthRateLimiter = NewRateLimiter(10, 1) // 10 burst, 1/sec refill

		// General API: 100 requests per minute
		GeneralRateLimiter = NewRateLimiter(100, 10) // 100 burst, 10/sec refill

		log.Println("[SECURITY] Rate limiters initialized")
	})
}

// AuthRateLimit middleware for authentication endpoints
func AuthRateLimit() gin.HandlerFunc {
	if AuthRateLimiter == nil {
		InitRateLimiters()
	}

	return func(c *gin.Context) {
		// Use IP as the rate limit key
		key := c.ClientIP()

		if !AuthRateLimiter.Allow(key) {
			log.Printf("[SECURITY] Rate limit exceeded for IP=%s on auth endpoint", maskIP(key))
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":       "Too many requests. Please try again later.",
				"retry_after": 60,
			})
			return
		}

		// Add rate limit headers
		remaining := AuthRateLimiter.RemainingTokens(key)
		c.Header("X-RateLimit-Limit", "10")
		c.Header("X-RateLimit-Remaining", string(rune('0'+remaining)))

		c.Next()
	}
}

// GeneralRateLimit middleware for general API endpoints
func GeneralRateLimit() gin.HandlerFunc {
	if GeneralRateLimiter == nil {
		InitRateLimiters()
	}

	return func(c *gin.Context) {
		// Use IP + User ID as the rate limit key
		key := c.ClientIP()
		if userID, exists := c.Get("user_id"); exists {
			key = key + ":" + userID.(string)
		}

		if !GeneralRateLimiter.Allow(key) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":       "Too many requests. Please slow down.",
				"retry_after": 10,
			})
			return
		}

		c.Next()
	}
}

// maskIP masks an IP address for safe logging
func maskIP(ip string) string {
	if len(ip) <= 8 {
		return ip[:2] + "***"
	}
	return ip[:4] + "***"
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
