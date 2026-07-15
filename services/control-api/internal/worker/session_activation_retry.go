package worker

import (
	"context"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/marketplace"
	"github.com/proxyhubb/control-api/internal/models"
)

const (
	sessionActivationRetryInterval = time.Minute
	sessionActivationRetryLimit    = 25
	sessionActivationRetryBackoff  = 30 * time.Second
)

// StartSessionActivationRetryWorker retries escrow-confirmed sessions that were
// paid for but not successfully provisioned into Redis for gateway auth.
func StartSessionActivationRetryWorker() {
	GoSupervised("SessionActivationRetryWorker", 5*time.Second, func() {
		ticker := time.NewTicker(sessionActivationRetryInterval)
		defer ticker.Stop()

		for {
			RunSessionActivationRetryOnce(context.Background(), sessionActivationRetryLimit)
			<-ticker.C
		}
	})
}

func RunSessionActivationRetryOnce(ctx context.Context, limit int) {
	if limit <= 0 {
		limit = sessionActivationRetryLimit
	}

	var events []models.EscrowReconciliationEvent
	if err := db.DB.WithContext(ctx).
		Where("source = ? AND event_type = ?", marketplace.SessionActivationEventSource, marketplace.SessionActivationEventType).
		Where("status IN ?", []string{
			models.EscrowReconciliationStatusActivationPending,
			models.EscrowReconciliationStatusActivationFailed,
		}).
		Where("order_id IS NOT NULL").
		Where("last_seen_at <= ?", time.Now().Add(-sessionActivationRetryBackoff)).
		Order("last_seen_at ASC").
		Limit(limit).
		Find(&events).Error; err != nil {
		logging.Error(err).Msg("Failed to load pending session activation retries")
		return
	}

	for _, event := range events {
		if event.OrderID == nil {
			continue
		}
		if err := marketplace.ActivateOrderSession(ctx, *event.OrderID); err != nil {
			logging.Warn().
				Err(err).
				Str("event_id", event.ID.String()).
				Str("order_id", event.OrderID.String()).
				Msg("Session activation retry failed")
			continue
		}
		logging.Info().
			Str("event_id", event.ID.String()).
			Str("order_id", event.OrderID.String()).
			Msg("Session activation retry succeeded")
	}
}
