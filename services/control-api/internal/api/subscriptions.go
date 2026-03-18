package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/prices"
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
	db.Social().Where("is_active = ?", true).Order("price_monthly ASC").Find(&plans)

	c.JSON(http.StatusOK, gin.H{"plans": plans})
}

// getMySubscription returns the current user's subscription
func getMySubscription(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var subscription models.UserSubscription
	err := db.Social().Preload("Plan").
		Where("user_id = ? AND status = ?", userID, models.SubscriptionActive).
		First(&subscription).Error

	if err != nil {
		// No active subscription, return free tier info
		var freePlan models.SubscriptionPlan
		db.Social().Where("name = ?", "Free").First(&freePlan)
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
	if err := db.Social().Where("user_id = ? AND status = ?", userID, models.SubscriptionActive).
		First(&existing).Error; err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Already have an active subscription. Use change plan instead."})
		return
	}

	// Get plan
	var plan models.SubscriptionPlan
	if err := db.Social().First(&plan, "id = ?", req.PlanID).Error; err != nil {
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

	db.Social().Preload("Plan").First(&subscription, "id = ?", subscription.ID)

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
	if err := db.Social().Preload("Plan").Where("user_id = ? AND status = ?", userID, models.SubscriptionActive).
		First(&subscription).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No active subscription found"})
		return
	}

	var newPlan models.SubscriptionPlan
	if err := db.Social().First(&newPlan, "id = ?", req.NewPlanID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Plan not found"})
		return
	}

	// Calculate prorated amount (simplified: just switch at next billing)
	db.Social().Model(&subscription).Update("plan_id", newPlan.ID)

	c.JSON(http.StatusOK, gin.H{
		"message":  "Plan changed to " + newPlan.Name + ". Changes take effect next billing period.",
		"new_plan": newPlan,
	})
}

// cancelSubscription cancels the current subscription
func cancelSubscription(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var req models.CancelSubscriptionRequest
	c.ShouldBindJSON(&req) // Optional reason

	var subscription models.UserSubscription
	if err := db.Social().Where("user_id = ? AND status = ?", userID, models.SubscriptionActive).
		First(&subscription).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No active subscription found"})
		return
	}

	now := time.Now()
	db.Social().Model(&subscription).Updates(map[string]interface{}{
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
	err := db.Social().Preload("Plan").
		Where("user_id = ? AND status = ?", userID, models.SubscriptionActive).
		First(&subscription).Error

	if err != nil {
		// No subscription, use free tier limits
		switch limitType {
		case "listings":
			var count int64
			db.DB.Model(&models.ProxyListing{}).Where("seller_id = ?", userID).Count(&count)
			return count < 2, nil // Free tier: 2 listings
		case "api_access":
			return false, nil // Free tier: no API access
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
