package worker

import (
	"log"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// OnNodeOffline is an optional hook called for each ExplorerNode that is
// marked offline by the heartbeat monitor. Set from main.go to avoid
// a circular import between the worker and api packages.
var OnNodeOffline func(*models.ExplorerNode)

// heartbeatCheckInterval is how often stale nodes are swept. With a 5 minute
// stale window, a sweep every 30s means a silent node shows offline within
// about 5.5 minutes at worst.
const heartbeatCheckInterval = 30 * time.Second

// StartHeartbeatMonitor runs every 30 seconds and marks nodes offline
// when their last heartbeat exceeds the timeout window.
func StartHeartbeatMonitor() {
	GoSupervised("HeartbeatMonitor", 5*time.Second, func() {
		stale := providerNodeStaleAfter()
		log.Printf("Heartbeat Monitor started — checking every %v, provider stale after %v", heartbeatCheckInterval, stale)
		ticker := time.NewTicker(heartbeatCheckInterval)
		defer ticker.Stop()
		for range ticker.C {
			RunSafely("HeartbeatMonitor.cycle", runHeartbeatCheck)
		}
	})
}

func runHeartbeatCheck() {
	if db.DB == nil {
		return
	}

	stale := providerNodeStaleAfter()
	cutoff := time.Now().Add(-stale)

	result := db.DB.Model(&models.ProviderNode{}).
		Where("status = ? AND (last_seen_at IS NULL OR last_seen_at < ?)", models.NodeOnline, cutoff).
		Updates(map[string]interface{}{"status": models.NodeOffline, "is_healthy": false})

	if result.Error != nil {
		log.Printf("Heartbeat Monitor: error checking nodes: %v", result.Error)
		return
	}

	if result.RowsAffected > 0 {
		log.Printf("Heartbeat Monitor: marked %d node(s) offline (no heartbeat in >%v)", result.RowsAffected, stale)

		// Broadcast each newly-offline node to WebSocket clients (if wired)
		if OnNodeOffline != nil {
			var offlineNodes []models.ExplorerNode
			if err := db.DB.Where("is_active = ? AND last_heartbeat < ?", false, cutoff).
				Find(&offlineNodes).Error; err == nil {
				for i := range offlineNodes {
					OnNodeOffline(&offlineNodes[i])
				}
			}
		}
	}
}
