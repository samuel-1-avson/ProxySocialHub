package api

import (
	"context"
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
	"github.com/proxyhubb/control-api/internal/prices"
	"github.com/proxyhubb/control-api/internal/solana"
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
		logging.Error(err).
			Str("user_id", userID).
			Str("chain", req.Chain).
			Str("wallet_address", req.WalletAddress).
			Msg("Failed to save user with wallet link")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to link wallet: " + err.Error()})
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
		logging.Error(err).Msg("Failed to bind crypto deposit request JSON")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetString("userID")
	logging.Info().
		Str("user_id", userID).
		Str("tx_hash", req.TxHash).
		Float64("amount", req.Amount).
		Str("chain", req.Chain).
		Msg("Processing crypto deposit request")

	ctx := context.Background()

	// 1. Verify Transaction On-Chain (REAL VERIFICATION)
	var verifiedAmount float64

	if req.Chain == "solana" {
		// Get treasury address
		treasuryAddress := solana.GetTreasuryAddress()
		if treasuryAddress == "" {
			logging.Error(nil).Msg("SOLANA_TREASURY_ADDRESS not configured")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Treasury not configured"})
			return
		}

		// Verify transaction on Solana RPC
		txResult, err := solana.VerifyTransaction(ctx, req.TxHash)
		if err != nil {
			logging.Error(err).Str("tx_hash", req.TxHash).Msg("Solana transaction verification failed")
			c.JSON(http.StatusBadRequest, gin.H{"error": "Transaction verification failed: " + err.Error()})
			return
		}

		// Verify amount was sent to treasury
		valid, receivedSOL, err := solana.VerifyTransferAmount(txResult, treasuryAddress, 0)
		if err != nil || !valid {
			logging.Warn().Str("tx_hash", req.TxHash).Msg("Transaction did not credit treasury")
			c.JSON(http.StatusBadRequest, gin.H{"error": "Transaction does not credit platform treasury"})
			return
		}

		verifiedAmount = receivedSOL
		logging.Info().
			Str("tx_hash", req.TxHash).
			Float64("amount_sol", verifiedAmount).
			Msg("Solana deposit verified on-chain")

	} else if req.Chain == "bittensor" {
		// TODO: Implement real Bittensor verification via bridge
		// For now, trust the amount but log it
		verifiedAmount = req.Amount
		logging.Warn().
			Str("tx_hash", req.TxHash).
			Float64("amount_tao", verifiedAmount).
			Msg("Bittensor deposit - verification pending bridge integration")
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported chain"})
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
	if err := tx.Where("reference = ?", req.TxHash).First(&existingTx).Error; err == nil {
		tx.Rollback()
		c.JSON(http.StatusConflict, gin.H{"error": "Transaction already processed"})
		return
	}

	// 3. Credit Internal Wallet
	var wallet models.Wallet
	if err := tx.Where("user_id = ?", userID).First(&wallet).Error; err != nil {
		if err.Error() == "record not found" {
			wallet = models.Wallet{
				UserID:     uuid.MustParse(userID),
				BalanceTAO: 0,
				BalanceGHS: 0,
				Currency:   "MULTI",
			}
			if err := tx.Create(&wallet).Error; err != nil {
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

	// Calculate Credit Amount using REAL exchange rates
	creditAmountTAO := 0.0
	description := ""

	if req.Chain == "bittensor" {
		creditAmountTAO = verifiedAmount
		description = fmt.Sprintf("TAO Deposit: %.4f TAO", verifiedAmount)
	} else if req.Chain == "solana" {
		// Get real exchange rate from CoinGecko
		rate, err := prices.GetSOLToTAORate(ctx)
		if err != nil {
			logging.Warn().Err(err).Msg("Failed to fetch exchange rate, using fallback")
			// Fallback: fetch individual prices and calculate
			solPrice, _ := prices.GetSOLPrice(ctx)
			taoPrice, _ := prices.GetTAOPrice(ctx)
			if taoPrice > 0 {
				rate = solPrice / taoPrice
			} else {
				rate = 1.0 // Last resort fallback
			}
		}
		creditAmountTAO = verifiedAmount * rate
		description = fmt.Sprintf("SOL Deposit: %.6f SOL -> %.4f TAO (rate: %.4f)", verifiedAmount, creditAmountTAO, rate)
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
		// Log the actual error to diagnose unique constraint issues
		logging.Error(err).
			Str("tx_hash", req.TxHash).
			Str("user_id", userID).
			Str("chain", req.Chain).
			Msg("Failed to create pending transaction - possible duplicate or constraint violation")
		// If uniqueness constraint fails here, it catches the race condition too
		c.JSON(http.StatusConflict, gin.H{"error": "Transaction already processed: " + err.Error()})
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
