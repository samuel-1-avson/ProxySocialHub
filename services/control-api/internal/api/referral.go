package api

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/ws"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// RegisterReferralRoutes registers referral program routes
func RegisterReferralRoutes(rg *gin.RouterGroup) {
	rg.GET("/referral/code", getMyReferralCode)
	rg.POST("/referral/code", generateReferralCode)
	rg.GET("/referral/rewards", getMyRewards)
	rg.GET("/referral/stats", getReferralStats)
}

// Referral reward amounts (SOL)
const (
	SignupReward        = 0.05  // 0.05 SOL when someone signs up
	FirstPurchaseReward = 0.10  // 0.10 SOL when referred user makes first purchase
)

// getMyReferralCode returns user's referral code
func getMyReferralCode(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var code models.ReferralCode
	err := db.DB.Where("user_id = ?", userID).First(&code).Error
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"referral_code": nil, "message": "No referral code yet. Generate one!"})
		return
	}

	c.JSON(http.StatusOK, code)
}

// generateReferralCode creates a new referral code
func generateReferralCode(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	// Check if already has one
	var existing models.ReferralCode
	if db.DB.Where("user_id = ?", userID).First(&existing).Error == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "You already have a referral code", "code": existing.Code})
		return
	}

	// Generate unique code
	code := generateUniqueCode()

	referralCode := models.ReferralCode{
		UserID:   userID,
		Code:     code,
		IsActive: true,
	}

	if err := db.DB.Create(&referralCode).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create referral code"})
		return
	}

	c.JSON(http.StatusCreated, referralCode)
}

// getMyRewards returns referral rewards
func getMyRewards(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var rewards []models.ReferralReward
	db.DB.Preload("Referred").Where("referrer_id = ?", userID).Order("created_at DESC").Find(&rewards)

	c.JSON(http.StatusOK, gin.H{"rewards": rewards})
}

// getReferralStats returns referral statistics
func getReferralStats(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var code models.ReferralCode
	if err := db.DB.Where("user_id = ?", userID).First(&code).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{
			"total_referrals":  0,
			"total_earnings":   0,
			"pending_rewards":  0,
			"credited_rewards": 0,
		})
		return
	}

	var pendingCount, creditedCount int64
	var pendingAmount, creditedAmount float64

	db.DB.Model(&models.ReferralReward{}).Where("referrer_id = ? AND status = ?", userID, models.RewardPending).Count(&pendingCount)
	db.DB.Model(&models.ReferralReward{}).Where("referrer_id = ? AND status = ?", userID, models.RewardCredited).Count(&creditedCount)

	db.DB.Model(&models.ReferralReward{}).Where("referrer_id = ? AND status = ?", userID, models.RewardPending).Select("COALESCE(SUM(reward_amount), 0)").Scan(&pendingAmount)
	db.DB.Model(&models.ReferralReward{}).Where("referrer_id = ? AND status = ?", userID, models.RewardCredited).Select("COALESCE(SUM(reward_amount), 0)").Scan(&creditedAmount)

	c.JSON(http.StatusOK, gin.H{
		"referral_code":    code.Code,
		"total_referrals":  code.UsesCount,
		"total_earnings":   code.TotalEarnings,
		"pending_rewards":  pendingAmount,
		"credited_rewards": creditedAmount,
	})
}

// ProcessReferralSignup handles referral when new user signs up.
// Safe to call with empty/invalid codes (no-op). Idempotent per referred user.
func ProcessReferralSignup(newUserID uuid.UUID, referralCode string) {
	referralCode = strings.ToUpper(strings.TrimSpace(referralCode))
	if referralCode == "" || newUserID == uuid.Nil {
		return
	}

	var code models.ReferralCode
	if err := db.DB.Where("UPPER(code) = ? AND is_active = ?", referralCode, true).First(&code).Error; err != nil {
		return // Invalid code
	}

	// Can't refer yourself
	if code.UserID == newUserID {
		return
	}

	// One signup attribution per referred user
	var existing models.ReferralReward
	if err := db.DB.Where("referred_id = ? AND reward_type = ?", newUserID, models.RewardSignup).
		First(&existing).Error; err == nil {
		return
	}

	reward := models.ReferralReward{
		ReferrerID:   code.UserID,
		ReferredID:   newUserID,
		ReferralCode: code.Code,
		RewardAmount: SignupReward,
		RewardType:   models.RewardSignup,
		Status:       models.RewardPending,
	}
	if err := db.DB.Create(&reward).Error; err != nil {
		logging.Error(err).
			Str("referred_id", newUserID.String()).
			Str("code", code.Code).
			Msg("Failed to create referral signup reward")
		return
	}

	if err := db.DB.Model(&code).Update("uses_count", gorm.Expr("uses_count + 1")).Error; err != nil {
		logging.Error(err).Str("code", code.Code).Msg("Failed to increment referral uses_count")
	}

	CreditReferralReward(reward.ID)
}

// CreditReferralReward credits a pending reward
func CreditReferralReward(rewardID uuid.UUID) {
	var reward models.ReferralReward
	if err := db.DB.First(&reward, "id = ?", rewardID).Error; err != nil {
		return
	}

	if reward.Status != models.RewardPending {
		return
	}

	err := db.DB.Transaction(func(tx *gorm.DB) error {
		var locked models.ReferralReward
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND status = ?", rewardID, models.RewardPending).
			First(&locked).Error; err != nil {
			return err
		}

		wallet, err := models.LockWalletForUpdate(tx, locked.ReferrerID)
		if err != nil {
			return err
		}
		if err := models.CreditWalletLocked(tx, wallet, locked.RewardAmount, "referral_reward",
			locked.ID.String(), "Referral reward"); err != nil {
			return err
		}

		if err := tx.Model(&locked).Update("status", models.RewardCredited).Error; err != nil {
			return err
		}

		var code models.ReferralCode
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("code = ?", locked.ReferralCode).First(&code).Error; err == nil {
			if err := tx.Model(&code).Update("total_earnings", code.TotalEarnings+locked.RewardAmount).Error; err != nil {
				return err
			}
		}
		reward = locked
		return nil
	})
	if err != nil {
		logging.Error(err).Str("reward_id", rewardID.String()).Msg("Failed to credit referral reward")
		return
	}

	ws.BroadcastToUser(reward.ReferrerID.String(), ws.MsgTypeNotification, gin.H{
		"type":    "referral_reward",
		"amount":  reward.RewardAmount,
		"message": "You earned " + fmt.Sprintf("%.4f", reward.RewardAmount) + " SOL from a referral!",
	})
}

func generateUniqueCode() string {
	bytes := make([]byte, 4)
	rand.Read(bytes)
	return strings.ToUpper(hex.EncodeToString(bytes))
}
