package worker

import (
	"log"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

const heartbeatTimeout = 5 * time.Minute

// StartHeartbeatMonitor runs every minute and marks nodes offline
// when their last heartbeat exceeds the timeout window.
func StartHeartbeatMonitor() {
	go func() {
		log.Println("Heartbeat Monitor started — checking every 60s, timeout after 5m")
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			runHeartbeatCheck()
		}
	}()
}

func runHeartbeatCheck() {
	if db.DB == nil {
		return
	}

	cutoff := time.Now().Add(-heartbeatTimeout)

	result := db.DB.Model(&models.ProviderNode{}).
		Where("status = ? AND last_seen_at < ? AND last_seen_at IS NOT NULL", models.NodeOnline, cutoff).
		Update("status", models.NodeOffline)

	if result.Error != nil {
		log.Printf("Heartbeat Monitor: error checking nodes: %v", result.Error)
		return
	}

	if result.RowsAffected > 0 {
		log.Printf("Heartbeat Monitor: marked %d node(s) offline (no heartbeat in >%v)", result.RowsAffected, heartbeatTimeout)
	}
}
