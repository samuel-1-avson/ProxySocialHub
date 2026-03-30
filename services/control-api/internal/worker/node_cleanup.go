package worker

import (
	"log"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

const (
	staleNodeOfflineThreshold = 30 * time.Minute
	staleNodeArchiveThreshold = 7 * 24 * time.Hour
)

// StartStaleNodeCleanupWorker runs hourly and:
//   - marks ProviderNodes + ExplorerNodes offline when their last heartbeat is
//     older than staleNodeOfflineThreshold (30 min)
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
	offlineCutoff := now.Add(-staleNodeOfflineThreshold)
	archiveCutoff := now.Add(-staleNodeArchiveThreshold)

	// 1. Mark ProviderNodes offline when heartbeat exceeds threshold.
	providerResult := db.DB.Model(&models.ProviderNode{}).
		Where("status = ? AND last_seen_at < ? AND last_seen_at IS NOT NULL",
			models.NodeOnline, offlineCutoff).
		Update("status", models.NodeOffline)
	if providerResult.Error != nil {
		log.Printf("Stale Node Cleanup: error marking ProviderNodes offline: %v", providerResult.Error)
	} else if providerResult.RowsAffected > 0 {
		log.Printf("Stale Node Cleanup: marked %d ProviderNode(s) offline (no heartbeat in >%v)",
			providerResult.RowsAffected, staleNodeOfflineThreshold)
	}

	// 2. Mark ExplorerNodes inactive when heartbeat exceeds threshold.
	explorerResult := db.DB.Model(&models.ExplorerNode{}).
		Where("is_active = ? AND last_heartbeat < ? AND last_heartbeat IS NOT NULL",
			true, offlineCutoff).
		Update("is_active", false)
	if explorerResult.Error != nil {
		log.Printf("Stale Node Cleanup: error marking ExplorerNodes inactive: %v", explorerResult.Error)
	} else if explorerResult.RowsAffected > 0 {
		log.Printf("Stale Node Cleanup: marked %d ExplorerNode(s) inactive (no heartbeat in >%v)",
			explorerResult.RowsAffected, staleNodeOfflineThreshold)
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
