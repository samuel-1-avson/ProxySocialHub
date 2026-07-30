package api

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/prices"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// RegisterSubscriptionRoutes registers subscription-related routes
func RegisterSubscriptionRoutes(rg *gin.RouterGroup) {
	rg.GET("/subscriptions/plans", getPlans)
	rg.GET("/subscriptions/my", getMySubscription)
	rg.POST("/subscriptions", subscribe)
	rg.PUT("/subscriptions", changePlan)
	rg.DELETE("/subscriptions", cancelSubscription)
}

func getPlans(c *gin.Context) {
	var plans []models.SubscriptionPlan
	db.DB.Where("is_active = ?", true).Order("price_monthly ASC").Find(&plans)
	c.JSON(http.StatusOK, gin.H{"plans": plans})
}

func getMySubscription(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	plan, sub, err := ResolveEntitledPlan(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load subscription"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"subscription": sub,
		"current_plan": plan,
	})
}

func subscribe(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var req models.SubscribeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.BillingCycle != models.BillingMonthly && req.BillingCycle != models.BillingYearly {
		c.JSON(http.StatusBadRequest, gin.H{"error": "billing_cycle must be monthly or yearly"})
		return
	}

	var existing models.UserSubscription
	if err := db.DB.Where("user_id = ? AND status = ?", userID, models.SubscriptionActive).
		First(&existing).Error; err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Already have an active subscription. Use change plan instead."})
		return
	}

	var plan models.SubscriptionPlan
	if err := db.DB.First(&plan, "id = ?", req.PlanID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Plan not found"})
		return
	}
	if !plan.IsActive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Plan is not available"})
		return
	}

	var priceUSD float64
	var periodEnd time.Time
	if req.BillingCycle == models.BillingYearly {
		priceUSD = plan.PriceYearly
		periodEnd = time.Now().UTC().AddDate(1, 0, 0)
	} else {
		priceUSD = plan.PriceMonthly
		periodEnd = time.Now().UTC().AddDate(0, 1, 0)
	}

	isFreePlan := strings.EqualFold(plan.Name, "free") || priceUSD <= 0
	var priceSOL float64
	if !isFreePlan {
		solPrice, err := prices.GetSOLPrice(c.Request.Context())
		if err != nil || solPrice <= 0 {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SOL price unavailable, cannot calculate subscription cost"})
			return
		}
		priceSOL = priceUSD / solPrice
	}

	var subscription models.UserSubscription
	err := db.DB.Transaction(func(tx *gorm.DB) error {
		if !isFreePlan {
			var wallet models.Wallet
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("user_id = ?", userID).First(&wallet).Error; err != nil {
				return fmt.Errorf("no wallet found")
			}
			if !wallet.CanAffordSOL(priceSOL) {
				return fmt.Errorf("insufficient SOL balance")
			}
			if !wallet.DebitSOL(priceSOL) {
				return fmt.Errorf("insufficient SOL balance")
			}
			if err := tx.Model(&wallet).Update("balance_sol", wallet.BalanceSOL).Error; err != nil {
				return err
			}
			if err := tx.Create(&models.WalletLedgerEntry{
				WalletID:     wallet.ID,
				Amount:       -priceSOL,
				BalanceAfter: wallet.BalanceSOL,
				Type:         "subscription",
				ReferenceID:  req.PlanID.String(),
				Description:  fmt.Sprintf("Subscription to %s (%.4f SOL)", plan.Name, priceSOL),
			}).Error; err != nil {
				return err
			}
		}

		subscription = models.UserSubscription{
			UserID:             userID,
			PlanID:             plan.ID,
			Status:             models.SubscriptionActive,
			BillingCycle:       req.BillingCycle,
			CurrentPeriodStart: time.Now().UTC(),
			CurrentPeriodEnd:   &periodEnd,
		}
		return tx.Create(&subscription).Error
	})
	if err != nil {
		msg := err.Error()
		status := http.StatusBadRequest
		if strings.Contains(msg, "insufficient") {
			status = http.StatusPaymentRequired
		}
		c.JSON(status, gin.H{"error": msg})
		return
	}

	db.DB.Preload("Plan").First(&subscription, "id = ?", subscription.ID)
	actor := userID
	RecordAuditLog(c, models.AuditSettingsChanged, models.AuditSeverityInfo, &actor, "subscription", subscription.ID.String(),
		fmt.Sprintf("Subscribed to plan %s", plan.Name), true)

	c.JSON(http.StatusCreated, gin.H{
		"subscription": subscription,
		"charged_sol":  priceSOL,
		"message":      "Successfully subscribed to " + plan.Name,
	})
}

