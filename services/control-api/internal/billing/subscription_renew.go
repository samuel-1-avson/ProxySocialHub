package billing

import (
	"context"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

// RenewDueSubscriptions previously debited custodial SOL for auto-renew.
// That path is retired for Access Passes. Active paid rows whose period ended
// are expired (grace ends); free rows are left alone.
func RenewDueSubscriptions(ctx context.Context, limit int) (renewed, pastDue, skipped int) {
	_ = ctx
	if limit <= 0 {
		limit = 50
	}
	now := time.Now().UTC()

	res := db.DB.Model(&models.UserSubscription{}).
		Where("status = ?", models.SubscriptionActive).
		Where("cancelled_at IS NULL").
		Where("current_period_end IS NOT NULL AND current_period_end <= ?", now).
		Limit(limit).
		Updates(map[string]interface{}{
			"status":     models.SubscriptionExpired,
			"updated_at": now,
		})
	if res.Error != nil {
		logging.Error(res.Error).Msg("subscription renew(retired): expire due periods failed")
		return 0, 0, 0
	}
	expired := int(res.RowsAffected)

	// Cancelled rows past period end are already ignored by ResolvePassEntitlement.
	res2 := db.DB.Model(&models.UserSubscription{}).
		Where("status = ?", models.SubscriptionCancelled).
		Where("current_period_end IS NOT NULL AND current_period_end <= ?", now).
		Limit(limit).
		Updates(map[string]interface{}{
			"status":     models.SubscriptionExpired,
			"updated_at": now,
		})
	if res2.Error == nil {
		expired += int(res2.RowsAffected)
	}

	if expired > 0 {
		logging.Info().Int("expired", expired).Msg("legacy subscription periods closed (no custodial renew)")
	}
	return 0, 0, expired
}

// ExpirePastDueSubscriptions demotes past_due rows older than grace to expired.
func ExpirePastDueSubscriptions(grace time.Duration, limit int) int {
	if limit <= 0 {
		limit = 50
	}
	if grace <= 0 {
		grace = 72 * time.Hour
	}
	cutoff := time.Now().UTC().Add(-grace)
	res := db.DB.Model(&models.UserSubscription{}).
		Where("status = ? AND updated_at <= ?", models.SubscriptionPastDue, cutoff).
		Limit(limit).
		Updates(map[string]interface{}{
			"status":     models.SubscriptionExpired,
			"updated_at": time.Now().UTC(),
		})
	if res.Error != nil {
		logging.Error(res.Error).Msg("subscription expire past_due failed")
		return 0
	}
	return int(res.RowsAffected)
}
