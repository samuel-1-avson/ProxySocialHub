package ratelimiter

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
	"github.com/redis/go-redis/v9"
)

func setupTestRedis(t *testing.T) *miniredis.Miniredis {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("Failed to start miniredis: %v", err)
	}

	// Set up Redis client for testing
	client := redis.NewClient(&redis.Options{
		Addr: mr.Addr(),
	})
	redisClient.Client = client

	return mr
}

func TestTokenBucketAlgorithm(t *testing.T) {
	mr := setupTestRedis(t)
	defer mr.Close()

	config := AdvancedRateLimitConfig{
		Algorithm:     TokenBucket,
		Limit:         5,
		RefillRate:    1.0, // 1 token per second
		BurstCapacity: 5,
		Window:        time.Minute,
		PenaltyConfig: PenaltyConfig{Enabled: false},
	}

	ctx := context.Background()
	key := "test:token_bucket"

	// Test initial burst capacity
	for i := 0; i < 5; i++ {
		allowed, remaining, _, _ := checkTokenBucket(ctx, key, config)
		if !allowed {
			t.Errorf("Request %d should be allowed", i+1)
		}
		if remaining != 4-i {
			t.Errorf("Expected remaining %d, got %d", 4-i, remaining)
		}
	}

	// Next request should be denied
	allowed, remaining, _, _ := checkTokenBucket(ctx, key, config)
	if allowed {
		t.Error("Request should be denied after burst capacity exhausted")
	}
	if remaining != 0 {
		t.Errorf("Expected remaining 0, got %d", remaining)
	}

	// Wait for token refill and test again
	time.Sleep(time.Second + 100*time.Millisecond)
	allowed, remaining, _, _ = checkTokenBucket(ctx, key, config)
	if !allowed {
		t.Error("Request should be allowed after token refill")
	}
	if remaining != 0 {
		t.Errorf("Expected remaining 0, got %d", remaining)
	}
}

func TestSlidingWindowAlgorithm(t *testing.T) {
	mr := setupTestRedis(t)
	defer mr.Close()

	config := AdvancedRateLimitConfig{
		Algorithm:     SlidingWindow,
		Limit:         3,
		Window:        time.Second * 2,
		PenaltyConfig: PenaltyConfig{Enabled: false},
	}

	ctx := context.Background()
	key := "test:sliding_window"

	// Test initial requests within limit
	for i := 0; i < 3; i++ {
		allowed, remaining, _, _ := checkSlidingWindow(ctx, key, config)
		if !allowed {
			t.Errorf("Request %d should be allowed", i+1)
		}
		if remaining != 2-i {
			t.Errorf("Expected remaining %d, got %d", 2-i, remaining)
		}
	}

	// Next request should be denied
	allowed, remaining, _, _ := checkSlidingWindow(ctx, key, config)
	if allowed {
		t.Error("Request should be denied after limit reached")
	}
	if remaining != 0 {
		t.Errorf("Expected remaining 0, got %d", remaining)
	}

	// Wait for window to slide and test again
	time.Sleep(time.Second*2 + 100*time.Millisecond)
	allowed, remaining, _, _ = checkSlidingWindow(ctx, key, config)
	if !allowed {
		t.Error("Request should be allowed after window slides")
	}
}

func TestProgressivePenalties(t *testing.T) {
	mr := setupTestRedis(t)
	defer mr.Close()

	config := AdvancedRateLimitConfig{
		Algorithm:     TokenBucket,
		Limit:         1,
		RefillRate:    0.01, // Very slow refill
		BurstCapacity: 1,
		Window:        time.Minute,
		PenaltyConfig: PenaltyConfig{
			Enabled:         true,
			BasePenalty:     time.Millisecond * 100, // Short for testing
			MaxPenalty:      time.Second,
			Multiplier:      2.0,
			ViolationWindow: time.Hour,
		},
	}

	ctx := context.Background()
	key := "test:penalty"

	// Exhaust tokens
	allowed, _, _, _ := checkTokenBucket(ctx, key, config)
	if !allowed {
		t.Error("First request should be allowed")
	}

	// Trigger first violation
	allowed, _, _, penaltyUntil := checkTokenBucket(ctx, key, config)
	if allowed {
		t.Error("Second request should be denied")
	}
	if penaltyUntil.IsZero() {
		t.Error("Penalty should be applied after first violation")
	}

	// Wait a bit to ensure different timestamps
	time.Sleep(time.Millisecond * 10)

	// Trigger second violation (should increase penalty)
	allowed, _, _, penaltyUntil2 := checkTokenBucket(ctx, key, config)
	if allowed {
		t.Error("Third request should be denied")
	}

	// The second penalty should be at least as long as the first (progressive)
	if penaltyUntil2.Before(penaltyUntil) {
		t.Error("Second penalty should not be shorter than first")
	}
}

