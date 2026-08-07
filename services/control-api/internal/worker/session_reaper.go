package worker

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/marketplace"
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
	repairedCount := 0
	for _, session := range activeSessions {
		credUser := strings.TrimSpace(session.CredentialsUser)
		if credUser == "" {
			// Decrypt failure would otherwise look like a missing Redis key and
			// falsely terminate marketplace sessions (credentials → 407).
			log.Printf("[SessionReaper] Skipping session %s: empty credentials_user", session.ID)
			continue
		}

		exists, err := redis.SessionExists(credUser)
		if err != nil {
			continue
		}
		if exists {
			continue
		}

		var order models.Order
		orderLinked := db.DB.Where(
			"session_id = ? AND status IN ?",
			session.ID,
			[]models.OrderStatus{
				models.OrderStatusPending,
				models.OrderStatusPendingPayment,
				models.OrderStatusActive,
			},
		).First(&order).Error == nil

		if orderLinked {
			// Escrow-backed orders must stay usable; re-sync Redis instead of kill.
			log.Printf("[SessionReaper] Redis missing for order-linked session %s (order %s); re-syncing", session.ID, order.ID)
			if syncErr := marketplace.ActivateOrderSession(context.Background(), order.ID); syncErr != nil {
				log.Printf("[SessionReaper] Re-sync failed for session %s: %v", session.ID, syncErr)
			} else {
				repairedCount++
			}
			continue
		}

		log.Printf("[SessionReaper] Ghost detected: %s (Terminating in DB)", session.ID)
		if err := models.ValidateSessionStatusTransition(session.Status, models.SessionTerminated); err != nil {
			log.Printf("[SessionReaper] Invalid termination transition for session %s: %v", session.ID, err)
			continue
		}
		db.DB.Model(&session).Update("status", models.SessionTerminated)
		ghostCount++
	}

	if ghostCount > 0 || repairedCount > 0 {
		log.Printf("[SessionReaper] Cycle complete. Purged %d ghosts, repaired %d order-linked sessions.", ghostCount, repairedCount)
	}
}
