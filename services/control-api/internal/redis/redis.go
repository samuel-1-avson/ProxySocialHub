package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

var Client *redis.Client
var ctx = context.Background()

type SessionData struct {
	UserID         string    `json:"user_id"`
	SessionID      string    `json:"session_id"`
	ProviderID     string    `json:"provider_id"` // Added for billing
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

	if Client == nil {
		return nil
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

// GetTotalProviderUsage returns the total accumulated usage for a specific provider and buyer
// Keys: "usage:provider:{providerID}:buyer:{buyerAddress}"
func GetTotalProviderUsage(providerID, buyerAddress string) (int64, error) {
	if Client == nil {
		return 0, nil // Return 0 if redis not connected, or error
	}

	key := "usage:provider:" + providerID + ":buyer:" + buyerAddress
	val, err := Client.Get(ctx, key).Int64()
	if err == redis.Nil {
		return 0, nil
	}
	return val, err
}

// IncrementProviderUsage increments the usage counter for a specific provider-buyer pair
func IncrementProviderUsage(providerID, buyerAddress string, bytes int64) error {
	if Client == nil {
		return nil
	}

	key := "usage:provider:" + providerID + ":buyer:" + buyerAddress
	return Client.IncrBy(ctx, key, bytes).Err()
}

// IncrementNonce atomically increments and returns the nonce for a provider-buyer pair
// Keys: "nonce:provider:{providerID}:buyer:{buyerAddress}"
func IncrementNonce(providerID, buyerAddress string) (uint64, error) {
	if Client == nil {
		return 0, fmt.Errorf("redis client not initialized")
	}

	key := "nonce:provider:" + providerID + ":buyer:" + buyerAddress
	val, err := Client.Incr(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	return uint64(val), nil
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
	pipe.ZRemRangeByScore(ctx, key, "0", strconv.Itoa(int(windowStart)-1))

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
	Client.ZRemRangeByScore(ctx, key, "0", strconv.Itoa(int(windowStart)-1))
	count, err := Client.ZCard(ctx, key).Result()
	if err != nil && err != redis.Nil {
		return 0, 0, err
	}

	return count, 0, nil
}

// ========== Distributed Locking ==========

// AcquireLock attempts to acquire a lock key. Returns true if successful.
// Uses SET key value NX PX ttl
func AcquireLock(key string, value string, ttl time.Duration) (bool, error) {
	if Client == nil {
		return true, nil
	}
	success, err := Client.SetNX(ctx, "lock:"+key, value, ttl).Result()
	if err != nil {
		return false, err
	}
	return success, nil
}

// ReleaseLock releases a lock key.
// Ideally should check value, but for simple mutex within same request context, Del is often enough.
func ReleaseLock(key string) error {
	if Client == nil {
		return nil
	}
	return Client.Del(ctx, "lock:"+key).Err()
}
