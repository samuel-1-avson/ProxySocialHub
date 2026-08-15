package worker

import (
	"log"
	"time"

	"github.com/proxyhubb/control-api/internal/sessioncache"
)

// StartSessionGatewayCacheReaper deletes expired session_gateway_cache rows (Wave 2.2).
// Hydrate SoT for Redis-miss is still dual-write + TTL; this only bounds table growth.
func StartSessionGatewayCacheReaper() {
	GoSupervised("SessionGatewayCacheReaper", 5*time.Second, func() {
		log.Printf("[Worker] SessionGatewayCacheReaper started (Interval: 5m)")
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			RunSafely("SessionGatewayCacheReaper.cycle", reapExpiredSessionGatewayCache)
		}
	})
}

func reapExpiredSessionGatewayCache() {
	n, err := sessioncache.DeleteExpired(time.Now().UTC(), 1000)
	if err != nil {
		log.Printf("[SessionGatewayCacheReaper] error: %v", err)
		return
	}
	if n > 0 {
		log.Printf("[SessionGatewayCacheReaper] deleted %d expired row(s)", n)
	}
}
