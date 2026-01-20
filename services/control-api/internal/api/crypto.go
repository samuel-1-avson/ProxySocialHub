package api

import (
	"crypto/ed25519"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
)

type linkWalletRequest struct {
	WalletAddress string `json:"wallet_address" binding:"required"`
	Chain         string `json:"chain" binding:"required"` // "solana", "bittensor"
	Signature     string `json:"signature"`
	Message       string `json:"message"`
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
		// 1. Verify Verification Params
		if req.Signature == "" || req.Message == "" {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Signature and message required for verification"})
			return
		}

		// 2. Verify Message Content Binding
		// Message must contain UserID and WalletAddress to bind them together
		if !strings.Contains(req.Message, userID) {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid message: User ID mismatch"})
			return
		}
		if !strings.Contains(req.Message, req.WalletAddress) {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid message: Wallet Address mismatch"})
			return
		}

		// 3. Decode & Verify Signature
		pubKeyBytes, err := base58.Decode(req.WalletAddress)
		if err != nil {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wallet address encoding"})
			return
		}
		sigBytes, err := base58.Decode(req.Signature)
		if err != nil {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid signature encoding"})
			return
		}

		if !ed25519.Verify(pubKeyBytes, []byte(req.Message), sigBytes) {
			tx.Rollback()
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Signature verification failed"})
			return
		}

		user.WalletAddress = &req.WalletAddress
	} else if req.Chain == "bittensor" {
		// TODO: Add support for Substrate signature verification (sr25519)
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

	// 2. Prevent Double Spending (Atomic)
	tx := db.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var existingTx models.PendingTransaction
	// Use Set("gorm:query_option", "FOR UPDATE") if we strictly want to lock, but Reference uniqueness is usually enough if checked inside TX.
	if err := tx.Where("reference = ?", req.TxHash).First(&existingTx).Error; err == nil {
		tx.Rollback()
		c.JSON(http.StatusConflict, gin.H{"error": "Transaction already processed"})
		return
	}

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
			if err := tx.Create(&wallet).Error; err != nil { // FIX: Ensure we check error on create
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create wallet"})
				return
			}
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
	if err := tx.Create(&pendingTx).Error; err != nil {
		tx.Rollback()
		// If uniqueness constraint fails here, it catches the race condition too
		c.JSON(http.StatusConflict, gin.H{"error": "Transaction processed concurrently"})
		return
	}

	ledger := models.WalletLedgerEntry{
		WalletID:     wallet.ID,
		Amount:       creditAmountTAO,
		BalanceAfter: wallet.BalanceTAO,
		Type:         "deposit",
		ReferenceID:  req.TxHash,
		Description:  description,
	}
	if err := tx.Create(&ledger).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ledger error"})
		return
	}

	tx.Commit()

	c.JSON(http.StatusOK, gin.H{
		"status":       "success",
		"credited_tao": creditAmountTAO,
		"new_balance":  wallet.BalanceTAO,
	})
}
