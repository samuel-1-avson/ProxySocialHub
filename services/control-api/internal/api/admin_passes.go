package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// RegisterAdminPassRoutes registers ops endpoints for Pro→Silver / Scale→Gold airdrops.
func RegisterAdminPassRoutes(r *gin.RouterGroup) {
	passes := r.Group("/passes")
	passes.Use(RequirePermission("system:audit"))
	{
		passes.POST("/airdrop-queue", queuePassAirdrops)
		passes.GET("/airdrop-queue", listPassAirdrops)
		passes.POST("/airdrop-queue/:id/complete", completePassAirdrop)
	}
}

type queuePassAirdropsRequest struct {
	DryRun bool `json:"dry_run"`
}

func queuePassAirdrops(c *gin.Context) {
	var req queuePassAirdropsRequest
	_ = c.ShouldBindJSON(&req)

	now := time.Now().UTC()
	var subs []models.UserSubscription
	if err := db.DB.Preload("Plan").Preload("User").
		Where(`(
			status = ? OR
			(status = ? AND current_period_end IS NOT NULL AND current_period_end > ?)
		)`, models.SubscriptionActive, models.SubscriptionCancelled, now).
		Find(&subs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load legacy subscriptions"})
		return
	}

	queued := 0
	skipped := 0
	var preview []gin.H

	for i := range subs {
		sub := &subs[i]
		if sub.Plan == nil {
			skipped++
			continue
		}
		tier := mapLegacyPlanToTier(sub.Plan)
		if tier != PassTierSilver && tier != PassTierGold {
			skipped++
			continue
		}
		wallet := ""
		if sub.User != nil && sub.User.WalletAddress != nil {
			wallet = strings.TrimSpace(*sub.User.WalletAddress)
		}
		if wallet == "" {
			wallet = profileWalletAddress(sub.UserID)
		}

		preview = append(preview, gin.H{
			"user_id":    sub.UserID,
			"tier":       tier,
			"plan":       sub.Plan.Name,
			"wallet":     wallet,
			"period_end": sub.CurrentPeriodEnd,
		})

		if req.DryRun {
			continue
		}

		var claim models.PassAirdropClaim
		err := db.DB.Where("user_id = ? AND tier = ?", sub.UserID, string(tier)).First(&claim).Error
		if err == gorm.ErrRecordNotFound {
			claim = models.PassAirdropClaim{
				ID:             uuid.New(),
				UserID:         sub.UserID,
				Tier:           string(tier),
				WalletAddress:  wallet,
				SourcePlanName: sub.Plan.Name,
				Status:         models.PassAirdropQueued,
			}
			if createErr := db.DB.Create(&claim).Error; createErr != nil {
				skipped++
				continue
			}
			queued++
			continue
		}
		if err != nil {
			skipped++
			continue
		}
		if claim.Status == models.PassAirdropCompleted {
			skipped++
			continue
		}
		if err := db.DB.Model(&claim).Updates(map[string]interface{}{
			"status":          models.PassAirdropQueued,
			"wallet_address":  wallet,
			"source_plan_name": sub.Plan.Name,
			"updated_at":      now,
		}).Error; err != nil {
			skipped++
			continue
		}
		queued++
	}

	c.JSON(http.StatusOK, gin.H{
		"dry_run": req.DryRun,
		"queued":  queued,
		"skipped": skipped,
		"preview": preview,
		"message": "Queue Silver/Gold airdrops for wallets; fulfill off-band then mark complete.",
	})
}

func listPassAirdrops(c *gin.Context) {
	status := strings.TrimSpace(c.Query("status"))
	q := db.DB.Model(&models.PassAirdropClaim{}).Order("created_at DESC").Limit(500)
	if status != "" {
		q = q.Where("status = ?", status)
	}
	var claims []models.PassAirdropClaim
	if err := q.Find(&claims).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list airdrop claims"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"claims": claims})
}

type completePassAirdropRequest struct {
	TxSignature string `json:"tx_signature"`
	Notes       string `json:"notes"`
}

func completePassAirdrop(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var req completePassAirdropRequest
	_ = c.ShouldBindJSON(&req)

	var claim models.PassAirdropClaim
	if err := db.DB.First(&claim, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Claim not found"})
		return
	}
	now := time.Now().UTC()
	updates := map[string]interface{}{
		"status":     models.PassAirdropCompleted,
		"updated_at": now,
	}
	if sig := strings.TrimSpace(req.TxSignature); sig != "" {
		updates["tx_signature"] = sig
	}
	if notes := strings.TrimSpace(req.Notes); notes != "" {
		updates["notes"] = notes
	}
	if err := db.DB.Model(&claim).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update claim"})
		return
	}
	_ = db.DB.First(&claim, "id = ?", id)
	c.JSON(http.StatusOK, gin.H{"claim": claim, "message": "Airdrop marked completed"})
}
