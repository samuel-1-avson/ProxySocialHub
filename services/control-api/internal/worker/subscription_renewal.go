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

// StartSubscriptionRenewalWorker auto-renews active subscriptions whose period
// ended (debit custodial SOL). Cancelled subscriptions are never renewed.
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
	renewed, pastDue, skipped := billing.RenewDueSubscriptions(ctx, subscriptionRenewBatch)
	expired := billing.ExpirePastDueSubscriptions(subscriptionPastDueGrace, subscriptionRenewBatch)
	if renewed > 0 || pastDue > 0 || expired > 0 || skipped > 0 {
		logging.Info().
			Int("renewed", renewed).
			Int("past_due", pastDue).
			Int("expired", expired).
			Int("skipped", skipped).
			Msg("subscription renewal pass complete")
	}
}