func changePlan(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

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
	if !newPlan.IsActive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Plan is not available"})
		return
	}
	if newPlan.ID == subscription.PlanID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Already on this plan"})
		return
	}

	now := time.Now().UTC()
	solPrice, err := prices.GetSOLPrice(c.Request.Context())
	if err != nil || solPrice <= 0 {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "price service unavailable"})
		return
	}

	var periodDays float64 = 30
	var oldPriceUSD, newPriceUSD float64
	if subscription.BillingCycle == models.BillingYearly {
		periodDays = 365
		oldPriceUSD = subscription.Plan.PriceYearly
		newPriceUSD = newPlan.PriceYearly
	} else {
		oldPriceUSD = subscription.Plan.PriceMonthly
		newPriceUSD = newPlan.PriceMonthly
	}

	remainingFraction := 1.0
	if subscription.CurrentPeriodEnd != nil && subscription.CurrentPeriodEnd.After(now) {
		totalSecs := subscription.CurrentPeriodEnd.Sub(subscription.CurrentPeriodStart).Seconds()
		remainingSecs := subscription.CurrentPeriodEnd.Sub(now).Seconds()
		if totalSecs > 0 {
			remainingFraction = remainingSecs / totalSecs
		}
	}

	creditSOL := (oldPriceUSD * remainingFraction) / solPrice
	chargeSOL := (newPriceUSD * remainingFraction) / solPrice
	netSOL := chargeSOL - creditSOL

	err = db.DB.Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).First(&wallet).Error; err != nil {
			return fmt.Errorf("wallet not found: %w", err)
		}

		if netSOL > 0 {
			if !wallet.CanAffordSOL(netSOL) {
				return fmt.Errorf("insufficient balance: need %.6f SOL, have %.6f SOL", netSOL, wallet.BalanceSOL)
			}
			if !wallet.DebitSOL(netSOL) {
				return fmt.Errorf("insufficient balance: need %.6f SOL, have %.6f SOL", netSOL, wallet.BalanceSOL)
			}
			if err := tx.Model(&wallet).Update("balance_sol", wallet.BalanceSOL).Error; err != nil {
				return fmt.Errorf("failed to debit wallet: %w", err)
			}
			if err := tx.Create(&models.WalletLedgerEntry{
				WalletID:     wallet.ID,
				Amount:       -netSOL,
				BalanceAfter: wallet.BalanceSOL,
				Type:         "subscription_upgrade",
				Description:  fmt.Sprintf("Prorated upgrade from %s to %s (%.4f SOL)", subscription.Plan.Name, newPlan.Name, netSOL),
			}).Error; err != nil {
				return fmt.Errorf("failed to create ledger: %w", err)
			}
		} else if netSOL < 0 {
			creditAmount := -netSOL
			wallet.CreditSOL(creditAmount)
			if err := tx.Model(&wallet).Update("balance_sol", wallet.BalanceSOL).Error; err != nil {
				return fmt.Errorf("failed to credit wallet: %w", err)
			}
			if err := tx.Create(&models.WalletLedgerEntry{
				WalletID:     wallet.ID,
				Amount:       creditAmount,
				BalanceAfter: wallet.BalanceSOL,
				Type:         "subscription_downgrade_credit",
				Description:  fmt.Sprintf("Prorated credit for downgrade from %s to %s (%.4f SOL)", subscription.Plan.Name, newPlan.Name, creditAmount),
			}).Error; err != nil {
				return fmt.Errorf("failed to create ledger: %w", err)
			}
		}

		return tx.Model(&subscription).Updates(map[string]interface{}{
			"plan_id":    newPlan.ID,
			"updated_at": time.Now().UTC(),
		}).Error
	})
	if err != nil {
		logging.Error(err).Str("user_id", userID.String()).Msg("Subscription proration failed")
		c.JSON(http.StatusPaymentRequired, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":         fmt.Sprintf("Plan changed to %s with immediate effect", newPlan.Name),
		"new_plan":        newPlan,
		"prorated_charge": netSOL,
		"remaining_days":  remainingFraction * periodDays,
	})
}

func cancelSubscription(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var req models.CancelSubscriptionRequest
	_ = c.ShouldBindJSON(&req)

	var subscription models.UserSubscription
	if err := db.DB.Where("user_id = ? AND status = ?", userID, models.SubscriptionActive).
		First(&subscription).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No active subscription found"})
		return
	}

	now := time.Now().UTC()
	if err := db.DB.Model(&subscription).Updates(map[string]interface{}{
		"status":       models.SubscriptionCancelled,
		"cancelled_at": now,
		"updated_at":   now,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to cancel subscription"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      "Subscription cancelled. Access continues until end of current period.",
		"access_until": subscription.CurrentPeriodEnd,
	})
}
