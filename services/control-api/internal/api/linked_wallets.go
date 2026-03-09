// Package api provides linked wallet management endpoints
package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// @Summary List linked wallets
// @Description Get all wallets linked to the current user
// @Tags wallets
// @Produce json
// @Success 200 {array} models.LinkedWallet
// @Router /v1/linked-wallets [get]
func ListLinkedWallets(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var wallets []models.LinkedWallet
	if err := db.DB.Where("user_id = ?", userID).Order("is_primary DESC, created_at ASC").Find(&wallets).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch wallets"})
		return
	}

	c.JSON(http.StatusOK, wallets)
}

// LinkWalletRequest represents a request to link a new wallet
type LinkWalletRequest struct {
	Chain     models.BlockchainType `json:"chain" binding:"required"`
	Address   string                `json:"address" binding:"required"`
	Signature string                `json:"signature" binding:"required"` // Signature proving ownership
	Message   string                `json:"message" binding:"required"`   // Message that was signed
	Label     string                `json:"label"`
}

// @Summary Link a new wallet
// @Description Link a blockchain wallet to the current user account
// @Tags wallets
// @Accept json
// @Produce json
// @Param request body LinkWalletRequest true "Wallet details"
// @Success 201 {object} models.LinkedWallet
// @Router /v1/linked-wallets [post]
func LinkWallet(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req LinkWalletRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate chain type
	if req.Chain != models.ChainSolana && req.Chain != models.ChainEthereum {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid chain type"})
		return
	}

	// Verify signature based on chain
	verified := false
	switch req.Chain {
	case models.ChainSolana:
		verified = verifySolanaSignature(req.Address, req.Message, req.Signature)
	case models.ChainEthereum:
		verified = verifyEthereumSignature(req.Address, req.Message, req.Signature)
	}

	if !verified {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid signature - wallet ownership not verified"})
		return
	}

	// Check if wallet already linked to another user
	var existing models.LinkedWallet
	if err := db.DB.Where("chain = ? AND address = ?", req.Chain, req.Address).First(&existing).Error; err == nil {
		if existing.UserID != userID.(uuid.UUID) {
			c.JSON(http.StatusConflict, gin.H{"error": "Wallet already linked to another account"})
			return
		}
		// Already linked to this user
		c.JSON(http.StatusOK, existing)
		return
	}

	// Check if this is the first wallet (make it primary)
	var count int64
	db.DB.Model(&models.LinkedWallet{}).Where("user_id = ?", userID).Count(&count)
	isPrimary := count == 0

	wallet := models.LinkedWallet{
		UserID:                userID.(uuid.UUID),
		Chain:                 req.Chain,
		Address:               req.Address,
		Verified:              true,
		VerificationSignature: &req.Signature,
		VerificationMessage:   &req.Message,
		IsPrimary:             isPrimary,
		Label:                 &req.Label,
	}

	if err := db.DB.Create(&wallet).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to link wallet"})
		return
	}

	// Also update legacy wallet fields in user profile for backwards compatibility
	if isPrimary {
		db.DB.Model(&models.User{}).Where("id = ?", userID).Update("wallet_address", req.Address)
	}

	c.JSON(http.StatusCreated, wallet)
}

// @Summary Set primary wallet
// @Description Set a linked wallet as the primary wallet for a chain
// @Tags wallets
// @Param id path string true "Wallet ID"
// @Success 200 {object} models.LinkedWallet
// @Router /v1/linked-wallets/{id}/primary [put]
func SetPrimaryWallet(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	walletID := c.Param("id")

	// Find the wallet
	var wallet models.LinkedWallet
	if err := db.DB.Where("id = ? AND user_id = ?", walletID, userID).First(&wallet).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}

	// Unset other primaries for this chain
	db.DB.Model(&models.LinkedWallet{}).
		Where("user_id = ? AND chain = ? AND id != ?", userID, wallet.Chain, wallet.ID).
		Update("is_primary", false)

	// Set this as primary
	wallet.IsPrimary = true
	db.DB.Save(&wallet)

	// Update legacy field
	db.DB.Model(&models.User{}).Where("id = ?", userID).Update("wallet_address", wallet.Address)

	c.JSON(http.StatusOK, wallet)
}

// @Summary Unlink wallet
// @Description Remove a linked wallet from the current user
// @Tags wallets
// @Param id path string true "Wallet ID"
// @Success 204 "No Content"
// @Router /v1/linked-wallets/{id} [delete]
func UnlinkWallet(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	walletID := c.Param("id")

	var wallet models.LinkedWallet
	if err := db.DB.Where("id = ? AND user_id = ?", walletID, userID).First(&wallet).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}

	if err := db.DB.Delete(&wallet).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to unlink wallet"})
		return
	}

	// If this was primary, clear legacy field
	if wallet.IsPrimary {
		db.DB.Model(&models.User{}).Where("id = ?", userID).Update("wallet_address", nil)
	}

	c.Status(http.StatusNoContent)
}

// Signature verification helpers (to be implemented with chain-specific libraries)

func verifySolanaSignature(address, message, signature string) bool {
	// TODO: Implement Ed25519 signature verification for Solana
	// For now, accept all signatures in development
	return len(signature) > 0
}

func verifyEthereumSignature(address, message, signature string) bool {
	// TODO: Implement ECDSA signature verification for Ethereum
	// Use go-ethereum crypto package
	return len(signature) > 0
}

// RegisterLinkedWalletRoutes registers linked wallet API routes
func RegisterLinkedWalletRoutes(r *gin.RouterGroup) {
	wallets := r.Group("/linked-wallets")
	{
		wallets.GET("", ListLinkedWallets)
		wallets.POST("", LinkWallet)
		wallets.PUT("/:id/primary", SetPrimaryWallet)
		wallets.DELETE("/:id", UnlinkWallet)
	}
}
