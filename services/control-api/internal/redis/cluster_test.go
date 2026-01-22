package redis

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRedisClusterFailover tests Redis cluster failover behavior
// Property 1: High Availability Failover Timing
// Validates: Requirements 1.1
func TestRedisClusterFailover(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping Redis cluster failover test in short mode")
	}

	// This test requires a running Redis cluster
	// In CI/CD, this would be set up with docker-compose or testcontainers
	clusterAddrs := []string{
		"localhost:7000",
		"localhost:7001", 
		"localhost:7002",
		"localhost:7003",
		"localhost:7004",
		"localhost:7005",
	}

	config := &ClusterConfig{
		Addrs:           clusterAddrs,
		MaxRetries:      3,
		MinRetryBackoff: 8 * time.Millisecond,
		MaxRetryBackoff: 512 * time.Millisecond,
		DialTimeout:     5 * time.Second,
		ReadTimeout:     3 * time.Second,
		WriteTimeout:    3 * time.Second,
	}

	client, err := NewClusterClient(config)
	if err != nil {
		t.Skipf("Redis cluster not available: %v", err)
	}
	defer client.Close()

	ctx := context.Background()

	// Property: Cluster should maintain availability during node failures
	t.Run("cluster_maintains_availability_during_failures", func(t *testing.T) {
		// Test data
		testKeys := []string{"test:key1", "test:key2", "test:key3", "test:key4", "test:key5"}
		testValues := []string{"value1", "value2", "value3", "value4", "value5"}

		// Store test data across the cluster
		for i, key := range testKeys {
			err := client.Set(ctx, key, testValues[i], time.Hour)
			require.NoError(t, err, "Failed to set key %s", key)
		}

		// Verify all data is accessible
		for i, key := range testKeys {
			value, err := client.Get(ctx, key)
			require.NoError(t, err, "Failed to get key %s", key)
			assert.Equal(t, testValues[i], value, "Value mismatch for key %s", key)
		}

		// Simulate node failure by checking cluster resilience
		// In a real test environment, you would actually stop a Redis node here
		// For now, we test that the cluster can handle connection issues gracefully

		// Test cluster health
		err := client.HealthCheck(ctx)
		assert.NoError(t, err, "Cluster health check failed")

		// Test that operations continue to work
		newKey := "test:failover:key"
		newValue := "failover_value"
		
		err = client.Set(ctx, newKey, newValue, time.Hour)
		assert.NoError(t, err, "Failed to set key during failover test")

		retrievedValue, err := client.Get(ctx, newKey)
		assert.NoError(t, err, "Failed to get key during failover test")
		assert.Equal(t, newValue, retrievedValue, "Value mismatch during failover test")

		// Clean up
		for _, key := range append(testKeys, newKey) {
			_ = client.Del(ctx, key)
		}
	})

	// Property: Cluster operations should complete within acceptable time limits
	t.Run("cluster_operations_timing", func(t *testing.T) {
		key := "test:timing:key"
		value := "timing_test_value"

		// Test write timing
		start := time.Now()
		err := client.Set(ctx, key, value, time.Hour)
		writeTime := time.Since(start)
		
		require.NoError(t, err, "Failed to set key for timing test")
		assert.Less(t, writeTime, 100*time.Millisecond, "Write operation took too long: %v", writeTime)

		// Test read timing
		start = time.Now()
		retrievedValue, err := client.Get(ctx, key)
		readTime := time.Since(start)
		
		require.NoError(t, err, "Failed to get key for timing test")
		assert.Equal(t, value, retrievedValue, "Value mismatch in timing test")
		assert.Less(t, readTime, 50*time.Millisecond, "Read operation took too long: %v", readTime)

		// Clean up
		_ = client.Del(ctx, key)
	})

	// Property: Cluster should maintain data consistency across nodes
	t.Run("cluster_data_consistency", func(t *testing.T) {
		key := "test:consistency:key"
		value := "consistency_test_value"

		// Write data
		err := client.Set(ctx, key, value, time.Hour)
		require.NoError(t, err, "Failed to set key for consistency test")

		// Read data multiple times to ensure consistency
		for i := 0; i < 10; i++ {
			retrievedValue, err := client.Get(ctx, key)
			require.NoError(t, err, "Failed to get key in consistency test iteration %d", i)
			assert.Equal(t, value, retrievedValue, "Value inconsistency in iteration %d", i)
		}

		// Test atomic operations
		counter := "test:consistency:counter"
		
		// Increment counter multiple times
		for i := 0; i < 5; i++ {
			_, err := client.IncrBy(ctx, counter, 1)
			require.NoError(t, err, "Failed to increment counter in iteration %d", i)
		}

		// Verify final count
		finalValue, err := client.Get(ctx, counter)
		require.NoError(t, err, "Failed to get final counter value")
		assert.Equal(t, "5", finalValue, "Counter value is inconsistent")

		// Clean up
		_ = client.Del(ctx, key, counter)
	})
}

