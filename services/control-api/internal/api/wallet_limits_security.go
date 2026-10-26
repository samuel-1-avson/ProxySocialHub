package api

import (
	"context"
	"fmt"
	"net/http"
	"time"

	solanaGo "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
)

// Spending-limit and withdrawal-security handlers, split mechanically
// out of wallet.go (P2 \u00a79; same package, no behaviour change).

// getWithdrawalSecurity returns withdrawal address and cooldown state (W-34: whitelist removed).
func getWithdrawalSecurity(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var walletRecord models.Wallet
	if err := db.DB.Where("user_id = ?", userUUID).First(&walletRecord).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}

	cooldownActive := false
	var cooldownUntil *time.Time
	if walletRecord.WithdrawalAddressChangedAt != nil &&
		time.Since(*walletRecord.WithdrawalAddressChangedAt) < 24*time.Hour {
		cooldownActive = true
		until := walletRecord.WithdrawalAddressChangedAt.Add(24 * time.Hour)
		cooldownUntil = &until
	}

	c.JSON(http.StatusOK, gin.H{
		"primary_withdrawal_address":    walletRecord.PrimaryWithdrawalAddress,
		"withdrawal_cooldown_active":    cooldownActive,
		"withdrawal_cooldown_until":     cooldownUntil,
		"withdrawal_address_changed_at": walletRecord.WithdrawalAddressChangedAt,
	})
}

type updateWithdrawalWhitelistRequest struct {
	Addresses []string `json:"addresses" binding:"required,max=20,dive,required"`
}

// updateWithdrawalWhitelist is gone (W-34): withdrawals are pinned to
// the proven linked wallet, which replaces the whitelist. The route
// stays one release returning 410 so old clients fail loudly instead
// of silently believing a whitelist is in force.
func updateWithdrawalWhitelist(c *gin.Context) {
	c.JSON(http.StatusGone, gin.H{
		"error": "Withdrawal whitelist has been removed. Withdrawals are pinned to your linked primary wallet.",
		"code":  "whitelist_removed",
	})
}

// getMySecurityFlags lists unresolved and recent account security flags for the current user.
func getMySecurityFlags(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var flags []models.UserFlag
	if err := db.DB.Where("user_id = ?", userUUID).Order("created_at DESC").Limit(50).Find(&flags).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load security flags"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"flags": flags, "count": len(flags)})
}

// sendSOLOnChainHook is overridden in tests to mock treasury payouts without a live oracle.
var sendSOLOnChainHook = sendSOLOnChain

// sendSOLOnChain builds and submits a SOL transfer instruction from the treasury to recipient.
func sendSOLOnChain(ctx context.Context, oracle *solana.OracleClient, recipientAddress string, amountSOL float64) (string, error) {
	recipient, err := solanaGo.PublicKeyFromBase58(recipientAddress)
	if err != nil {
		return "", fmt.Errorf("invalid recipient address: %w", err)
	}

	lamports := solana.SOLToLamports(amountSOL)
	return oracle.SendSOL(ctx, recipient, lamports)
}

// Spending Limit Handlers

type spendingLimitsResponse struct {
	Daily struct {
		Limit float64 `json:"limit"`
		Spent float64 `json:"spent"`
	} `json:"daily"`
	Weekly struct {
		Limit float64 `json:"limit"`
		Spent float64 `json:"spent"`
	} `json:"weekly"`
	Monthly struct {
		Limit float64 `json:"limit"`
		Spent float64 `json:"spent"`
	} `json:"monthly"`
}

// getSpendingLimits returns the user's current spending limits and usage
func getSpendingLimits(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", userUUID).First(&wallet).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}

	// Get current spending
	spending, err := wallet.GetSpendingForWindow(db.DB)
	if err != nil {
		logging.Error(err).Msg("Failed to get spending for window")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve spending data"})
		return
	}

	response := spendingLimitsResponse{}
	response.Daily.Limit = wallet.DailyLimit
	response.Daily.Spent = spending.DailySpent
	response.Weekly.Limit = wallet.WeeklyLimit
	response.Weekly.Spent = spending.WeeklySpent
	response.Monthly.Limit = wallet.MonthlyLimit
	response.Monthly.Spent = spending.MonthlySpent

	c.JSON(http.StatusOK, gin.H{
		"limits":       response,
		"window_start": wallet.LimitWindowStart,
	})
}

type updateLimitsRequest struct {
	Daily   *float64 `json:"daily,omitempty"`
	Weekly  *float64 `json:"weekly,omitempty"`
	Monthly *float64 `json:"monthly,omitempty"`
}

// updateSpendingLimits allows users to set their own spending limits
// Users can only set limits equal to or lower than system maximums
func updateSpendingLimits(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var req updateLimitsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user's trust tier for max limits
	var user models.User
	if err := db.DB.Select("trust_tier").Where("id = ?", userUUID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	maxLimits := models.GetDefaultLimits(user.TrustTier)

	// Validate and apply limits
	updates := map[string]interface{}{}

	if req.Daily != nil {
		if *req.Daily <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Daily limit must be greater than 0; omit the field to leave it unchanged"})
			return
		}
		if *req.Daily > maxLimits.Daily {
			c.JSON(http.StatusForbidden, gin.H{
				"error":       "Daily limit exceeds maximum allowed",
				"requested":   *req.Daily,
				"max_allowed": maxLimits.Daily,
			})
			return
		}
		updates["daily_limit"] = *req.Daily
	}

	if req.Weekly != nil {
		if *req.Weekly <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Weekly limit must be greater than 0; omit the field to leave it unchanged"})
			return
		}
		if *req.Weekly > maxLimits.Weekly {
			c.JSON(http.StatusForbidden, gin.H{
				"error":       "Weekly limit exceeds maximum allowed",
				"requested":   *req.Weekly,
				"max_allowed": maxLimits.Weekly,
			})
			return
		}
		updates["weekly_limit"] = *req.Weekly
	}

	if req.Monthly != nil {
		if *req.Monthly <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Monthly limit must be greater than 0; omit the field to leave it unchanged"})
			return
		}
		if *req.Monthly > maxLimits.Monthly {
			c.JSON(http.StatusForbidden, gin.H{
				"error":       "Monthly limit exceeds maximum allowed",
				"requested":   *req.Monthly,
				"max_allowed": maxLimits.Monthly,
			})
			return
		}
		updates["monthly_limit"] = *req.Monthly
	}

	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No limits provided"})
		return
	}

	if err := db.DB.Model(&models.Wallet{}).Where("user_id = ?", userUUID).Updates(updates).Error; err != nil {
		logging.Error(err).Msg("Failed to update spending limits")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update limits"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Spending limits updated",
		"limits":  updates,
	})
}

// resetSpendingLimits resets limits to default based on trust tier
func resetSpendingLimits(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var user models.User
	if err := db.DB.Select("trust_tier").Where("id = ?", userUUID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	defaults := models.GetDefaultLimits(user.TrustTier)

	updates := map[string]interface{}{
		"daily_limit":   defaults.Daily,
		"weekly_limit":  defaults.Weekly,
		"monthly_limit": defaults.Monthly,
	}

	if err := db.DB.Model(&models.Wallet{}).Where("user_id = ?", userUUID).Updates(updates).Error; err != nil {
		logging.Error(err).Msg("Failed to reset spending limits")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reset limits"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Spending limits reset to defaults",
		"limits":  defaults,
	})
}
