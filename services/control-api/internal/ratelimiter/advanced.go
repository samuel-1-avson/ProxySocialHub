package ratelimiter

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/redis"
)

// Algorithm defines the rate limiting algorithm
type Algorithm string

const (
	TokenBucket   Algorithm = "token_bucket"
	SlidingWindow Algorithm = "sliding_window"
	FixedWindow   Algorithm = "fixed_window"
)

// AdvancedRateLimitConfig defines advanced rate limiting configuration
type AdvancedRateLimitConfig struct {
	// Algorithm to use
	Algorithm Algorithm
	// Requests per window/bucket capacity
	Limit int
	// Window duration or refill interval
	Window time.Duration
	// Token bucket refill rate (tokens per second)
	RefillRate float64
	// Burst capacity for token bucket
	BurstCapacity int
	// Progressive penalty configuration
	PenaltyConfig PenaltyConfig
	// Key function to identify client
	KeyFunc func(*gin.Context) string
	// Skip function to bypass rate limiting for certain requests
	SkipFunc func(*gin.Context) bool
}

// PenaltyConfig defines progressive penalty system
type PenaltyConfig struct {
	// Enable progressive penalties
	Enabled bool
	// Base penalty duration
	BasePenalty time.Duration
	// Maximum penalty duration
	MaxPenalty time.Duration
	// Penalty multiplier for repeat offenders
	Multiplier float64
	// Time window to track violations
	ViolationWindow time.Duration
}

// TokenBucketState represents the state of a token bucket
type TokenBucketState struct {
	Tokens       float64   `json:"tokens"`
	LastRefill   time.Time `json:"last_refill"`
	Violations   int       `json:"violations"`
	LastViolation time.Time `json:"last_violation"`
	PenaltyUntil time.Time `json:"penalty_until"`
}

// SlidingWindowState represents the state of a sliding window
type SlidingWindowState struct {
	Requests     []time.Time `json:"requests"`
	Violations   int         `json:"violations"`
	LastViolation time.Time  `json:"last_violation"`
	PenaltyUntil time.Time   `json:"penalty_until"`
}

// DefaultAdvancedRateLimitConfig returns sensible defaults for advanced rate limiting
func DefaultAdvancedRateLimitConfig() AdvancedRateLimitConfig {
	return AdvancedRateLimitConfig{
		Algorithm:     TokenBucket,
		Limit:         100,
		Window:        time.Minute,
		RefillRate:    1.67, // ~100 tokens per minute
		BurstCapacity: 20,
		PenaltyConfig: PenaltyConfig{
			Enabled:         true,
			BasePenalty:     time.Minute * 5,
			MaxPenalty:      time.Hour,
			Multiplier:      2.0,
			ViolationWindow: time.Hour,
		},
		KeyFunc: func(c *gin.Context) string {
			if userID, exists := c.Get("userID"); exists {
				return "user:" + userID.(string)
			}
			return "ip:" + c.ClientIP()
		},
		SkipFunc: func(c *gin.Context) bool {
			// Skip rate limiting for health checks
			return c.Request.URL.Path == "/health"
		},
	}
}

// StrictAdvancedRateLimitConfig returns strict configuration for sensitive endpoints
func StrictAdvancedRateLimitConfig() AdvancedRateLimitConfig {
	config := DefaultAdvancedRateLimitConfig()
	config.Limit = 10
	config.RefillRate = 0.17 // ~10 tokens per minute
	config.BurstCapacity = 5
	config.PenaltyConfig.BasePenalty = time.Minute * 10
	config.KeyFunc = func(c *gin.Context) string {
		return "auth:" + c.ClientIP()
	}
	return config
}

