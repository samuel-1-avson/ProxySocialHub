package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	SessionKeyPrefix = "session:"
	SessionTTL       = 5 * time.Minute

	UserKeyPrefix = "user:"
	UserTTL       = 10 * time.Minute

	// Discovery Caching
	DiscoveryKeyPrefix  = "discovery:"
	DiscoveryFiltersTTL = 1 * time.Hour
	DiscoveryGeoTTL     = 1 * time.Hour
	DiscoverySearchTTL  = 2 * time.Minute
	DiscoveryMatchTTL   = 1 * time.Minute
)

var (
	Client *redis.Client
	ctx    = context.Background()
)

// Connect initializes the Redis connection
func Connect(redisURL string) error {
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
	}

	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return fmt.Errorf("failed to parse Redis URL: %w", err)
	}

	Client = redis.NewClient(opts)

	// Test connection
	if err := Client.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("failed to connect to Redis: %w", err)
	}

	log.Println("✅ Connected to Redis")
	return nil
}

// Close closes the Redis connection
func Close() error {
	if Client != nil {
		return Client.Close()
	}
	return nil
}

// ============ Session Cache ============

// CacheSession stores a session in Redis
func CacheSession(sessionID string, data interface{}) error {
	if Client == nil {
		return nil // Redis not available, skip caching
	}

	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}

	key := SessionKeyPrefix + sessionID
	return Client.Set(ctx, key, jsonData, SessionTTL).Err()
}

// GetCachedSession retrieves a cached session
func GetCachedSession(sessionID string, dest interface{}) (bool, error) {
	if Client == nil {
		return false, nil
	}

	key := SessionKeyPrefix + sessionID
	data, err := Client.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return false, nil // Cache miss
	}
	if err != nil {
		return false, err
	}

	if err := json.Unmarshal(data, dest); err != nil {
		return false, err
	}

	return true, nil // Cache hit
}

// InvalidateSession removes a session from cache
func InvalidateSession(sessionID string) error {
	if Client == nil {
		return nil
	}
	return Client.Del(ctx, SessionKeyPrefix+sessionID).Err()
}

// ============ User Cache ============

// CacheUser stores user data in Redis
func CacheUser(userID string, data interface{}) error {
	if Client == nil {
		return nil
	}

	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}

	key := UserKeyPrefix + userID
	return Client.Set(ctx, key, jsonData, UserTTL).Err()
}

// GetCachedUser retrieves cached user data
func GetCachedUser(userID string, dest interface{}) (bool, error) {
	if Client == nil {
		return false, nil
	}

	key := UserKeyPrefix + userID
	data, err := Client.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	return json.Unmarshal(data, dest) == nil, nil
}

// InvalidateUser removes user from cache
func InvalidateUser(userID string) error {
	if Client == nil {
		return nil
	}
	return Client.Del(ctx, UserKeyPrefix+userID).Err()
}

// ============ Generic Helpers ============

// Set stores any value with custom TTL
func Set(key string, value interface{}, ttl time.Duration) error {
	if Client == nil {
		return nil
	}

	jsonData, err := json.Marshal(value)
	if err != nil {
		return err
	}

	return Client.Set(ctx, key, jsonData, ttl).Err()
}

// Get retrieves a value
func Get(key string, dest interface{}) (bool, error) {
	if Client == nil {
		return false, nil
	}

	data, err := Client.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	return json.Unmarshal(data, dest) == nil, nil
}

// Delete removes a key
func Delete(key string) error {
	if Client == nil {
		return nil
	}
	return Client.Del(ctx, key).Err()
}

// DeletePattern removes keys matching a Redis glob pattern.
func DeletePattern(pattern string) error {
	if Client == nil {
		return nil
	}

	scanCtx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	var cursor uint64
	for {
		keys, nextCursor, err := Client.Scan(scanCtx, cursor, pattern, 100).Result()
		if err != nil {
			return err
		}
		if len(keys) > 0 {
			if err := Client.Del(scanCtx, keys...).Err(); err != nil {
				return err
			}
		}
		cursor = nextCursor
		if cursor == 0 {
			return nil
		}
	}
}

// Incr increments a counter
func Incr(key string) (int64, error) {
	if Client == nil {
		return 0, nil
	}
	return Client.Incr(ctx, key).Result()
}

// Expire sets TTL on a key
func Expire(key string, ttl time.Duration) error {
	if Client == nil {
		return nil
	}
	return Client.Expire(ctx, key, ttl).Err()
}
