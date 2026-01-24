package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm/clause"
)

type stakeRequest struct {
	Amount float64 `json:"amount" binding:"required,gt=0"`
}

// RegisterStakingRoutes registers the staking routes
func RegisterStakingRoutes(r *gin.RouterGroup) {
	group := r.Group("/staking")
	{
		group.GET("/", getStakingPositions)
		group.POST("/stake", createStake)
		group.POST("/unstake/:id", unstakePosition)
	}
}

// stakeFunds moves funds from Wallet Balance -> StakingPosition
func createStake(c *gin.Context) {
	var req stakeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userUUID, _ := GetUserID(c)
	userID := userUUID.String()

	tx := db.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Lock Wallet
	var wallet models.Wallet
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).First(&wallet).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}

	// Check Balance (Only Allow TAO staking for now as per requirement)
	if wallet.BalanceTAO < req.Amount {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient TAO balance"})
		return
	}

	// Deduct
	wallet.BalanceTAO -= req.Amount
	if err := tx.Save(&wallet).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update wallet"})
		return
	}

	// Create Stake
	stake := models.StakingPosition{
		UserID:    wallet.UserID,
		WalletID:  wallet.ID,
		Amount:    req.Amount,
		Currency:  "TAO",
		APY:       15.0, // Hardcoded 15% for Phase 1
		StartTime: time.Now(),
		Status:    models.StakingActive,
	}

	if err := tx.Create(&stake).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create stake position"})
		return
	}

	// Ledger Entry
	ledger := models.WalletLedgerEntry{
		WalletID:     wallet.ID,
		Amount:       -req.Amount,
		BalanceAfter: wallet.BalanceTAO,
		Type:         "stake_lock",
		Description:  fmt.Sprintf("Staked %.4f TAO @ 15%% APY", req.Amount),
		ReferenceID:  stake.ID.String(),
	}
	tx.Create(&ledger)

	tx.Commit()

	c.JSON(http.StatusCreated, gin.H{
		"message": "Staking successful",
		"stake":   stake,
	})
}

// unstakePosition calculates yield and returns funds
func unstakePosition(c *gin.Context) {
	stakeID := c.Param("id")
	userUUID, _ := GetUserID(c)

	tx := db.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var stake models.StakingPosition
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND user_id = ?", stakeID, userUUID).
		First(&stake).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusNotFound, gin.H{"error": "Stake position not found"})
		return
	}

	if stake.Status != models.StakingActive {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Stake is not active"})
		return
	}

	// Calculate Yield
	// Formula: Amount * (APY/100) * (DurationYears)
	duration := time.Since(stake.StartTime)
	years := duration.Hours() / (24 * 365)
	yield := stake.Amount * (stake.APY / 100.0) * years

	// Update Stake
	now := time.Now()
	stake.Status = models.StakingUnstaked
	stake.EndTime = &now
	stake.AccruedYield = yield

	if err := tx.Save(&stake).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update stake"})
		return
	}

	// Credit Wallet (Principal + Yield)
	var wallet models.Wallet
	if err := tx.Where("id = ?", stake.WalletID).First(&wallet).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Wallet not found"})
		return
	}

	totalReturn := stake.Amount + yield
	wallet.BalanceTAO += totalReturn
	if err := tx.Save(&wallet).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to credit wallet"})
		return
	}

	// Ledger Entry
	ledger := models.WalletLedgerEntry{
		WalletID:     wallet.ID,
		Amount:       totalReturn,
		BalanceAfter: wallet.BalanceTAO,
		Type:         "stake_unlock",
		Description:  fmt.Sprintf("Unstaked %.4f + %.6f Yield", stake.Amount, yield),
		ReferenceID:  stake.ID.String(),
	}
	tx.Create(&ledger)

	tx.Commit()

	c.JSON(http.StatusOK, gin.H{
		"message": "Unstaked successfully",
		"yield":   yield,
		"total":   totalReturn,
	})
}

func getStakingPositions(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok || userUUID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var stakes []models.StakingPosition
	if err := db.DB.Where("user_id = ?", userUUID).Order("created_at DESC").Find(&stakes).Error; err != nil {
		fmt.Printf("Error fetching stakes for user %s: %v\n", userUUID, err) // Log error
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch stakes"})
		return
	}

	// Calculate live yield for active stakes for display
	type StakeDisplay struct {
		models.StakingPosition
		CurrentYield float64 `json:"current_yield"`
	}

	var display []StakeDisplay
	for _, s := range stakes {
		yield := s.AccruedYield
		if s.Status == models.StakingActive {
			duration := time.Since(s.StartTime)
			years := duration.Hours() / (24 * 365)
			yield = s.Amount * (s.APY / 100.0) * years
		}

		display = append(display, StakeDisplay{
			StakingPosition: s,
			CurrentYield:    yield,
		})
	}

	c.JSON(http.StatusOK, display)
}