// AdvancedRateLimit middleware with multiple algorithms and progressive penalties
func AdvancedRateLimit(config AdvancedRateLimitConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		if redis.Client == nil {
			logging.Warn().Msg("Redis not available, skipping advanced rate limiting")
			c.Next()
			return
		}

		// Skip if configured
		if config.SkipFunc != nil && config.SkipFunc(c) {
			c.Next()
			return
		}

		key := "advanced_ratelimit:" + config.KeyFunc(c)
		ctx := context.Background()

		var allowed bool
		var remaining int
		var resetTime time.Time
		var penaltyUntil time.Time

		switch config.Algorithm {
		case TokenBucket:
			allowed, remaining, resetTime, penaltyUntil = checkTokenBucket(ctx, key, config)
		case SlidingWindow:
			allowed, remaining, resetTime, penaltyUntil = checkSlidingWindow(ctx, key, config)
		case FixedWindow:
			allowed, remaining, resetTime, penaltyUntil = checkFixedWindow(ctx, key, config)
		default:
			logging.Error(fmt.Errorf("unknown algorithm: %s", config.Algorithm)).Msg("Rate limiting algorithm error")
			c.Next()
			return
		}

		// Set rate limit headers
		c.Header("X-RateLimit-Limit", strconv.Itoa(config.Limit))
		c.Header("X-RateLimit-Remaining", strconv.Itoa(remaining))
		c.Header("X-RateLimit-Reset", strconv.FormatInt(resetTime.Unix(), 10))
		c.Header("X-RateLimit-Algorithm", string(config.Algorithm))

		if !penaltyUntil.IsZero() && time.Now().Before(penaltyUntil) {
			// Client is under penalty
			retryAfter := int(time.Until(penaltyUntil).Seconds())
			c.Header("Retry-After", strconv.Itoa(retryAfter))
			c.Header("X-RateLimit-Penalty-Until", strconv.FormatInt(penaltyUntil.Unix(), 10))

			logging.Warn().
				Str("client", config.KeyFunc(c)).
				Str("algorithm", string(config.Algorithm)).
				Time("penalty_until", penaltyUntil).
				Msg("Request blocked due to penalty")

			c.JSON(429, gin.H{
				"error":       "rate_limit_penalty",
				"message":     "Too many violations. You are temporarily banned.",
				"retry_after": retryAfter,
				"penalty_until": penaltyUntil.Unix(),
			})
			c.Abort()
			return
		}

		if !allowed {
			retryAfter := int(time.Until(resetTime).Seconds())
			c.Header("Retry-After", strconv.Itoa(retryAfter))

			logging.Warn().
				Str("client", config.KeyFunc(c)).
				Str("algorithm", string(config.Algorithm)).
				Int("remaining", remaining).
				Msg("Rate limit exceeded")

			c.JSON(429, gin.H{
				"error":       "rate_limit_exceeded",
				"message":     "Rate limit exceeded. Please try again later.",
				"retry_after": retryAfter,
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// checkTokenBucket implements token bucket algorithm with Redis
func checkTokenBucket(ctx context.Context, key string, config AdvancedRateLimitConfig) (bool, int, time.Time, time.Time) {
	now := time.Now()
	
	// Get current state
	stateJSON, err := redis.Client.Get(ctx, key).Result()
	var state TokenBucketState
	
	if err != nil {
		// Initialize new bucket
		state = TokenBucketState{
			Tokens:     float64(config.BurstCapacity),
			LastRefill: now,
		}
	} else {
		if err := json.Unmarshal([]byte(stateJSON), &state); err != nil {
			logging.Error(err).Msg("Failed to unmarshal token bucket state")
			return true, config.Limit, now.Add(config.Window), time.Time{}
		}
	}

	// Check if client is under penalty
	if !state.PenaltyUntil.IsZero() && now.Before(state.PenaltyUntil) {
		return false, 0, now.Add(config.Window), state.PenaltyUntil
	}

	// Refill tokens based on elapsed time
	elapsed := now.Sub(state.LastRefill).Seconds()
	tokensToAdd := elapsed * config.RefillRate
	state.Tokens = math.Min(state.Tokens+tokensToAdd, float64(config.BurstCapacity))
	state.LastRefill = now

	// Check if request can be allowed
	if state.Tokens >= 1.0 {
		state.Tokens -= 1.0
		
		// Save state
		stateJSON, _ := json.Marshal(state)
		redis.Client.Set(ctx, key, string(stateJSON), config.Window*2)
		
		remaining := int(math.Floor(state.Tokens))
		resetTime := now.Add(time.Duration((float64(config.BurstCapacity)-state.Tokens)/config.RefillRate) * time.Second)
		return true, remaining, resetTime, time.Time{}
	}

	// Request denied - apply penalty if configured
	if config.PenaltyConfig.Enabled {
		state.Violations++
		state.LastViolation = now
		
		// Calculate penalty duration
		penaltyDuration := time.Duration(float64(config.PenaltyConfig.BasePenalty) * math.Pow(config.PenaltyConfig.Multiplier, float64(state.Violations-1)))
		if penaltyDuration > config.PenaltyConfig.MaxPenalty {
			penaltyDuration = config.PenaltyConfig.MaxPenalty
		}
		
		state.PenaltyUntil = now.Add(penaltyDuration)
		
		logging.Warn().
			Str("key", key).
			Int("violations", state.Violations).
			Dur("penalty_duration", penaltyDuration).
			Msg("Applied progressive penalty")
	}

	// Save state
	if stateData, err := json.Marshal(state); err == nil {
		redis.Client.Set(ctx, key, string(stateData), config.Window*2)
	}

	resetTime := now.Add(time.Duration((1.0-state.Tokens)/config.RefillRate) * time.Second)
	return false, 0, resetTime, state.PenaltyUntil
}

// checkSlidingWindow implements sliding window algorithm with Redis
func checkSlidingWindow(ctx context.Context, key string, config AdvancedRateLimitConfig) (bool, int, time.Time, time.Time) {
	now := time.Now()
	windowStart := now.Add(-config.Window)

	// Get current state
	stateJSON, err := redis.Client.Get(ctx, key).Result()
	var state SlidingWindowState
	
	if err != nil {
		state = SlidingWindowState{
			Requests: []time.Time{},
		}
	} else {
		if err := json.Unmarshal([]byte(stateJSON), &state); err != nil {
			logging.Error(err).Msg("Failed to unmarshal sliding window state")
			return true, config.Limit, now.Add(config.Window), time.Time{}
		}
	}

	// Check if client is under penalty
	if !state.PenaltyUntil.IsZero() && now.Before(state.PenaltyUntil) {
		return false, 0, now.Add(config.Window), state.PenaltyUntil
	}

	// Remove old requests outside the window
	validRequests := make([]time.Time, 0)
	for _, reqTime := range state.Requests {
		if reqTime.After(windowStart) {
			validRequests = append(validRequests, reqTime)
		}
	}
	state.Requests = validRequests

	// Check if request can be allowed
	if len(state.Requests) < config.Limit {
		state.Requests = append(state.Requests, now)
		
		// Save state
		stateJSON, _ := json.Marshal(state)
		redis.Client.Set(ctx, key, string(stateJSON), config.Window*2)
		
		remaining := config.Limit - len(state.Requests)
		resetTime := state.Requests[0].Add(config.Window)
		return true, remaining, resetTime, time.Time{}
	}

	// Request denied - apply penalty if configured
	if config.PenaltyConfig.Enabled {
		state.Violations++
		state.LastViolation = now
		
		// Calculate penalty duration
		penaltyDuration := time.Duration(float64(config.PenaltyConfig.BasePenalty) * math.Pow(config.PenaltyConfig.Multiplier, float64(state.Violations-1)))
		if penaltyDuration > config.PenaltyConfig.MaxPenalty {
			penaltyDuration = config.PenaltyConfig.MaxPenalty
		}
		
		state.PenaltyUntil = now.Add(penaltyDuration)
	}

	// Save state
	if stateData, err := json.Marshal(state); err == nil {
		redis.Client.Set(ctx, key, string(stateData), config.Window*2)
	}

	resetTime := state.Requests[0].Add(config.Window)
	return false, 0, resetTime, state.PenaltyUntil
}

// checkFixedWindow implements fixed window algorithm with Redis
func checkFixedWindow(ctx context.Context, key string, config AdvancedRateLimitConfig) (bool, int, time.Time, time.Time) {
	now := time.Now()
	windowStart := time.Unix(now.Unix()/int64(config.Window.Seconds())*int64(config.Window.Seconds()), 0)
	windowKey := fmt.Sprintf("%s:%d", key, windowStart.Unix())

	// Get current count
	count, err := redis.Client.Incr(ctx, windowKey).Result()
	if err != nil {
		logging.Error(err).Msg("Failed to increment fixed window counter")
		return true, config.Limit, windowStart.Add(config.Window), time.Time{}
	}

	// Set expiry on first request
	if count == 1 {
		redis.Client.Expire(ctx, windowKey, config.Window*2)
	}

	// Check if request can be allowed
	if count <= int64(config.Limit) {
		remaining := config.Limit - int(count)
		resetTime := windowStart.Add(config.Window)
		return true, remaining, resetTime, time.Time{}
	}

	// Request denied - handle penalty (simplified for fixed window)
	if config.PenaltyConfig.Enabled {
		penaltyKey := key + ":penalty"
		violations, _ := redis.Client.Incr(ctx, penaltyKey).Result()
		redis.Client.Expire(ctx, penaltyKey, config.PenaltyConfig.ViolationWindow)

		if violations > 3 { // Apply penalty after 3 violations
			penaltyDuration := time.Duration(float64(config.PenaltyConfig.BasePenalty) * math.Pow(config.PenaltyConfig.Multiplier, float64(violations-3)))
			if penaltyDuration > config.PenaltyConfig.MaxPenalty {
				penaltyDuration = config.PenaltyConfig.MaxPenalty
			}
			
			penaltyUntil := now.Add(penaltyDuration)
			redis.Client.Set(ctx, key+":penalty_until", penaltyUntil.Unix(), penaltyDuration)
			
			return false, 0, windowStart.Add(config.Window), penaltyUntil
		}
	}

	resetTime := windowStart.Add(config.Window)
	return false, 0, resetTime, time.Time{}
}

// RateLimitStats provides statistics about rate limiting
type RateLimitStats struct {
	Algorithm     string    `json:"algorithm"`
	TotalRequests int64     `json:"total_requests"`
	BlockedRequests int64   `json:"blocked_requests"`
	PenalizedClients int    `json:"penalized_clients"`
	LastReset     time.Time `json:"last_reset"`
}

// GetRateLimitStats returns rate limiting statistics
func GetRateLimitStats(ctx context.Context) (*RateLimitStats, error) {
	// This would typically aggregate stats from Redis
	// Implementation depends on specific monitoring requirements
	return &RateLimitStats{
		Algorithm:       "token_bucket",
		TotalRequests:   0,
		BlockedRequests: 0,
		PenalizedClients: 0,
		LastReset:       time.Now(),
	}, nil
}