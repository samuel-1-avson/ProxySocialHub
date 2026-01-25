package redis

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// ClusterClient wraps Redis cluster client with failover support
type ClusterClient struct {
	client *redis.ClusterClient
	config *ClusterConfig
}

// ClusterConfig holds Redis cluster configuration
type ClusterConfig struct {
	Addrs              []string      `json:"addrs"`
	Password           string        `json:"password,omitempty"`
	MaxRetries         int           `json:"max_retries"`
	MinRetryBackoff    time.Duration `json:"min_retry_backoff"`
	MaxRetryBackoff    time.Duration `json:"max_retry_backoff"`
	DialTimeout        time.Duration `json:"dial_timeout"`
	ReadTimeout        time.Duration `json:"read_timeout"`
	WriteTimeout       time.Duration `json:"write_timeout"`
	PoolSize           int           `json:"pool_size"`
	MinIdleConns       int           `json:"min_idle_conns"`
	MaxConnAge         time.Duration `json:"max_conn_age"`
	PoolTimeout        time.Duration `json:"pool_timeout"`
	IdleTimeout        time.Duration `json:"idle_timeout"`
	IdleCheckFrequency time.Duration `json:"idle_check_frequency"`
}

// DefaultClusterConfig returns default Redis cluster configuration
func DefaultClusterConfig() *ClusterConfig {
	return &ClusterConfig{
		MaxRetries:         3,
		MinRetryBackoff:    8 * time.Millisecond,
		MaxRetryBackoff:    512 * time.Millisecond,
		DialTimeout:        5 * time.Second,
		ReadTimeout:        3 * time.Second,
		WriteTimeout:       3 * time.Second,
		PoolSize:           10,
		MinIdleConns:       5,
		MaxConnAge:         30 * time.Minute,
		PoolTimeout:        4 * time.Second,
		IdleTimeout:        5 * time.Minute,
		IdleCheckFrequency: 1 * time.Minute,
	}
}

// NewClusterClient creates a new Redis cluster client
func NewClusterClient(config *ClusterConfig) (*ClusterClient, error) {
	if len(config.Addrs) == 0 {
		return nil, fmt.Errorf("redis cluster addresses cannot be empty")
	}

	rdb := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs:           config.Addrs,
		Password:        config.Password,
		MaxRetries:      config.MaxRetries,
		MinRetryBackoff: config.MinRetryBackoff,
		MaxRetryBackoff: config.MaxRetryBackoff,
		DialTimeout:     config.DialTimeout,
		ReadTimeout:     config.ReadTimeout,
		WriteTimeout:    config.WriteTimeout,
		PoolSize:        config.PoolSize,
		MinIdleConns:    config.MinIdleConns,
		ConnMaxLifetime: config.MaxConnAge,
		PoolTimeout:     config.PoolTimeout,
		ConnMaxIdleTime: config.IdleTimeout,
	})

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to Redis cluster: %w", err)
	}

	return &ClusterClient{
		client: rdb,
		config: config,
	}, nil
}

// NewClusterClientFromURL creates a Redis cluster client from URL
func NewClusterClientFromURL(url string) (*ClusterClient, error) {
	config := DefaultClusterConfig()

	// Parse cluster URLs (comma-separated)
	if strings.Contains(url, ",") {
		config.Addrs = strings.Split(url, ",")
	} else {
		// Single URL - convert to cluster format
		config.Addrs = []string{url}
	}

	// Clean up URLs (remove redis:// prefix if present)
	for i, addr := range config.Addrs {
		addr = strings.TrimSpace(addr)
		addr = strings.TrimPrefix(addr, "redis://")
		config.Addrs[i] = addr
	}

	return NewClusterClient(config)
}

// Get retrieves a value from Redis cluster
func (c *ClusterClient) Get(ctx context.Context, key string) (string, error) {
	result := c.client.Get(ctx, key)
	if result.Err() == redis.Nil {
		return "", ErrKeyNotFound
	}
	return result.Result()
}

// Set stores a value in Redis cluster
func (c *ClusterClient) Set(ctx context.Context, key string, value interface{}, expiration time.Duration) error {
	return c.client.Set(ctx, key, value, expiration).Err()
}

// SetEX stores a value with expiration in Redis cluster
func (c *ClusterClient) SetEX(ctx context.Context, key string, value interface{}, expiration time.Duration) error {
	return c.client.SetEx(ctx, key, value, expiration).Err()
}

// Del deletes keys from Redis cluster
func (c *ClusterClient) Del(ctx context.Context, keys ...string) error {
	return c.client.Del(ctx, keys...).Err()
}

// Incr increments a key's value in Redis cluster
func (c *ClusterClient) Incr(ctx context.Context, key string) (int64, error) {
	return c.client.Incr(ctx, key).Result()
}

// IncrBy increments a key's value by amount in Redis cluster
func (c *ClusterClient) IncrBy(ctx context.Context, key string, value int64) (int64, error) {
	return c.client.IncrBy(ctx, key, value).Result()
}

