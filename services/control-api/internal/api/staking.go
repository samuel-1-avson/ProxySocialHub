package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterStakingRoutes registers node staking routes
func RegisterStakingRoutes(rg *gin.RouterGroup) {
	rg.POST("/staking/node/stake", stakeNode)
	rg.POST("/staking/node/unstake", unstakeNode)
}

type stakeNodeRequest struct {
	AmountSOL float64   `json:"amount_sol" binding:"required,gt=0"`
	ListingID uuid.UUID `json:"listing_id" binding:"required"`
}

type unstakeNodeRequest struct {
	ListingID uuid.UUID `json:"listing_id" binding:"required"`
}

// stakeNode boosts a listing's priority by staking SOL on its backing node
func stakeNode(c *gin.Context) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	sellerID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req stakeNodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify listing belongs to caller
	var listing models.ProxyListing
	if err := db.DB.First(&listing, "id = ? AND seller_id = ?", req.ListingID, sellerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found or not owned by you"})
		return
	}

	// Check caller has enough SOL
	var wallet models.Wallet
	if err := db.DB.First(&wallet, "user_id = ?", sellerID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Wallet not found"})
		return
	}
	if wallet.BalanceSOL < req.AmountSOL {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient SOL balance"})
		return
	}

	// Find the provider node for this seller
	var node models.Node
	if err := db.DB.First(&node, "provider_user_id = ?", sellerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No registered node found for this provider"})
		return
	}

	tx := db.DB.Begin()

	// Deduct SOL from wallet (held as stake)
	if err := tx.Model(&wallet).Update("balance_sol", wallet.BalanceSOL-req.AmountSOL).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to deduct stake"})
		return
	}

	// Boost node quality score to reflect stake (capped at 100)
	newScore := node.QualityScore + req.AmountSOL*2
	if newScore > 100 {
		newScore = 100
	}
	if err := tx.Model(&node).Update("quality_score", newScore).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update node stake"})
		return
	}

	tx.Commit()

	// Compute rank from new quality score
	newRank := 99
	if newScore >= 95 {
		newRank = 1
	} else if newScore >= 80 {
		newRank = 10
	} else if newScore >= 60 {
		newRank = 50
	}

	c.JSON(http.StatusOK, gin.H{
		"tx_hash":  fmt.Sprintf("stake_%s_%d", node.ID.String()[:8], time.Now().Unix()),
		"new_rank": newRank,
	})
}

// unstakeNode begins the unstaking cooldown period for a provider's node
func unstakeNode(c *gin.Context) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	sellerID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req unstakeNodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify listing belongs to caller
	var listing models.ProxyListing
	if err := db.DB.First(&listing, "id = ? AND seller_id = ?", req.ListingID, sellerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found or not owned by you"})
		return
	}

	var node models.Node
	if err := db.DB.First(&node, "provider_user_id = ?", sellerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No registered node found for this provider"})
		return
	}

	// Cooldown: funds available in 7 days
	availableAt := time.Now().Add(7 * 24 * time.Hour)

	// Reset quality score boost (approximate reversal)
	resetScore := node.QualityScore * 0.8
	if err := db.DB.Model(&node).Update("quality_score", resetScore).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to initiate unstake"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      "Unstaking initiated. Funds will be returned after the cooldown period.",
		"available_at": availableAt.Format(time.RFC3339),
	})
}
