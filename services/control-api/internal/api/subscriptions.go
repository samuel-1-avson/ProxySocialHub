package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/prices"
	"gorm.io/gorm"
)

// RegisterSubscriptionRoutes registers subscription-related routes
func RegisterSubscriptionRoutes(rg *gin.RouterGroup) {
	rg.GET("/subscriptions/plans", getPlans)
	rg.GET("/subscriptions/my", getMySubscription)
	rg.POST("/subscriptions", subscribe)
	rg.PUT("/subscriptions", changePlan)
	rg.DELETE("/subscriptions", cancelSubscription)
}

// getPlans returns all active subscription plans
func getPlans(c *gin.Context) {
	var plans []models.SubscriptionPlan
	db.DB.Where("is_active = ?", true).Order("price_monthly ASC").Find(&plans)

	c.JSON(http.StatusOK, gin.H{"plans": plans})
}

// getMySubscription returns the current user's subscription
func getMySubscription(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var subscription models.UserSubscription
	err := db.DB.Preload("Plan").
		Where("user_id = ? AND status = ?", userID, models.SubscriptionActive).
		First(&subscription).Error

	if err != nil {
		// No active subscription, return free tier info
		var freePlan models.SubscriptionPlan
		db.DB.Where("name = ?", "Free").First(&freePlan)
		c.JSON(http.StatusOK, gin.H{
			"subscription": nil,
			"current_plan": freePlan,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"subscription": subscription,
		"current_plan": subscription.Plan,
	})
}

// subscribe creates a new subscription
func subscribe(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var req models.SubscribeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if already subscribed
	var existing models.UserSubscription
	if err := db.DB.Where("user_id = ? AND status = ?", userID, models.SubscriptionActive).
		First(&existing).Error; err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Already have an active subscription. Use change plan instead."})
		return
	}

	// Get plan
	var plan models.SubscriptionPlan
	if err := db.DB.First(&plan, "id = ?", req.PlanID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Plan not found"})
		return
	}

	if !plan.IsActive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Plan is not available"})
		return
	}

	// Calculate price and period
	var priceUSD float64
	var periodEnd time.Time
	if req.BillingCycle == models.BillingYearly {
		priceUSD = plan.PriceYearly
		periodEnd = time.Now().AddDate(1, 0, 0)
	} else {
		priceUSD = plan.PriceMonthly
		periodEnd = time.Now().AddDate(0, 1, 0)
	}

	// Convert to SOL using pricing package
	solPrice, err := prices.GetSOLPrice(c.Request.Context())
	if err != nil {
		c.JSON(503, gin.H{"error": "price service unavailable"})
		return
	}
	// FSU-01: guard against zero/negative price to prevent division by zero panic.
	if solPrice <= 0 {
		c.JSON(503, gin.H{"error": "SOL price unavailable, cannot calculate subscription cost"})
		return
	}
	// priceUSD is in USD, convert to SOL
	priceSOL := priceUSD / solPrice

	// Charge from wallet
	var wallet models.Wallet
	if err := db.DB.First(&wallet, "user_id = ?", userID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No wallet found"})
		return
	}

	if wallet.BalanceSOL < priceSOL {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient SOL balance"})
		return
	}

	tx := db.DB.Begin()

	// Deduct from wallet
	newBalance := wallet.BalanceSOL - priceSOL
	tx.Model(&wallet).Update("balance_sol", newBalance)

	// Create ledger entry
	ledger := models.WalletLedgerEntry{
		WalletID:     wallet.ID,
		Amount:       -priceSOL,
		BalanceAfter: newBalance,
		Type:         "subscription",
		ReferenceID:  req.PlanID.String(),
		Description:  fmt.Sprintf("Subscription to %s (%.4f SOL)", plan.Name, priceSOL),
	}
	tx.Create(&ledger)

	// Create subscription
	subscription := models.UserSubscription{
		UserID:             userID,
		PlanID:             plan.ID,
		Status:             models.SubscriptionActive,
		BillingCycle:       req.BillingCycle,
		CurrentPeriodStart: time.Now(),
		CurrentPeriodEnd:   &periodEnd,
	}
	tx.Create(&subscription)

	tx.Commit()

	db.DB.Preload("Plan").First(&subscription, "id = ?", subscription.ID)

	c.JSON(http.StatusCreated, gin.H{
		"subscription": subscription,
		"message":      "Successfully subscribed to " + plan.Name,
	})
}

