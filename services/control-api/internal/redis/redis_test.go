package redis

import (
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestAcquireLock(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("an error '%s' was not expected when opening a stub database", err)
	}
	defer mr.Close()

	// Replace the global Client with one connected to miniredis
	Client = redis.NewClient(&redis.Options{
		Addr: mr.Addr(),
	})
	// Ensure ctx is initialized if it's package-level private
	if ctx == nil {
		// Just in case, though redis.go initializes it as context.Background()
	}

	key := "test_lock"
	val := "test_val"
	ttl := 1 * time.Second

	// 1. Acquire lock successfully
	acquired, err := AcquireLock(key, val, ttl)
	if err != nil {
		t.Errorf("expected no error, got %v", err)
	}
	if !acquired {
		t.Errorf("expected to acquire lock")
	}

	// 2. Fail to acquire existing lock
	acquired, err = AcquireLock(key, "new_val", ttl)
	if err != nil {
		t.Errorf("expected no error, got %v", err)
	}
	if acquired {
		t.Errorf("expected NOT to acquire lock")
	}

	// 3. Verify value in Redis (AcquireLock adds "lock:" prefix)
	gotVal, err := mr.Get("lock:" + key)
	if err != nil {
		t.Errorf("expected key to exist")
	}
	if gotVal != val {
		t.Errorf("expected value %s, got %s", val, gotVal)
	}
}

func TestReleaseLock(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("an error '%s' was not expected when opening a stub database", err)
	}
	defer mr.Close()

	Client = redis.NewClient(&redis.Options{
		Addr: mr.Addr(),
	})

	key := "test_lock_release"
	val := "val"
	// Manually set the key with prefix
	_ = mr.Set("lock:"+key, val)

	err = ReleaseLock(key)
	if err != nil {
		t.Errorf("expected no error, got %v", err)
	}

	if mr.Exists("lock:" + key) {
		t.Errorf("expected key to be deleted")
	}
}
