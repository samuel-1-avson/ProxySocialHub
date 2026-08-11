package worker

import (
	"time"

	"github.com/proxyhubb/control-api/internal/redis"
)

// WithLeaderLease runs fn only on the Redis-elected leader replica.
func WithLeaderLease(name string, ttl time.Duration, fn func()) {
	redis.WithLeaderLease(name, ttl, fn)
}
