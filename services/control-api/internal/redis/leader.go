package redis

import (
	"log"
	"os"
	"time"

	"github.com/google/uuid"
)

// WithLeaderLease runs fn only if this process holds a Redis SETNX leader lock.
// When Redis is unavailable AcquireLock fails open (returns true) so single-node
// deploys keep working. Set WORKER_LEADER_LEASE=false to disable.
func WithLeaderLease(name string, ttl time.Duration, fn func()) {
	if os.Getenv("WORKER_LEADER_LEASE") == "false" {
		fn()
		return
	}
	if ttl <= 0 {
		ttl = 2 * time.Minute
	}
	holder := uuid.NewString()
	ok, err := AcquireLock("leader:"+name, holder, ttl)
	if err != nil {
		log.Printf("[LeaderLease] %s acquire error: %v — skipping cycle", name, err)
		return
	}
	if !ok {
		return
	}
	defer func() {
		if relErr := ReleaseLock("leader:" + name); relErr != nil {
			log.Printf("[LeaderLease] %s release error: %v", name, relErr)
		}
	}()
	fn()
}