// Expire sets expiration on a key in Redis cluster
func (c *ClusterClient) Expire(ctx context.Context, key string, expiration time.Duration) error {
	return c.client.Expire(ctx, key, expiration).Err()
}

// Exists checks if keys exist in Redis cluster
func (c *ClusterClient) Exists(ctx context.Context, keys ...string) (int64, error) {
	return c.client.Exists(ctx, keys...).Result()
}

// HSet sets hash field in Redis cluster
func (c *ClusterClient) HSet(ctx context.Context, key string, values ...interface{}) error {
	return c.client.HSet(ctx, key, values...).Err()
}

// HGet gets hash field from Redis cluster
func (c *ClusterClient) HGet(ctx context.Context, key, field string) (string, error) {
	result := c.client.HGet(ctx, key, field)
	if result.Err() == redis.Nil {
		return "", ErrKeyNotFound
	}
	return result.Result()
}

// HGetAll gets all hash fields from Redis cluster
func (c *ClusterClient) HGetAll(ctx context.Context, key string) (map[string]string, error) {
	return c.client.HGetAll(ctx, key).Result()
}

// HDel deletes hash fields from Redis cluster
func (c *ClusterClient) HDel(ctx context.Context, key string, fields ...string) error {
	return c.client.HDel(ctx, key, fields...).Err()
}

// ZAdd adds members to sorted set in Redis cluster
func (c *ClusterClient) ZAdd(ctx context.Context, key string, members ...redis.Z) error {
	return c.client.ZAdd(ctx, key, members...).Err()
}

// ZRangeByScore gets sorted set members by score range
func (c *ClusterClient) ZRangeByScore(ctx context.Context, key string, opt *redis.ZRangeBy) ([]string, error) {
	return c.client.ZRangeByScore(ctx, key, opt).Result()
}

// ZRemRangeByScore removes sorted set members by score range
func (c *ClusterClient) ZRemRangeByScore(ctx context.Context, key string, min, max string) error {
	return c.client.ZRemRangeByScore(ctx, key, min, max).Err()
}

// Pipeline creates a pipeline for batch operations
func (c *ClusterClient) Pipeline() redis.Pipeliner {
	return c.client.Pipeline()
}

// TxPipeline creates a transaction pipeline
func (c *ClusterClient) TxPipeline() redis.Pipeliner {
	return c.client.TxPipeline()
}

// ClusterInfo returns cluster information
func (c *ClusterClient) ClusterInfo(ctx context.Context) (string, error) {
	return c.client.ClusterInfo(ctx).Result()
}

// ClusterNodes returns cluster nodes information
func (c *ClusterClient) ClusterNodes(ctx context.Context) (string, error) {
	return c.client.ClusterNodes(ctx).Result()
}

// HealthCheck performs a comprehensive health check
func (c *ClusterClient) HealthCheck(ctx context.Context) error {
	// Test basic connectivity
	if err := c.client.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("ping failed: %w", err)
	}

	// Check cluster state
	info, err := c.ClusterInfo(ctx)
	if err != nil {
		return fmt.Errorf("cluster info failed: %w", err)
	}

	// Parse cluster state
	if !strings.Contains(info, "cluster_state:ok") {
		return fmt.Errorf("cluster state is not ok: %s", info)
	}

	// Test read/write operations
	testKey := fmt.Sprintf("health_check_%d", time.Now().Unix())
	if err := c.Set(ctx, testKey, "test", time.Minute); err != nil {
		return fmt.Errorf("test write failed: %w", err)
	}

	if _, err := c.Get(ctx, testKey); err != nil {
		return fmt.Errorf("test read failed: %w", err)
	}

	// Clean up test key
	_ = c.Del(ctx, testKey)

	return nil
}

// GetClusterStats returns cluster statistics
func (c *ClusterClient) GetClusterStats(ctx context.Context) (*ClusterStats, error) {
	info, err := c.ClusterInfo(ctx)
	if err != nil {
		return nil, err
	}

	nodes, err := c.ClusterNodes(ctx)
	if err != nil {
		return nil, err
	}

	stats := &ClusterStats{
		Info:  info,
		Nodes: nodes,
	}

	// Parse basic stats from info
	lines := strings.Split(info, "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "cluster_size:") {
			fmt.Sscanf(line, "cluster_size:%d", &stats.ClusterSize)
		}
		if strings.HasPrefix(line, "cluster_known_nodes:") {
			fmt.Sscanf(line, "cluster_known_nodes:%d", &stats.KnownNodes)
		}
	}

	return stats, nil
}

// Close closes the Redis cluster client
func (c *ClusterClient) Close() error {
	return c.client.Close()
}

// ClusterStats holds cluster statistics
type ClusterStats struct {
	Info        string `json:"info"`
	Nodes       string `json:"nodes"`
	ClusterSize int    `json:"cluster_size"`
	KnownNodes  int    `json:"known_nodes"`
}

// ErrKeyNotFound is returned when a key is not found
var ErrKeyNotFound = fmt.Errorf("key not found")
