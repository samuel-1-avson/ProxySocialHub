package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterSubscriptionRoutes registers legacy subscription routes (read-only + cancel).
// Custodial subscribe / change-plan debit paths are retired in favor of Access Passes.
func RegisterSubscriptionRoutes(rg *gin.RouterGroup) {
	rg.GET("/subscriptions/plans", getPlans)
	rg.GET("/subscriptions/my", getMySubscription)
	rg.POST("/subscriptions", subscribeRetired)
	rg.PUT("/subscriptions", changePlanRetired)
	rg.DELETE("/subscriptions", cancelSubscription)
}

func getPlans(c *gin.Context) {
	var plans []models.SubscriptionPlan
	db.DB.Where("is_active = ?", true).Order("price_monthly ASC").Find(&plans)
	c.JSON(http.StatusOK, gin.H{
		"plans":   plans,
		"legacy":  true,
		"message": "Custodial plans are deprecated. Use GET /v1/passes/catalog for Access Passes.",
	})
}

func getMySubscription(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	ent, err := ResolvePassEntitlement(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load entitlement"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"subscription": ent.LegacySub,
		"current_plan": passEntitlementAsPlan(ent),
		"pass_tier":    ent.Tier,
		"pass_source":  ent.Source,
		"legacy":       ent.Source == "legacy_subscription",
	})
}

func subscribeRetired(c *gin.Context) {
	c.JSON(http.StatusGone, gin.H{
		"error":   "Custodial subscriptions are retired. Mint an Access Pass with your Solana wallet.",
		"passes":  "/v1/passes/catalog",
		"migrate": "/v1/passes/me",
	})
}

func changePlanRetired(c *gin.Context) {
	c.JSON(http.StatusGone, gin.H{
		"error":  "Custodial plan changes are retired. Mint a higher Access Pass on-chain.",
		"passes": "/v1/passes/catalog",
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
		c.JSON(http.StatusNotFound, gin.H{"error": "No active legacy subscription found"})
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
		"message":      "Legacy subscription cancelled. Access continues until period end unless you already hold an Access Pass.",
		"access_until": subscription.CurrentPeriodEnd,
	})
}
