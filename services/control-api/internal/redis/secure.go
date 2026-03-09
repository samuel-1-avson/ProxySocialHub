// internal/redis/secure.go
// Secure Redis initialization with authentication and TLS support
// Extends the functionality in redis.go without redeclaring variables

package redis

import (
	"crypto/tls"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// SecureOptions contains security-focused Redis configuration
type SecureOptions struct {
	// Connection security
	Password string
	UseTLS   bool
	
	// Connection pool settings
	PoolSize     int
	MinIdleConns int
	MaxRetries   int
	
	// Timeouts (in seconds)
	DialTimeout  int
	ReadTimeout  int
	WriteTimeout int
	PoolTimeout  int
}

// DefaultSecureOptions returns secure default options
func DefaultSecureOptions() *SecureOptions {
	return &SecureOptions{
		Password:     "",
		UseTLS:       false,
		PoolSize:     10,
		MinIdleConns: 5,
		MaxRetries:   3,
		DialTimeout:  5,
		ReadTimeout:  3,
		WriteTimeout: 3,
		PoolTimeout:  4,
	}
}

// InitSecure initializes Redis with security hardening
func InitSecure(opts *SecureOptions) error {
	if opts == nil {
		opts = DefaultSecureOptions()
	}
	
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		return fmt.Errorf("REDIS_URL environment variable is required")
	}
	
	// Parse URL to extract password if present
	parsedOpts, err := redis.ParseURL(redisURL)
	if err != nil {
		return fmt.Errorf("failed to parse Redis URL: %w", err)
	}
	
	// Apply secure options
	parsedOpts.PoolSize = opts.PoolSize
	parsedOpts.MinIdleConns = opts.MinIdleConns
	parsedOpts.MaxRetries = opts.MaxRetries
	parsedOpts.DialTimeout = time.Duration(opts.DialTimeout) * time.Second
	parsedOpts.ReadTimeout = time.Duration(opts.ReadTimeout) * time.Second
	parsedOpts.WriteTimeout = time.Duration(opts.WriteTimeout) * time.Second
	parsedOpts.PoolTimeout = time.Duration(opts.PoolTimeout) * time.Second
	
	// Configure TLS if enabled
	if opts.UseTLS {
		parsedOpts.TLSConfig = &tls.Config{
			MinVersion: tls.VersionTLS12,
		}
	}
	
	// Create client
	client := redis.NewClient(parsedOpts)
	
	// Verify connection
	if _, err := client.Ping(ctx).Result(); err != nil {
		return fmt.Errorf("failed to connect to Redis: %w", err)
	}
	
	Client = client
	return nil
}

// ValidateRedisSecurity checks Redis security configuration
func ValidateRedisSecurity() error {
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		return fmt.Errorf("REDIS_URL not set")
	}
	
	// Check if password is present in URL
	parsedOpts, err := redis.ParseURL(redisURL)
	if err != nil {
		return fmt.Errorf("invalid REDIS_URL: %w", err)
	}
	
	if parsedOpts.Password == "" {
		return fmt.Errorf("Redis password not configured in REDIS_URL - authentication required")
	}
	
	return nil
}

// HealthCheck performs a comprehensive Redis health check
func HealthCheck() error {
	if Client == nil {
		return fmt.Errorf("Redis client not initialized")
	}
	
	// Basic ping
	if err := Client.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("Redis ping failed: %w", err)
	}
	
	return nil
}

// GetPoolStats returns connection pool statistics
func GetPoolStats() map[string]interface{} {
	if Client == nil {
		return map[string]interface{}{"status": "not_initialized"}
	}
	
	// Try to get underlying client for stats
	if client, ok := Client.(*redis.Client); ok {
		stats := client.PoolStats()
		return map[string]interface{}{
			"status":          "healthy",
			"hits":            stats.Hits,
			"misses":          stats.Misses,
			"timeouts":        stats.Timeouts,
			"total_conns":     stats.TotalConns,
			"idle_conns":      stats.IdleConns,
			"stale_conns":     stats.StaleConns,
		}
	}
	
	return map[string]interface{}{"status": "cluster_mode"}
}

// SecureConfigFromEnv creates secure options from environment variables
func SecureConfigFromEnv() *SecureOptions {
	opts := DefaultSecureOptions()
	
	if v := os.Getenv("REDIS_POOL_SIZE"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			opts.PoolSize = n
		}
	}
	
	if v := os.Getenv("REDIS_USE_TLS"); v == "true" || v == "1" {
		opts.UseTLS = true
	}
	
	if v := os.Getenv("REDIS_MAX_RETRIES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			opts.MaxRetries = n
		}
	}
	
	return opts
}
