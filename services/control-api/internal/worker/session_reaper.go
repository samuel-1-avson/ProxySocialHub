package worker

import (
	"log"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/redis"
)

// SessionReaper cleans up inconsistent session states between DB and Redis
func StartSessionReaper() {
	log.Printf("[Worker] Session Reaper started (Interval: 5m)")

	GoSupervised("SessionReaper", 5*time.Second, func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			RunSafely("SessionReaper.cycle", reap)
		}
	})
}

func reap() {
	log.Printf("[SessionReaper] Running reconciliation cycle...")

	// 1. Ghost Detection: Active in DB but missing/expired in Redis
	var activeSessions []models.Session
	db.DB.Where("status = ?", models.SessionActive).Find(&activeSessions)

	ghostCount := 0
	for _, session := range activeSessions {
		// Check if credentials still exist in Redis
		exists, err := redis.SessionExists(session.CredentialsUser)
		if err != nil {
			continue
		}

		if !exists {
			// Ghost detected! DB thinks it's active, but Gateway can't auth it.
			log.Printf("[SessionReaper] Ghost detected: %s (Terminating in DB)", session.ID)
			if err := models.ValidateSessionStatusTransition(session.Status, models.SessionTerminated); err != nil {
				log.Printf("[SessionReaper] Invalid termination transition for session %s: %v", session.ID, err)
				continue
			}
			db.DB.Model(&session).Update("status", models.SessionTerminated)
			ghostCount++
		}
	}

	// 2. Zombie Detection: Gateway auth exists in Redis but DB says it's terminated
	// This is slightly harder without Scanning all keys, but we can do it via a set if we had one.
	// For now, we rely on TTL in Redis (24h) to clean up most zombies.
	// Future: Implement a 'sessions:active' set in Redis.

	if ghostCount > 0 {
		log.Printf("[SessionReaper] Cycle complete. Purged %d ghost sessions.", ghostCount)
	}
}
