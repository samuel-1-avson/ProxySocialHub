package api

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

type linkWalletRequest struct {
	WalletAddress string `json:"wallet_address" binding:"required"`
	Chain         string `json:"chain" binding:"required"` // "solana", "bittensor"
}

// LinkWalletEndpoint links an external wallet address to the user profile
func linkWallet(c *gin.Context) {
	var req linkWalletRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetString("userID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	tx := db.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var user models.User
	if err := tx.Where("id = ?", userID).First(&user).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Update appropriate field based on chain
	if req.Chain == "solana" {
		// Store in WalletAddress for now, or add specific SolanaAddress field if needed.
		// Model has WalletAddress (ETH usually) and BittensorAddress.
		// Let's use WalletAddress for generic/Solana for now as per MVP.
		user.WalletAddress = &req.WalletAddress
	} else if req.Chain == "bittensor" {
		user.BittensorAddress = &req.WalletAddress
	} else {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported chain"})
		return
	}

	if err := tx.Save(&user).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to link wallet"})
		return
	}

	tx.Commit()
	c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Wallet linked successfully"})
}

type cryptoDepositRequest struct {
	TxHash string  `json:"tx_hash" binding:"required"`
	Amount float64 `json:"amount" binding:"required,gt=0"`
	Chain  string  `json:"chain" binding:"required"` // "solana", "bittensor"
}

// verifyCryptoDeposit verifies an external crypto transfer and credits the internal wallet
func verifyCryptoDeposit(c *gin.Context) {
	var req cryptoDepositRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetString("userID")

	// 1. Verify Transaction On-Chain
	// In a real production env, we would query the blockchain RPC here.
	// For MVP/Demo, we will simulate verification or trust the client IF NOT production.
	// TODO: Integrate actual Solana/Subtensor RPC client.

	logging.Info().Str("tx_hash", req.TxHash).Str("chain", req.Chain).Msg("Verifying Crypto Deposit (Simulated)")

	// Simulate Check (Always success for Demo unless hash is "fail")
	if req.TxHash == "fail" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Transaction verification failed (Simulated)"})
		return
	}

	// 2. Prevent Double Spending
	var existingTx models.PendingTransaction
	if err := db.DB.Where("reference = ?", req.TxHash).First(&existingTx).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Transaction already processed"})
		return
	}

	tx := db.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 3. Credit Internal Wallet
	var wallet models.Wallet
	if err := tx.Where("user_id = ?", userID).First(&wallet).Error; err != nil {
		// Auto-create if missing logic similar to wallet.go
		if err.Error() == "record not found" {
			wallet = models.Wallet{
				UserID:     uuid.MustParse(userID),
				BalanceTAO: 0,
				BalanceGHS: 0,
				Currency:   "MULTI",
			}
			tx.Create(&wallet)
		} else {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Wallet error"})
			return
		}
	}

	// Calculate Credit Amount
	// If depositing TAO: 1:1
	// If depositing SOL: Swap to TAO using Rate.

	creditAmountTAO := 0.0
	description := ""

	if req.Chain == "bittensor" {
		creditAmountTAO = req.Amount
		description = fmt.Sprintf("TAO Deposit: %.4f TAO", req.Amount)
	} else if req.Chain == "solana" {
		// Mock Rate: 1 SOL = 0.5 TAO (Example) or fetch real price
		// Let's assume user sends SOL and we convert to TAO systems credits.
		// For MVP, simplistic conversion:
		rateSolTao := 0.5 // Mock
		creditAmountTAO = req.Amount * rateSolTao
		description = fmt.Sprintf("SOL Deposit: %.4f SOL -> %.4f TAO", req.Amount, creditAmountTAO)
	}

	wallet.BalanceTAO += creditAmountTAO
	if err := tx.Save(&wallet).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to credit wallet"})
		return
	}

	// 4. Log Transaction
	pendingTx := models.PendingTransaction{
		UserID:      userID,
		Reference:   req.TxHash,
		Type:        "crypto_deposit",
		Amount:      req.Amount,
		Currency:    req.Chain,
		Provider:    "blockchain",
		Status:      "completed",
		ExternalRef: req.TxHash,
	}
	tx.Create(&pendingTx)

	ledger := models.WalletLedgerEntry{
		WalletID:     wallet.ID,
		Amount:       creditAmountTAO,
		BalanceAfter: wallet.BalanceTAO,
		Type:         "deposit",
		ReferenceID:  req.TxHash,
		Description:  description,
	}
	tx.Create(&ledger)

	tx.Commit()

	c.JSON(http.StatusOK, gin.H{
		"status":       "success",
		"credited_tao": creditAmountTAO,
		"new_balance":  wallet.BalanceTAO,
	})
}
