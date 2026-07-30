package api

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// ResolveEntitledPlan returns the plan currently entitling the user.
// Cancelled subscriptions still entitle until current_period_end.
// When none apply, returns the free plan (or a hard-coded free fallback).
func ResolveEntitledPlan(userID uuid.UUID) (*models.SubscriptionPlan, *models.UserSubscription, error) {
	now := time.Now().UTC()
	var sub models.UserSubscription
	err := db.DB.Preload("Plan").
		Where("user_id = ?", userID).
		Where(`(
			status = ? OR
			(status = ? AND current_period_end IS NOT NULL AND current_period_end > ?)
		)`, models.SubscriptionActive, models.SubscriptionCancelled, now).
		Order("current_period_end DESC NULLS LAST").
		First(&sub).Error

	if err == nil && sub.Plan != nil {
		// Expire active rows past period end on read.
		if sub.Status == models.SubscriptionActive &&
			sub.CurrentPeriodEnd != nil &&
			sub.CurrentPeriodEnd.Before(now) &&
			sub.CancelledAt == nil {
			_ = db.DB.Model(&sub).Update("status", models.SubscriptionExpired)
			plan, err := loadFreePlan()
			return plan, nil, err
		}
		return sub.Plan, &sub, nil
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return nil, nil, err
	}
	plan, ferr := loadFreePlan()
	return plan, nil, ferr
}

func loadFreePlan() (*models.SubscriptionPlan, error) {
	var free models.SubscriptionPlan
	if err := db.DB.Where("LOWER(name) = ?", "free").First(&free).Error; err != nil {
		fallback := models.SubscriptionPlan{
			Name:             "free",
			ListingLimit:     2,
			BandwidthLimitGB: intPtr(10),
			Features: models.Features{
				APIAccess:   false,
				Analytics:   false,
				TeamMembers: 0,
			},
			IsActive: true,
		}
		return &fallback, nil
	}
	return &free, nil
}

func intPtr(v int) *int { return &v }

// PlanBandwidthRemainingGB returns remaining monthly plan quota for the buyer.
// unlimited=true when the plan has NULL bandwidth_limit_gb.
func PlanBandwidthRemainingGB(userID uuid.UUID) (remaining float64, unlimited bool, limitGB float64, err error) {
	plan, sub, err := ResolveEntitledPlan(userID)
	if err != nil {
		return 0, false, 0, err
	}
	if plan.BandwidthLimitGB == nil {
		return 0, true, 0, nil
	}
	limitGB = float64(*plan.BandwidthLimitGB)
	periodStart := time.Now().UTC().AddDate(0, -1, 0)
	if sub != nil {
		periodStart = sub.CurrentPeriodStart
	}

	// Only count escrow-confirmed consumption. Pending drafts, abandoned
	// pending_payment, and refunded orders must not burn plan quota.
	var orderedGB float64
	if err := db.DB.Model(&models.Order{}).
		Select("COALESCE(SUM(bandwidth_gb), 0)").
		Where("buyer_id = ? AND created_at >= ?", userID, periodStart).
		Where("status IN ?", []models.OrderStatus{
			models.OrderStatusActive,
			models.OrderStatusCompleted,
		}).
		Scan(&orderedGB).Error; err != nil {
		return 0, false, limitGB, err
	}

	remaining = limitGB - orderedGB
	if remaining < 0 {
		remaining = 0
	}
	return remaining, false, limitGB, nil
}

// EnsureBuyerBandwidthQuota rejects marketplace purchases that exceed plan remaining GB.
func EnsureBuyerBandwidthQuota(userID uuid.UUID, requestGB float64) error {
	if requestGB <= 0 {
		return fmt.Errorf("bandwidth_gb must be positive")
	}
	remaining, unlimited, limitGB, err := PlanBandwidthRemainingGB(userID)
	if err != nil {
		return err
	}
	if unlimited {
		return nil
	}
	if requestGB > remaining+1e-9 {
		return fmt.Errorf(
			"plan bandwidth quota exceeded: requesting %.2f GB, remaining %.2f GB of %.0f GB period limit — upgrade your subscription",
			requestGB, remaining, limitGB,
		)
	}
	return nil
}

// CheckSubscriptionLimits checks if user is within their subscription limits.
func CheckSubscriptionLimits(userID uuid.UUID, limitType string) (bool, error) {
	plan, _, err := ResolveEntitledPlan(userID)
	if err != nil {
		return false, err
	}

	switch strings.ToLower(limitType) {
	case "listings":
		if plan.ListingLimit == 0 {
			return true, nil // unlimited
		}
		var count int64
		if err := db.DB.Model(&models.ProxyListing{}).
			Where("seller_id = ? AND status != ?", userID, models.ListingStatusDeleted).
			Count(&count).Error; err != nil {
			return false, err
		}
		return count < int64(plan.ListingLimit), nil
	case "api_access":
		return plan.Features.APIAccess, nil
	case "teams":
		if plan.Features.TeamMembers < 0 {
			return true, nil // unlimited
		}
		if plan.Features.TeamMembers == 0 {
			return false, nil
		}
		var count int64
		if err := db.DB.Model(&models.Team{}).Where("owner_id = ?", userID).Count(&count).Error; err != nil {
			return false, err
		}
		return count < int64(plan.Features.TeamMembers), nil
	case "bandwidth":
		remaining, unlimited, _, err := PlanBandwidthRemainingGB(userID)
		if err != nil {
			return false, err
		}
		if unlimited {
			return true, nil
		}
		return remaining > 0, nil
	default:
		return true, nil
	}
}
