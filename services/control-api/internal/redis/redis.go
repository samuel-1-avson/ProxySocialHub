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
	IncrByFloat(ctx context.Context, key string, value float64) *redis.FloatCmd
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
	LPush(ctx context.Context, key string, values ...interface{}) *redis.IntCmd
	LTrim(ctx context.Context, key string, start, stop int64) *redis.StatusCmd
	LRange(ctx context.Context, key string, start, stop int64) *redis.StringSliceCmd
	SAdd(ctx context.Context, key string, members ...interface{}) *redis.IntCmd
	SRem(ctx context.Context, key string, members ...interface{}) *redis.IntCmd
	HGet(ctx context.Context, key, field string) *redis.StringCmd
	HSet(ctx context.Context, key string, values ...interface{}) *redis.IntCmd
	Publish(ctx context.Context, channel string, message interface{}) *redis.IntCmd
	Exists(ctx context.Context, keys ...string) *redis.IntCmd
}

const Nil = redis.Nil

var Client RedisClient
var ctx = context.Background()

type SessionData struct {
	UserID         string    `json:"user_id"`
	SessionID      string    `json:"session_id"`
	ProviderID     string    `json:"provider_id"`
	Type           string    `json:"type"`
	Status         string    `json:"status"`
	BandwidthLimit int64     `json:"bandwidth_limit"`
	BandwidthUsed  int64     `json:"bandwidth_used"`
	TrustTier      string    `json:"trust_tier"`
	TargetGeo      string    `json:"target_geo"`
	TargetISP      string    `json:"target_isp"`
	Strategy       string    `json:"strategy"`
	MaxPrice       float64   `json:"max_price"`
	ExpiresAt      time.Time `json:"expires_at"`
	CreatedAt      time.Time `json:"created_at"`
}

func Init() error {
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
	}
	if strings.Contains(redisURL, ",") {
		return initCluster(redisURL)
	}
	return initSingle(redisURL)
}

func initSingle(redisURL string) error {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return fmt.Errorf("failed to parse Redis URL: %w", err)
	}
	client := redis.NewClient(opt)
	if _, err := client.Ping(ctx).Result(); err != nil {
		return fmt.Errorf("failed to connect to Redis: %w", err)
	}
	Client = client
	return nil
}

func initCluster(redisURL string) error {
	addrs := strings.Split(redisURL, ",")
	for i, addr := range addrs {
		addr = strings.TrimSpace(addr)
		addr = strings.TrimPrefix(addr, "redis://")
		addrs[i] = addr
	}
	client := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: addrs,
	})
	if _, err := client.Ping(ctx).Result(); err != nil {
		return fmt.Errorf("failed to connect to Redis cluster: %w", err)
	}
	Client = client
	return nil
}

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

func DeleteSession(sessionID string) error {
	key := "session:" + sessionID
	return Client.Del(ctx, key).Err()
}

func SessionExists(sessionID string) (bool, error) {
	if Client == nil {
		return false, nil
	}
	key := "session:" + sessionID
	count, err := Client.Exists(ctx, key).Result()
	return count > 0, err
}

func Exists(key string) (bool, error) {
	if Client == nil {
		return false, nil
	}
	count, err := Client.Exists(ctx, key).Result()
	return count > 0, err
}

func IncrementUsage(sessionID string, bytes int64) error {
	key := "session:" + sessionID + ":usage"
	return Client.IncrBy(ctx, key, bytes).Err()
}

func GetUsage(sessionID string) (int64, error) {
	key := "session:" + sessionID + ":usage"
	return Client.Get(ctx, key).Int64()
}

func GetBatchUsage(sessionIDs []string) (map[string]int64, error) {
	if Client == nil || len(sessionIDs) == 0 {
		return map[string]int64{}, nil
	}
	keys := make([]string, len(sessionIDs))
	for i, id := range sessionIDs {
		keys[i] = "session:" + id + ":usage"
	}
	vals, err := Client.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, err
	}
	result := make(map[string]int64)
	for i, val := range vals {
		sessionID := sessionIDs[i]
		if val == nil {
			result[sessionID] = 0
			continue
		}
		switch v := val.(type) {
		case string:
			if parsed, err := strconv.ParseInt(v, 10, 64); err == nil {
				result[sessionID] = parsed
			}
		case int64:
			result[sessionID] = v
		}
	}
	return result, nil
}

func GetTotalProviderUsage(providerID, buyerAddress string) (int64, error) {
	if Client == nil {
		return 0, nil
	}
	key := "usage:provider:" + providerID + ":buyer:" + buyerAddress
	val, err := Client.Get(ctx, key).Int64()
	if err == redis.Nil {
		return 0, nil
	}
	return val, err
}

func IncrementProviderUsage(providerID, buyerAddress string, bytes int64) error {
	if Client == nil {
		return nil
	}
	key := "usage:provider:" + providerID + ":buyer:" + buyerAddress
	return Client.IncrBy(ctx, key, bytes).Err()
}

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

func CheckAPIKeyRateLimit(keyPrefix string, maxRequests int) (bool, int, error) {
	if Client == nil {
		return true, maxRequests, nil
	}
	key := "ratelimit:apikey:" + keyPrefix
	now := time.Now().Unix()
	windowStart := now - 60
	pipe := Client.Pipeline()
	pipe.ZRemRangeByScore(ctx, key, "0", strconv.Itoa(int(windowStart)-1))
	countCmd := pipe.ZCard(ctx, key)
	_, err := pipe.Exec(ctx)
	if err != nil && err != redis.Nil {
		return true, maxRequests, err
	}
	currentCount := countCmd.Val()
	if currentCount >= int64(maxRequests) {
		return false, 0, nil
	}
	Client.ZAdd(ctx, key, redis.Z{
		Score:  float64(now),
		Member: now,
	})
	Client.Expire(ctx, key, 2*time.Minute)
	remaining := int(int64(maxRequests) - currentCount - 1)
	if remaining < 0 {
		remaining = 0
	}
	return true, remaining, nil
}

func ResetAPIKeyRateLimit(keyPrefix string) error {
	if Client == nil {
		return nil
	}
	key := "ratelimit:apikey:" + keyPrefix
	return Client.Del(ctx, key).Err()
}

func GetAPIKeyRateLimitInfo(keyPrefix string) (used int64, remaining int, error error) {
	if Client == nil {
		return 0, 0, nil
	}
	key := "ratelimit:apikey:" + keyPrefix
	now := time.Now().Unix()
	windowStart := now - 60
	Client.ZRemRangeByScore(ctx, key, "0", strconv.Itoa(int(windowStart)-1))
	count, err := Client.ZCard(ctx, key).Result()
	if err != nil && err != redis.Nil {
		return 0, 0, err
	}
	return count, 0, nil
}

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

func ReleaseLock(key string) error {
	if Client == nil {
		return nil
	}
	return Client.Del(ctx, "lock:"+key).Err()
}
