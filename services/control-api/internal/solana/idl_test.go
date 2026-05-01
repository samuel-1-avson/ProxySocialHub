package solana

import (
	"context"
	"testing"

	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

func TestLoadAndValidateIDLWithoutRedisReturnsNil(t *testing.T) {
	originalRedis := redisClient.Client
	redisClient.Client = nil
	t.Cleanup(func() {
		redisClient.Client = originalRedis
	})

	if err := LoadAndValidateIDL(context.Background(), "https://example.invalid", "program-id"); err != nil {
		t.Fatalf("LoadAndValidateIDL returned error without Redis: %v", err)
	}
}
