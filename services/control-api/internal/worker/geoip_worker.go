package worker

import (
	"log"
	"os"
	"time"

	"github.com/proxyhubb/control-api/internal/geoip"
)

// StartGeoIPWorker launches the GeoIP backfill worker under supervision.
func StartGeoIPWorker() {
	if os.Getenv("GEOIP_ENABLED") == "false" {
		log.Println("[GeoIP] Backfill worker disabled (GEOIP_ENABLED=false)")
		return
	}

	log.Println("[Worker] Supervised GeoIP worker started")

	GoSupervised("GeoIPUpdater", 5*time.Second, func() {
		// Initial delay — let DB connections settle
		time.Sleep(10 * time.Second)

		// ip-api.com free tier: 45 req/min → process one batch per minute
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()

		// Run once initially
		RunSafely("GeoIPUpdater.cycle", func() { geoip.ResolveNextBatch() })

		for range ticker.C {
			RunSafely("GeoIPUpdater.cycle", func() { geoip.ResolveNextBatch() })
		}
	})
}
