package redis

import (
	"testing"

	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"
)

func useMiniredisClient(t *testing.T) {
	t.Helper()
	mr := miniredis.RunT(t)
	prev := Client
	Client = goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		_ = Client.Close()
		Client = prev
	})
}

// BE-HIGH-05: the sorted-set member used to be the Unix second, so requests in the same
// second overwrote each other and a limit above 60 per minute was never reached.
func TestCheckAPIKeyRateLimit_EnforcesLimitsAboveSixtyPerMinute(t *testing.T) {
	useMiniredisClient(t)

	const limit = 100
	allowed := 0
	for i := 0; i < 150; i++ {
		ok, _, err := CheckAPIKeyRateLimit("pk_test_prefix", limit)
		if err != nil {
			t.Fatalf("request %d: %v", i, err)
		}
		if ok {
			allowed++
		}
	}
	if allowed != limit {
		t.Fatalf("allowed %d of 150 requests with a limit of %d, want exactly %d", allowed, limit, limit)
	}
}

func TestCheckAPIKeyRateLimit_RemainingCountsDown(t *testing.T) {
	useMiniredisClient(t)

	_, first, _ := CheckAPIKeyRateLimit("pk_remaining", 10)
	_, second, _ := CheckAPIKeyRateLimit("pk_remaining", 10)
	if first != 9 || second != 8 {
		t.Fatalf("remaining = %d then %d, want 9 then 8", first, second)
	}
}

