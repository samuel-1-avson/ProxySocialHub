package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisClient interface for both single and cluster clients
type RedisClient interface {
	Get(ctx context.Context, key string) *redis.StringCmd
	Set(ctx context.Context, key string, value interface{}, expiration time.Duration) *redis.StatusCmd
	Del(ctx context.Context, keys ...string) *redis.IntCmd
	IncrBy(ctx context.Context, key string, value int64) *redis.IntCmd
	Incr(ctx context.Context, key string) *redis.IntCmd
	MGet(ctx context.Context, keys ...string) *redis.SliceCmd
	ZRemRangeByScore(ctx context.Context, key, min, max string) *redis.IntCmd
	ZCard(ctx context.Context, key string) *redis.IntCmd
	ZAdd(ctx context.Context, key string, members ...redis.Z) *redis.IntCmd
	Expire(ctx context.Context, key string, expiration time.Duration) *redis.BoolCmd
	SetNX(ctx context.Context, key string, value interface{}, expiration time.Duration) *redis.BoolCmd
	Pipeline() redis.Pipeliner
	Ping(ctx context.Context) *redis.StatusCmd
	Close() error
	Scan(ctx context.Context, cursor uint64, match string, count int64) *redis.ScanCmd
	DecrBy(ctx context.Context, key string, decrement int64) *redis.IntCmd
}

var Client RedisClient
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

	// Check if this is a cluster configuration (comma-separated URLs)
	if strings.Contains(redisURL, ",") {
		return initCluster(redisURL)
	}

	// Single instance Redis
	return initSingle(redisURL)
}

// initSingle initializes a single Redis instance
func initSingle(redisURL string) error {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return fmt.Errorf("failed to parse Redis URL: %w", err)
	}

	client := redis.NewClient(opt)

	// Test connection
	if _, err := client.Ping(ctx).Result(); err != nil {
		return fmt.Errorf("failed to connect to Redis: %w", err)
	}

	Client = client
	return nil
}

// initCluster initializes Redis cluster
func initCluster(redisURL string) error {
	// Parse cluster URLs (comma-separated)
	addrs := strings.Split(redisURL, ",")

	// Clean up URLs (remove redis:// prefix if present)
	for i, addr := range addrs {
		addr = strings.TrimSpace(addr)
		if strings.HasPrefix(addr, "redis://") {
			addr = strings.TrimPrefix(addr, "redis://")
		}
		addrs[i] = addr
	}

	client := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs:           addrs,
		MaxRetries:      3,
		MinRetryBackoff: 8 * time.Millisecond,
		MaxRetryBackoff: 512 * time.Millisecond,
		DialTimeout:     5 * time.Second,
		ReadTimeout:     3 * time.Second,
		WriteTimeout:    3 * time.Second,
		PoolSize:        10,
		MinIdleConns:    5,
		ConnMaxLifetime: 30 * time.Minute,
		PoolTimeout:     4 * time.Second,
		ConnMaxIdleTime: 5 * time.Minute,
	})

	// Test connection
	if _, err := client.Ping(ctx).Result(); err != nil {
		return fmt.Errorf("failed to connect to Redis cluster: %w", err)
	}

	Client = client
	return nil
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

// GetBatchUsage retrieves usage for multiple sessions in a single round-trip (MGET)
func GetBatchUsage(sessionIDs []string) (map[string]int64, error) {
	if Client == nil || len(sessionIDs) == 0 {
		return map[string]int64{}, nil
	}

	// Construct keys
	keys := make([]string, len(sessionIDs))
	for i, id := range sessionIDs {
		keys[i] = "session:" + id + ":usage"
	}

	// MGET
	vals, err := Client.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, err
	}

	// Parse results
	result := make(map[string]int64)
	for i, val := range vals {
		sessionID := sessionIDs[i]
		if val == nil {
			result[sessionID] = 0
			continue
		}

		// Redis returns string or int depending on adapter, usually string for Go-Redis simple values
		switch v := val.(type) {
		case string:
			if parsed, err := strconv.ParseInt(v, 10, 64); err == nil {
				result[sessionID] = parsed
			} else {
				result[sessionID] = 0
			}
		case int64: // Sometimes specialized adapters might assume int
			result[sessionID] = v
		default:
			result[sessionID] = 0
		}
	}

	return result, nil
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