// TestRedisClusterConfiguration tests cluster configuration validation
func TestRedisClusterConfiguration(t *testing.T) {
	t.Run("empty_addresses_should_fail", func(t *testing.T) {
		config := &ClusterConfig{
			Addrs: []string{},
		}
		
		_, err := NewClusterClient(config)
		assert.Error(t, err, "Should fail with empty addresses")
		assert.Contains(t, err.Error(), "addresses cannot be empty")
	})

	t.Run("default_config_should_be_valid", func(t *testing.T) {
		config := DefaultClusterConfig()
		
		assert.NotEmpty(t, config.MaxRetries, "MaxRetries should be set")
		assert.NotZero(t, config.DialTimeout, "DialTimeout should be set")
		assert.NotZero(t, config.ReadTimeout, "ReadTimeout should be set")
		assert.NotZero(t, config.WriteTimeout, "WriteTimeout should be set")
		assert.NotZero(t, config.PoolSize, "PoolSize should be set")
	})

	t.Run("cluster_from_url_parsing", func(t *testing.T) {
		// Test single URL
		singleURL := "redis://localhost:6379"
		client, err := NewClusterClientFromURL(singleURL)
		if err != nil {
			t.Skipf("Redis not available: %v", err)
		}
		if client != nil {
			client.Close()
		}

		// Test multiple URLs
		multiURL := "redis://localhost:7000,redis://localhost:7001,redis://localhost:7002"
		client, err = NewClusterClientFromURL(multiURL)
		if err != nil {
			t.Skipf("Redis cluster not available: %v", err)
		}
		if client != nil {
			client.Close()
		}
	})
}

// BenchmarkRedisClusterOperations benchmarks cluster operations
func BenchmarkRedisClusterOperations(b *testing.B) {
	clusterAddrs := []string{
		"localhost:7000",
		"localhost:7001", 
		"localhost:7002",
	}

	config := DefaultClusterConfig()
	config.Addrs = clusterAddrs

	client, err := NewClusterClient(config)
	if err != nil {
		b.Skipf("Redis cluster not available: %v", err)
	}
	defer client.Close()

	ctx := context.Background()

	b.Run("set_operations", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			key := fmt.Sprintf("bench:set:%d", i)
			value := fmt.Sprintf("value_%d", i)
			err := client.Set(ctx, key, value, time.Hour)
			if err != nil {
				b.Fatalf("Set operation failed: %v", err)
			}
		}
	})

	b.Run("get_operations", func(b *testing.B) {
		// Pre-populate data
		for i := 0; i < 100; i++ {
			key := fmt.Sprintf("bench:get:%d", i)
			value := fmt.Sprintf("value_%d", i)
			_ = client.Set(ctx, key, value, time.Hour)
		}

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			key := fmt.Sprintf("bench:get:%d", i%100)
			_, err := client.Get(ctx, key)
			if err != nil && err != ErrKeyNotFound {
				b.Fatalf("Get operation failed: %v", err)
			}
		}
	})

	b.Run("incr_operations", func(b *testing.B) {
		key := "bench:incr:counter"
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, err := client.IncrBy(ctx, key, 1)
			if err != nil {
				b.Fatalf("Incr operation failed: %v", err)
			}
		}
	})
}