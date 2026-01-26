package api

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/ws"
)

// RegisterReferralRoutes registers referral program routes
func RegisterReferralRoutes(rg *gin.RouterGroup) {
	rg.GET("/referral/code", getMyReferralCode)
	rg.POST("/referral/code", generateReferralCode)
	rg.GET("/referral/rewards", getMyRewards)
	rg.GET("/referral/stats", getReferralStats)
}

// Referral reward amounts
const (
	SignupReward        = 5.0  // GHS 5 when someone signs up
	FirstPurchaseReward = 10.0 // GHS 10 when referred user makes first purchase
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

// ProcessReferralSignup handles referral when new user signs up
func ProcessReferralSignup(newUserID uuid.UUID, referralCode string) {
	if referralCode == "" {
		return
	}

	var code models.ReferralCode
	if err := db.DB.Where("code = ? AND is_active = ?", referralCode, true).First(&code).Error; err != nil {
		return // Invalid code
	}

	// Can't refer yourself
	if code.UserID == newUserID {
		return
	}

	// Create pending reward
	reward := models.ReferralReward{
		ReferrerID:   code.UserID,
		ReferredID:   newUserID,
		ReferralCode: referralCode,
		RewardAmount: SignupReward,
		RewardType:   models.RewardSignup,
		Status:       models.RewardPending,
	}
	db.DB.Create(&reward)

	// Update code stats
	db.DB.Model(&code).Updates(map[string]interface{}{
		"uses_count": code.UsesCount + 1,
	})

	// Credit immediately (or could wait for verification)
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

	tx := db.DB.Begin()

	// Credit wallet
	var wallet models.Wallet
	if err := tx.First(&wallet, "user_id = ?", reward.ReferrerID).Error; err == nil {
		newBalance := wallet.BalanceSOL + reward.RewardAmount
		tx.Model(&wallet).Update("balance_sol", newBalance)

		ledger := models.WalletLedgerEntry{
			WalletID:     wallet.ID,
			Amount:       reward.RewardAmount,
			BalanceAfter: newBalance,
			Type:         "referral_reward",
			ReferenceID:  reward.ID.String(),
			Description:  "Referral reward",
		}
		tx.Create(&ledger)
	}

	// Update reward status
	tx.Model(&reward).Update("status", models.RewardCredited)

	// Update referral code earnings
	var code models.ReferralCode
	if tx.Where("code = ?", reward.ReferralCode).First(&code).Error == nil {
		tx.Model(&code).Update("total_earnings", code.TotalEarnings+reward.RewardAmount)
	}

	tx.Commit()

	// Notify referrer
	ws.BroadcastToUser(reward.ReferrerID.String(), ws.MsgTypeNotification, gin.H{
		"type":    "referral_reward",
		"amount":  reward.RewardAmount,
		"message": "You earned GHS " + strings.TrimRight(strings.TrimRight(string(rune(reward.RewardAmount)), "0"), ".") + " from a referral!",
	})
}

func generateUniqueCode() string {
	bytes := make([]byte, 4)
	rand.Read(bytes)
	return strings.ToUpper(hex.EncodeToString(bytes))
}
