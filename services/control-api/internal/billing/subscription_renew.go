package billing

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/prices"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// RenewDueSubscriptions extends active, non-cancelled subscriptions whose
// period has ended by debiting custodial SOL. Failures mark past_due so the
// entitlement layer can demote the buyer on the next read.
func RenewDueSubscriptions(ctx context.Context, limit int) (renewed, pastDue, skipped int) {
	if limit <= 0 {
		limit = 50
	}
	now := time.Now().UTC()

	var due []models.UserSubscription
	if err := db.DB.Preload("Plan").
		Where("status = ? AND cancelled_at IS NULL", models.SubscriptionActive).
		Where("current_period_end IS NOT NULL AND current_period_end <= ?", now).
		Order("current_period_end ASC").
		Limit(limit).
		Find(&due).Error; err != nil {
		logging.Error(err).Msg("subscription renew: query failed")
		return 0, 0, 0
	}

	for i := range due {
		sub := &due[i]
		if sub.Plan == nil {
			skipped++
			continue
		}
		if strings.EqualFold(sub.Plan.Name, "free") || (sub.Plan.PriceMonthly <= 0 && sub.Plan.PriceYearly <= 0) {
			// Free plan: just roll the window forward.
			if err := extendSubscriptionPeriod(sub, now); err != nil {
				logging.Error(err).Str("subscription_id", sub.ID.String()).Msg("subscription renew: free extend failed")
				skipped++
				continue
			}
			renewed++
			continue
		}

		priceUSD := sub.Plan.PriceMonthly
		extendByYear := false
		if sub.BillingCycle == models.BillingYearly {
			priceUSD = sub.Plan.PriceYearly
			extendByYear = true
		}
		solPrice, err := prices.GetSOLPrice(ctx)
		if err != nil || solPrice <= 0 {
			logging.Warn().Err(err).Msg("subscription renew: SOL price unavailable")
			_ = markSubscriptionPastDue(sub, now)
			pastDue++
			continue
		}
		priceSOL := priceUSD / solPrice

		err = db.DB.Transaction(func(tx *gorm.DB) error {
			var wallet models.Wallet
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("user_id = ?", sub.UserID).First(&wallet).Error; err != nil {
				return fmt.Errorf("wallet missing: %w", err)
			}
			if !wallet.CanAffordSOL(priceSOL) || !wallet.DebitSOL(priceSOL) {
				return fmt.Errorf("insufficient SOL balance")
			}
			if err := tx.Model(&wallet).Update("balance_sol", wallet.BalanceSOL).Error; err != nil {
				return err
			}
			if err := tx.Create(&models.WalletLedgerEntry{
				WalletID:     wallet.ID,
				Amount:       -priceSOL,
				BalanceAfter: wallet.BalanceSOL,
				Type:         "subscription_renewal",
				ReferenceID:  sub.ID.String(),
				Description:  fmt.Sprintf("Auto-renew %s (%.4f SOL)", sub.Plan.Name, priceSOL),
			}).Error; err != nil {
				return err
			}

			periodStart := now
			var periodEnd time.Time
			if extendByYear {
				periodEnd = now.AddDate(1, 0, 0)
			} else {
				periodEnd = now.AddDate(0, 1, 0)
			}
			return tx.Model(sub).Updates(map[string]interface{}{
				"current_period_start": periodStart,
				"current_period_end":   periodEnd,
				"status":               models.SubscriptionActive,
				"updated_at":           now,
			}).Error
		})
		if err != nil {
			logging.Warn().Err(err).
				Str("subscription_id", sub.ID.String()).
				Str("user_id", sub.UserID.String()).
				Msg("subscription renew: debit failed — marking past_due")
			_ = markSubscriptionPastDue(sub, now)
			pastDue++
			continue
		}
		renewed++
	}
	return renewed, pastDue, skipped
}

func extendSubscriptionPeriod(sub *models.UserSubscription, now time.Time) error {
	periodEnd := now.AddDate(0, 1, 0)
	if sub.BillingCycle == models.BillingYearly {
		periodEnd = now.AddDate(1, 0, 0)
	}
	return db.DB.Model(sub).Updates(map[string]interface{}{
		"current_period_start": now,
		"current_period_end":   periodEnd,
		"status":               models.SubscriptionActive,
		"updated_at":           now,
	}).Error
}

func markSubscriptionPastDue(sub *models.UserSubscription, now time.Time) error {
	return db.DB.Model(sub).Updates(map[string]interface{}{
		"status":     models.SubscriptionPastDue,
		"updated_at": now,
	}).Error
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
