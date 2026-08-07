package worker

import (
	"log"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// StartSessionIntentExpireWorker marks pre-activation intents past expires_at as expired.
// Mirrors syncSessionIntentExpiration but runs in bulk so stale authorized/routed
// intents do not linger until the next status poll.
func StartSessionIntentExpireWorker() {
	GoSupervised("SessionIntentExpire", 5*time.Second, func() {
		log.Printf("Session Intent Expire worker started — checking every 60s")
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			RunSafely("SessionIntentExpire.cycle", expireStaleSessionIntents)
		}
	})
}

func expireStaleSessionIntents() {
	if db.DB == nil {
		return
	}

	now := time.Now().UTC()
	result := db.DB.Model(&models.SessionIntentRecord{}).
		Where("lifecycle_state IN ? AND expires_at <= ?", []models.SessionIntentLifecycle{
			models.SessionIntentAuthorized,
			models.SessionIntentRouted,
		}, now).
		Updates(map[string]interface{}{
			"lifecycle_state": models.SessionIntentExpired,
			"expired_at":      now,
			"last_seen_at":    now,
		})

	if result.Error != nil {
		log.Printf("Session Intent Expire: error: %v", result.Error)
		return
	}
	if result.RowsAffected > 0 {
		log.Printf("Session Intent Expire: marked %d intent(s) expired", result.RowsAffected)
	}
}