func TestFixedWindowAlgorithm(t *testing.T) {
	mr := setupTestRedis(t)
	defer mr.Close()

	config := AdvancedRateLimitConfig{
		Algorithm:     FixedWindow,
		Limit:         3,
		Window:        time.Second * 2,
		PenaltyConfig: PenaltyConfig{Enabled: false},
	}

	ctx := context.Background()
	key := "test:fixed_window"

	// Test requests within limit
	for i := 0; i < 3; i++ {
		allowed, remaining, _, _ := checkFixedWindow(ctx, key, config)
		if !allowed {
			t.Errorf("Request %d should be allowed", i+1)
		}
		if remaining != 2-i {
			t.Errorf("Expected remaining %d, got %d", 2-i, remaining)
		}
	}

	// Next request should be denied
	allowed, remaining, _, _ := checkFixedWindow(ctx, key, config)
	if allowed {
		t.Error("Request should be denied after limit reached")
	}
	if remaining != 0 {
		t.Errorf("Expected remaining 0, got %d", remaining)
	}
}

func TestTokenBucketStateMarshaling(t *testing.T) {
	state := TokenBucketState{
		Tokens:        5.5,
		LastRefill:    time.Now(),
		Violations:    2,
		LastViolation: time.Now().Add(-time.Minute),
		PenaltyUntil:  time.Now().Add(time.Minute),
	}

	data, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("Failed to marshal state: %v", err)
	}

	var unmarshaled TokenBucketState
	err = json.Unmarshal(data, &unmarshaled)
	if err != nil {
		t.Fatalf("Failed to unmarshal state: %v", err)
	}

	if unmarshaled.Tokens != state.Tokens {
		t.Errorf("Expected tokens %f, got %f", state.Tokens, unmarshaled.Tokens)
	}
	if unmarshaled.Violations != state.Violations {
		t.Errorf("Expected violations %d, got %d", state.Violations, unmarshaled.Violations)
	}
}

func TestSlidingWindowStateMarshaling(t *testing.T) {
	now := time.Now()
	state := SlidingWindowState{
		Requests:      []time.Time{now, now.Add(-time.Second)},
		Violations:    1,
		LastViolation: now.Add(-time.Minute),
		PenaltyUntil:  now.Add(time.Minute),
	}

	data, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("Failed to marshal state: %v", err)
	}

	var unmarshaled SlidingWindowState
	err = json.Unmarshal(data, &unmarshaled)
	if err != nil {
		t.Fatalf("Failed to unmarshal state: %v", err)
	}

	if len(unmarshaled.Requests) != len(state.Requests) {
		t.Errorf("Expected %d requests, got %d", len(state.Requests), len(unmarshaled.Requests))
	}
	if unmarshaled.Violations != state.Violations {
		t.Errorf("Expected violations %d, got %d", state.Violations, unmarshaled.Violations)
	}
}

func TestDefaultConfigurations(t *testing.T) {
	defaultConfig := DefaultAdvancedRateLimitConfig()
	if defaultConfig.Algorithm != TokenBucket {
		t.Errorf("Expected default algorithm %s, got %s", TokenBucket, defaultConfig.Algorithm)
	}
	if defaultConfig.Limit != 300 {
		t.Errorf("Expected default limit 300, got %d", defaultConfig.Limit)
	}
	if defaultConfig.PenaltyConfig.Enabled {
		t.Error("Expected penalties to be disabled by default")
	}

	strictConfig := StrictAdvancedRateLimitConfig()
	if strictConfig.Limit != 10 {
		t.Errorf("Expected strict limit 10, got %d", strictConfig.Limit)
	}
	if strictConfig.PenaltyConfig.BasePenalty != time.Minute*10 {
		t.Errorf("Expected strict base penalty 10m, got %v", strictConfig.PenaltyConfig.BasePenalty)
	}
}

// Benchmark tests
func BenchmarkTokenBucket(b *testing.B) {
	mr := setupTestRedis(&testing.T{})
	defer mr.Close()

	config := DefaultAdvancedRateLimitConfig()
	ctx := context.Background()
	key := "bench:token_bucket"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		checkTokenBucket(ctx, key, config)
	}
}

func BenchmarkSlidingWindow(b *testing.B) {
	mr := setupTestRedis(&testing.T{})
	defer mr.Close()

	config := DefaultAdvancedRateLimitConfig()
	config.Algorithm = SlidingWindow
	ctx := context.Background()
	key := "bench:sliding_window"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		checkSlidingWindow(ctx, key, config)
	}
}

func BenchmarkFixedWindow(b *testing.B) {
	mr := setupTestRedis(&testing.T{})
	defer mr.Close()

	config := DefaultAdvancedRateLimitConfig()
	config.Algorithm = FixedWindow
	ctx := context.Background()
	key := "bench:fixed_window"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		checkFixedWindow(ctx, key, config)
	}
}
