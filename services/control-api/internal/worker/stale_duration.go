package worker

import (
	"os"
	"strconv"
	"time"
)

// providerNodeStaleAfter is how long without API/gateway heartbeat before a provider_nodes row is marked offline.
// CLI sends heartbeats about every 120s; default 5m allows one missed beat plus jitter.
func providerNodeStaleAfter() time.Duration {
	if raw := os.Getenv("PROVIDER_NODE_STALE_AFTER"); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil && d > 0 {
			return d
		}
		if mins, err := strconv.Atoi(raw); err == nil && mins > 0 {
			return time.Duration(mins) * time.Minute
		}
	}
	return 5 * time.Minute
}
