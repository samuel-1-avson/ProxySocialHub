package api

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// ResolveEntitledPlan returns a synthetic plan from Access Pass entitlement.
// Legacy DB subscriptions still entitle during grace (via ResolvePassEntitlement).
// Prefer ResolvePassEntitlement for new call sites.
func ResolveEntitledPlan(userID uuid.UUID) (*models.SubscriptionPlan, *models.UserSubscription, error) {
	ent, err := ResolvePassEntitlement(userID)
	if err != nil {
		return nil, nil, err
	}
	return passEntitlementAsPlan(ent), ent.LegacySub, nil
}

func loadFreePlan() (*models.SubscriptionPlan, error) {
	ent := entitlementFromCaps(PassTierNone, "free")
	return passEntitlementAsPlan(&ent), nil
}

// PlanBandwidthRemainingGB returns remaining period quota for the buyer.
// unlimited=true when the entitlement has NULL bandwidth_limit_gb.
func PlanBandwidthRemainingGB(userID uuid.UUID) (remaining float64, unlimited bool, limitGB float64, err error) {
	ent, err := ResolvePassEntitlement(userID)
	if err != nil {
		return 0, false, 0, err
	}
	if ent.BandwidthLimitGB == nil {
		return 0, true, 0, nil
	}
	limitGB = float64(*ent.BandwidthLimitGB)
	periodStart := ent.PeriodStart
	if periodStart.IsZero() {
		periodStart = time.Now().UTC().AddDate(0, -1, 0)
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

// EnsureBuyerBandwidthQuota rejects marketplace purchases that exceed pass remaining GB.
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
			"access pass bandwidth quota exceeded: requesting %.2f GB, remaining %.2f GB of %.0f GB period limit. Get a bigger Access Pass",
			requestGB, remaining, limitGB,
		)
	}
	return nil
}

// CheckSubscriptionLimits checks if user is within their pass entitlement limits.
func CheckSubscriptionLimits(userID uuid.UUID, limitType string) (bool, error) {
	ent, err := ResolvePassEntitlement(userID)
	if err != nil {
		return false, err
	}

	switch strings.ToLower(limitType) {
	case "listings":
		if ent.ListingLimit == 0 {
			return true, nil // unlimited
		}
		var count int64
		if err := db.DB.Model(&models.ProxyListing{}).
			Where("seller_id = ? AND status != ?", userID, models.ListingStatusDeleted).
			Count(&count).Error; err != nil {
			return false, err
		}
		return count < int64(ent.ListingLimit), nil
	case "api_access":
		return ent.Features.APIAccess, nil
	case "teams":
		if ent.Features.TeamMembers < 0 {
			return true, nil // unlimited
		}
		if ent.Features.TeamMembers == 0 {
			return false, nil
		}
		var count int64
		if err := db.DB.Model(&models.Team{}).Where("owner_id = ?", userID).Count(&count).Error; err != nil {
			return false, err
		}
		return count < int64(ent.Features.TeamMembers), nil
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