// changePlan upgrades/downgrades subscription
func changePlan(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var req models.ChangePlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var subscription models.UserSubscription
	if err := db.DB.Preload("Plan").Where("user_id = ? AND status = ?", userID, models.SubscriptionActive).
		First(&subscription).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No active subscription found"})
		return
	}

	var newPlan models.SubscriptionPlan
	if err := db.DB.First(&newPlan, "id = ?", req.NewPlanID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Plan not found"})
		return
	}

	if newPlan.ID == subscription.PlanID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Already on this plan"})
		return
	}

	// P3-04: Prorated billing on plan change.
	// 1. Calculate remaining fraction of the current billing period.
	// 2. Credit the user for the unused portion of the old plan.
	// 3. Charge the user the proportional cost of the new plan for the remainder.
	now := time.Now()
	solPrice, err := prices.GetSOLPrice(c.Request.Context())
	if err != nil || solPrice <= 0 {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "price service unavailable"})
		return
	}

	// Determine period length and remaining days.
	var periodDays float64 = 30 // default monthly
	var oldPriceUSD, newPriceUSD float64
	if subscription.BillingCycle == "yearly" {
		periodDays = 365
		oldPriceUSD = subscription.Plan.PriceYearly
		newPriceUSD = newPlan.PriceYearly
	} else {
		oldPriceUSD = subscription.Plan.PriceMonthly
		newPriceUSD = newPlan.PriceMonthly
	}

	var remainingFraction float64 = 1.0
	if subscription.CurrentPeriodEnd != nil && subscription.CurrentPeriodEnd.After(now) {
		totalSecs := subscription.CurrentPeriodEnd.Sub(subscription.CurrentPeriodStart).Seconds()
		remainingSecs := subscription.CurrentPeriodEnd.Sub(now).Seconds()
		if totalSecs > 0 {
			remainingFraction = remainingSecs / totalSecs
		}
	}

	creditSOL := (oldPriceUSD * remainingFraction) / solPrice
	chargeSOL := (newPriceUSD * remainingFraction) / solPrice
	netSOL := chargeSOL - creditSOL // positive = user pays more; negative = user gets credit

	// Atomic subscription proration: wallet + ledger + plan update in one transaction
	err = db.DB.Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		if err := tx.Where("user_id = ?", userID).First(&wallet).Error; err != nil {
			return fmt.Errorf("wallet not found: %w", err)
		}

		if netSOL > 0 {
			// Upgrading: debit the difference
			if wallet.BalanceSOL < netSOL {
				return fmt.Errorf("insufficient balance: need %.6f SOL, have %.6f SOL", netSOL, wallet.BalanceSOL)
			}
			newBal := wallet.BalanceSOL - netSOL
			if err := tx.Model(&wallet).Update("balance_sol", newBal).Error; err != nil {
				return fmt.Errorf("failed to debit wallet: %w", err)
			}
			if err := tx.Create(&models.WalletLedgerEntry{
				WalletID:     wallet.ID,
				Amount:       -netSOL,
				BalanceAfter: newBal,
				Type:         "subscription_upgrade",
				Description:  fmt.Sprintf("Prorated upgrade from %s to %s (%.4f SOL)", subscription.Plan.Name, newPlan.Name, netSOL),
			}).Error; err != nil {
				return fmt.Errorf("failed to create ledger: %w", err)
			}
		} else if netSOL < 0 {
			// Downgrading: credit the difference
			creditAmount := -netSOL
			newBal := wallet.BalanceSOL + creditAmount
			if err := tx.Model(&wallet).Update("balance_sol", newBal).Error; err != nil {
				return fmt.Errorf("failed to credit wallet: %w", err)
			}
			if err := tx.Create(&models.WalletLedgerEntry{
				WalletID:     wallet.ID,
				Amount:       creditAmount,
				BalanceAfter: newBal,
				Type:         "subscription_downgrade_credit",
				Description:  fmt.Sprintf("Prorated credit for downgrade from %s to %s (%.4f SOL)", subscription.Plan.Name, newPlan.Name, creditAmount),
			}).Error; err != nil {
				return fmt.Errorf("failed to create ledger: %w", err)
			}
		}

		// Update subscription plan within the same transaction
		if err := tx.Model(&subscription).Updates(map[string]interface{}{
			"plan_id":    newPlan.ID,
			"updated_at": time.Now(),
		}).Error; err != nil {
			return fmt.Errorf("failed to update subscription: %w", err)
		}

		return nil
	})

	if err != nil {
		logging.Error(err).Str("user_id", userID.String()).Msg("Subscription proration failed")
		c.JSON(http.StatusPaymentRequired, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":           fmt.Sprintf("Plan changed to %s with immediate effect", newPlan.Name),
		"new_plan":          newPlan,
		"prorated_charge":   netSOL,
		"remaining_days":    remainingFraction * periodDays,
	})
}

