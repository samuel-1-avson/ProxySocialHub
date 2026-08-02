package worker

import (
	"context"
	"time"

	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/logging"
)

const (
	subscriptionRenewInterval = 15 * time.Minute
	subscriptionRenewBatch    = 100
	subscriptionPastDueGrace  = 72 * time.Hour
)

// StartSubscriptionRenewalWorker closes ended legacy subscription periods.
// It does NOT debit custodial SOL (Access Passes replaced auto-renew).
func StartSubscriptionRenewalWorker() {
	GoSupervised("SubscriptionRenewalWorker", 30*time.Second, func() {
		ticker := time.NewTicker(subscriptionRenewInterval)
		defer ticker.Stop()

		RunSubscriptionRenewalOnce(context.Background())
		for range ticker.C {
			RunSubscriptionRenewalOnce(context.Background())
		}
	})
}

// RunSubscriptionRenewalOnce is exported for tests.
func RunSubscriptionRenewalOnce(ctx context.Context) {
	_, _, closed := billing.RenewDueSubscriptions(ctx, subscriptionRenewBatch)
	expired := billing.ExpirePastDueSubscriptions(subscriptionPastDueGrace, subscriptionRenewBatch)
	if closed > 0 || expired > 0 {
		logging.Info().
			Int("periods_closed", closed).
			Int("past_due_expired", expired).
			Msg("legacy subscription cleanup pass complete (no custodial renew)")
	}
}
