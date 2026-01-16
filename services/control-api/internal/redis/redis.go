package redis

import (
	"context"
	"encoding/json"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
)

var Client *redis.Client
var ctx = context.Background()

type SessionData struct {
	UserID         string    `json:"user_id"`
	SessionID      string    `json:"session_id"`
	Type           string    `json:"type"`
	Status         string    `json:"status"`
	BandwidthLimit int64     `json:"bandwidth_limit"` // bytes
	BandwidthUsed  int64     `json:"bandwidth_used"`  // bytes
	TrustTier      string    `json:"trust_tier"`      // new, verified, premium
	TargetGeo      string    `json:"target_geo"`      // country/region targeting
	TargetISP      string    `json:"target_isp"`      // ISP targeting
	ExpiresAt      time.Time `json:"expires_at"`
	CreatedAt      time.Time `json:"created_at"`
}

func Init() error {
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
	}

	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return err
	}

	Client = redis.NewClient(opt)

	// Test connection
	_, err = Client.Ping(ctx).Result()
	return err
}

// StoreSession saves session data to Redis with TTL
func StoreSession(sessionID string, data *SessionData, ttl time.Duration) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}

	key := "session:" + sessionID
	return Client.Set(ctx, key, jsonData, ttl).Err()
}

// GetSession retrieves session data from Redis
func GetSession(sessionID string) (*SessionData, error) {
	key := "session:" + sessionID
	val, err := Client.Get(ctx, key).Result()
	if err != nil {
		return nil, err
	}

	var data SessionData
	if err := json.Unmarshal([]byte(val), &data); err != nil {
		return nil, err
	}

	return &data, nil
}

// DeleteSession removes a session from Redis
func DeleteSession(sessionID string) error {
	key := "session:" + sessionID
	return Client.Del(ctx, key).Err()
}

// IncrementUsage atomically adds bytes to session usage
func IncrementUsage(sessionID string, bytes int64) error {
	key := "session:" + sessionID + ":usage"
	return Client.IncrBy(ctx, key, bytes).Err()
}

// GetUsage retrieves current usage for a session
func GetUsage(sessionID string) (int64, error) {
	key := "session:" + sessionID + ":usage"
	return Client.Get(ctx, key).Int64()
}

// ========== API Key Rate Limiting ==========

// CheckAPIKeyRateLimit checks if the API key has exceeded its rate limit
// Uses a sliding window algorithm with 1-minute windows
// Returns: allowed (bool), remaining (int), error
func CheckAPIKeyRateLimit(keyPrefix string, maxRequests int) (bool, int, error) {
	if Client == nil {
		// Redis not available, allow request
		return true, maxRequests, nil
	}

	key := "ratelimit:apikey:" + keyPrefix
	now := time.Now().Unix()
	windowStart := now - 60 // 1 minute window

	pipe := Client.Pipeline()

	// Remove old entries outside the window
	pipe.ZRemRangeByScore(ctx, key, "0", string(rune(windowStart-1)))

	// Count requests in current window
	countCmd := pipe.ZCard(ctx, key)

	_, err := pipe.Exec(ctx)
	if err != nil && err != redis.Nil {
		return true, maxRequests, err // Allow on error, don't block
	}

	currentCount := countCmd.Val()

	if currentCount >= int64(maxRequests) {
		return false, 0, nil
	}

	// Add current request to the window
	Client.ZAdd(ctx, key, redis.Z{
		Score:  float64(now),
		Member: now,
	})

	// Set TTL on the key (cleanup after 2 minutes)
	Client.Expire(ctx, key, 2*time.Minute)

	remaining := int(int64(maxRequests) - currentCount - 1)
	if remaining < 0 {
		remaining = 0
	}

	return true, remaining, nil
}

// ResetAPIKeyRateLimit resets the rate limit counter for an API key
func ResetAPIKeyRateLimit(keyPrefix string) error {
	if Client == nil {
		return nil
	}
	key := "ratelimit:apikey:" + keyPrefix
	return Client.Del(ctx, key).Err()
}

// GetAPIKeyRateLimitInfo returns current rate limit info for an API key
func GetAPIKeyRateLimitInfo(keyPrefix string) (used int64, remaining int, error error) {
	if Client == nil {
		return 0, 0, nil
	}

	key := "ratelimit:apikey:" + keyPrefix
	now := time.Now().Unix()
	windowStart := now - 60

	// Clean old entries and count current
	Client.ZRemRangeByScore(ctx, key, "0", string(rune(windowStart-1)))
	count, err := Client.ZCard(ctx, key).Result()
	if err != nil && err != redis.Nil {
		return 0, 0, err
	}

	return count, 0, nil
}
