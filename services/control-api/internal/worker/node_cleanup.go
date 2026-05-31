package worker

import (
	"log"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

const (
	staleExplorerOfflineThreshold = 30 * time.Minute
	staleNodeArchiveThreshold      = 7 * 24 * time.Hour
)

// StartStaleNodeCleanupWorker runs hourly and:
//   - marks ExplorerNodes inactive when heartbeat is older than staleExplorerOfflineThreshold (30 min)
//   - ProviderNodes offline transitions are handled by HeartbeatMonitor (PROVIDER_NODE_STALE_AFTER, default 5m)
//   - soft-deletes ExplorerNodes that have been offline for more than
//     staleNodeArchiveThreshold (7 days)
func StartStaleNodeCleanupWorker() {
	go func() {
		log.Println("Stale Node Cleanup Worker started — running every hour")
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			runStaleNodeCleanup()
		}
	}()
}

func runStaleNodeCleanup() {
	if db.DB == nil {
		return
	}

	now := time.Now()
	explorerOfflineCutoff := now.Add(-staleExplorerOfflineThreshold)
	archiveCutoff := now.Add(-staleNodeArchiveThreshold)

	// 1. Mark ExplorerNodes inactive when heartbeat exceeds threshold.
	explorerResult := db.DB.Model(&models.ExplorerNode{}).
		Where("is_active = ? AND last_heartbeat < ? AND last_heartbeat IS NOT NULL",
			true, explorerOfflineCutoff).
		Update("is_active", false)
	if explorerResult.Error != nil {
		log.Printf("Stale Node Cleanup: error marking ExplorerNodes inactive: %v", explorerResult.Error)
	} else if explorerResult.RowsAffected > 0 {
		log.Printf("Stale Node Cleanup: marked %d ExplorerNode(s) inactive (no heartbeat in >%v)",
			explorerResult.RowsAffected, staleExplorerOfflineThreshold)
	}

	// 3. Archive (soft-delete) ExplorerNodes offline for more than 7 days.
	// Uses GORM's soft-delete (sets deleted_at) so historical data is preserved.
	archiveResult := db.DB.
		Where("is_active = ? AND last_heartbeat < ?", false, archiveCutoff).
		Delete(&models.ExplorerNode{})
	if archiveResult.Error != nil {
		log.Printf("Stale Node Cleanup: error archiving ExplorerNodes: %v", archiveResult.Error)
	} else if archiveResult.RowsAffected > 0 {
		log.Printf("Stale Node Cleanup: archived %d ExplorerNode(s) offline for >%v",
			archiveResult.RowsAffected, staleNodeArchiveThreshold)
	}
}
