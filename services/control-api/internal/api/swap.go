package api

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

type swapRequest struct {
	FromCurrency string  `json:"from" binding:"required"`
	ToCurrency   string  `json:"to" binding:"required"`
	Amount       float64 `json:"amount" binding:"required,gt=0"`
}

func swapCurrency(c *gin.Context) {
	var req swapRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	userID := userUUID.String()

	// Only support GHS -> TAO and TAO -> GHS for now
	if !((req.FromCurrency == "GHS" && req.ToCurrency == "TAO") || (req.FromCurrency == "TAO" && req.ToCurrency == "GHS")) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported currency pair"})
		return
	}

	tx := db.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var wallet models.Wallet
	if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("user_id = ?", userID).First(&wallet).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Wallet not found"})
		return
	}

	var convertedAmount float64
	var rate float64
	// Convert using Real-Time Rate
	currentRate := GetTaoToGhsRate()

	if req.FromCurrency == "GHS" {
		// GHS -> TAO
		if wallet.BalanceGHS < req.Amount {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient GHS balance"})
			return
		}
		rate = 1.0 / currentRate
		convertedAmount = req.Amount / currentRate

		wallet.BalanceGHS -= req.Amount
		wallet.BalanceTAO += convertedAmount

	} else {
		// TAO -> GHS
		if wallet.BalanceTAO < req.Amount {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient TAO balance"})
			return
		}
		rate = currentRate
		convertedAmount = req.Amount * currentRate

		wallet.BalanceTAO -= req.Amount
		wallet.BalanceGHS += convertedAmount
	}

	if err := tx.Save(&wallet).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update balance"})
		return
	}

	// Ledger Entry
	ledger := models.WalletLedgerEntry{
		WalletID:     wallet.ID,
		Amount:       0, // Metadata swap
		BalanceAfter: wallet.BalanceTAO,
		Type:         "swap",
		Description:  fmt.Sprintf("Swap %.2f %s -> %.4f %s (Rate: %.2f)", req.Amount, req.FromCurrency, convertedAmount, req.ToCurrency, rate),
		ReferenceID:  uuid.New().String(),
	}
	tx.Create(&ledger)

	tx.Commit()

	c.JSON(http.StatusOK, gin.H{
		"status":      "success",
		"message":     "Swap successful",
		"from_amount": req.Amount,
		"to_amount":   convertedAmount,
		"new_balances": gin.H{
			"ghs": wallet.BalanceGHS,
			"tao": wallet.BalanceTAO,
		},
	})
}
