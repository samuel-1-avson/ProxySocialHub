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

// GetSolToUsdtRate returns the current exchange rate (Mock or Real)
func GetSolToUsdtRate() float64 {
	// TODO: Fetch from Oracle/Coingecko
	return 145.50 // 1 SOL = ~145 USDT (Mock)
}

func RegisterSwapRoutes(r *gin.RouterGroup) {
	r.POST("/wallet/swap", swapCurrency)
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

	// Only support SOL <-> USDT
	validPair := (req.FromCurrency == "SOL" && req.ToCurrency == "USDT") ||
		(req.FromCurrency == "USDT" && req.ToCurrency == "SOL")

	if !validPair {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported currency pair. Only SOL <-> USDT supported."})
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
	currentRate := GetSolToUsdtRate()

	if req.FromCurrency == "SOL" {
		// SOL -> USDT
		if wallet.BalanceSOL < req.Amount {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient SOL balance"})
			return
		}
		rate = currentRate
		convertedAmount = req.Amount * rate

		wallet.BalanceSOL -= req.Amount
		wallet.BalanceUSDT += convertedAmount

	} else {
		// USDT -> SOL
		if wallet.BalanceUSDT < req.Amount {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient USDT balance"})
			return
		}
		rate = 1.0 / currentRate
		convertedAmount = req.Amount * rate

		wallet.BalanceUSDT -= req.Amount
		wallet.BalanceSOL += convertedAmount
	}

	if err := tx.Save(&wallet).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update balance"})
		return
	}

	// Ledger Entry
	ledger := models.WalletLedgerEntry{
		WalletID:     wallet.ID,
		Amount:       0,                 // Metadata swap
		BalanceAfter: wallet.BalanceSOL, // Tracking SOL balance for primary reference? Or maybe split?
		Type:         "swap",
		Description:  fmt.Sprintf("Swap %.4f %s -> %.4f %s (Rate: %.2f)", req.Amount, req.FromCurrency, convertedAmount, req.ToCurrency, rate),
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
			"sol":  wallet.BalanceSOL,
			"usdt": wallet.BalanceUSDT,
		},
	})
}