// cancelSubscription cancels the current subscription
func cancelSubscription(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var req models.CancelSubscriptionRequest
	c.ShouldBindJSON(&req) // Optional reason

	var subscription models.UserSubscription
	if err := db.DB.Where("user_id = ? AND status = ?", userID, models.SubscriptionActive).
		First(&subscription).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No active subscription found"})
		return
	}

	now := time.Now()
	db.DB.Model(&subscription).Updates(map[string]interface{}{
		"status":       models.SubscriptionCancelled,
		"cancelled_at": now,
	})

	c.JSON(http.StatusOK, gin.H{
		"message":      "Subscription cancelled. Access continues until end of current period.",
		"access_until": subscription.CurrentPeriodEnd,
	})
}

// CheckSubscriptionLimits checks if user is within their subscription limits
func CheckSubscriptionLimits(userID uuid.UUID, limitType string) (bool, error) {
	var subscription models.UserSubscription
	err := db.DB.Preload("Plan").
		Where("user_id = ? AND status = ?", userID, models.SubscriptionActive).
		First(&subscription).Error

	if err != nil {
		// P3-11: No subscription — look up free-tier limits from the DB.
		// The "free" plan row is the single source of truth so ops can change
		// limits without a code deploy.
		var freePlan models.SubscriptionPlan
		freeLimitErr := db.DB.Where("LOWER(name) = ?", "free").First(&freePlan).Error

		switch limitType {
		case "listings":
			var count int64
			db.DB.Model(&models.ProxyListing{}).Where("seller_id = ?", userID).Count(&count)
			freeListingLimit := int64(2) // hard fallback if no free plan row exists
			if freeLimitErr == nil && freePlan.ListingLimit > 0 {
				freeListingLimit = int64(freePlan.ListingLimit)
			}
			return count < freeListingLimit, nil
		case "api_access":
			if freeLimitErr == nil {
				return freePlan.Features.APIAccess, nil
			}
			return false, nil // default: no API access on free tier
		}
		return true, nil
	}

	switch limitType {
	case "listings":
		if subscription.Plan.ListingLimit == 0 {
			return true, nil // Unlimited
		}
		var count int64
		db.DB.Model(&models.ProxyListing{}).Where("seller_id = ?", userID).Count(&count)
		return count < int64(subscription.Plan.ListingLimit), nil
	case "api_access":
		return subscription.Plan.Features.APIAccess, nil
	}

	return true, nil
}
