package api

import (
	"context"
	"crypto/ed25519"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/bittensor"
	"github.com/proxyhubb/control-api/internal/bridge"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
)

type linkWalletRequest struct {
	WalletAddress string `json:"wallet_address"`
	Chain         string `json:"chain" binding:"required"` // "solana", "bittensor"
	Signature     string `json:"signature"`
	Message       string `json:"message"`
}

// linkWallet links or unlinks an external wallet address to the user profile
func linkWallet(c *gin.Context) {
	var req linkWalletRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	userID := userUUID.String()

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

	// Handle Unlink (DELETE)
	if c.Request.Method == "DELETE" {
		if req.Chain == "solana" {
			user.WalletAddress = nil
		} else if req.Chain == "bittensor" {
			user.BittensorAddress = nil
		} else {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported chain"})
			return
		}

		if err := tx.Save(&user).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to unlink wallet"})
			return
		}
		tx.Commit()
		c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Wallet unlinked successfully"})
		return
	}

	// Handle Link (POST)
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
		if err != nil || len(pubKeyBytes) != 32 {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wallet address encoding or length"})
			return
		}
		sigBytes, err := base58.Decode(req.Signature)
		if err != nil || len(sigBytes) != 64 {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid signature encoding or length"})
			return
		}

		if !ed25519.Verify(pubKeyBytes, []byte(req.Message), sigBytes) {
			tx.Rollback()
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Signature verification failed"})
			return
		}

		user.WalletAddress = &req.WalletAddress
	} else if req.Chain == "bittensor" {
		// Verify signature using the Bittensor bridge
		client := GetBittensorClient()
		if client == nil {
			tx.Rollback()
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Bittensor bridge client not initialized"})
			return
		}

		isValid, err := client.VerifySignature(req.WalletAddress, req.Message, req.Signature)
		if err != nil {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Bittensor signature verification failed: " + err.Error()})
			return
		}

		if !isValid {
			tx.Rollback()
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid Bittensor signature"})
			return
		}

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
	TxHash             string  `json:"tx_hash" binding:"required"`
	Amount             float64 `json:"amount" binding:"required,gt=0"`
	Chain              string  `json:"chain" binding:"required"` // "solana", "bittensor"
	DestinationAddress string  `json:"destination_address"`      // Optional: For direct bridge
}

// verifyCryptoDeposit verifies an external crypto transfer and credits the internal wallet
func verifyCryptoDeposit(c *gin.Context) {
	var req cryptoDepositRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	userID := userUUID.String()
	ctx := context.Background()

	// --- DIRECT BRIDGE FLOW (Solana -> Bittensor) ---
	if req.Chain == "solana" && req.DestinationAddress != "" {
		logging.Info().Str("tx", req.TxHash).Str("dest", req.DestinationAddress).Msg("Initiating Direct Bridge")

		// Initialize Bridge Service (On-the-fly)
		cfg := solana.Config{
			RPCEndpoint:       os.Getenv("SOLANA_RPC_ENDPOINT"),
			OracleKeypairPath: os.Getenv("ORACLE_KEYPAIR_PATH"),
		}
		if cfg.RPCEndpoint == "" {
			cfg.RPCEndpoint = "https://api.devnet.solana.com"
		}

		oracleClient, err := solana.NewOracleClient(cfg)
		if err != nil {
			logging.Error(err).Msg("Failed to init oracle client for bridge")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Bridge service unavailable"})
			return
		}

		// Import cycle note: 'bridge' package imports 'solana', ensuring no cycle if 'api' imports 'bridge'.
		// We need to import "github.com/proxyhubb/control-api/internal/bridge"
		// If 'api' is not importing it yet, we need to add it.
		// Since I can't add imports easily with replace_file_content mid-file, I will assume I need to fix imports in a separate step or add it now if I can replace the header.
		// Detailed plan: I'll replace the whole file imports later. For now, I'll write the logic assuming 'bridge' is imported.

		// Actually, I'll use a helper to get the service if possible, or just instantiate here.
		// Since I can't easily edit imports in this specific tool call if I don't target the top...
		// I will split this into two calls. First add import, then add logic.
		// Or I will replace header AND this section.
		// Wait, replace_file_content can do imports if I include the top.

		// Let's assume I will fix imports after.
		bridgeService, err := bridge.NewService(oracleClient)
		if err != nil {
			logging.Error(err).Msg("Failed to create bridge service")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Bridge service init failed"})
			return
		}

		result, err := bridgeService.ProcessSolanaToBittensor(ctx, req.TxHash, req.DestinationAddress)
		if err != nil {
			logging.Error(err).Msg("Bridge transfer failed")
			// Detailed error
			c.JSON(http.StatusBadRequest, gin.H{"error": "Bridge failed: " + err.Error()})
			return
		}

		// Success -> Return immediately (funds bridged, no internal credit)
		c.JSON(http.StatusOK, gin.H{
			"status":        "success",
			"message":       "Funds bridged successfully",
			"source_amount": result.AmountSource,
			"dest_amount":   result.AmountDest,
			"dest_tx":       result.DestTx,
		})
		return
	}

	// 1. Verify Transaction On-Chain (REAL VERIFICATION)
	var verifiedAmount float64

	if req.Chain == "solana" && req.DestinationAddress == "" {
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
		logging.Info().
			Str("tx_hash", req.TxHash).
			Float64("amount", req.Amount).
			Str("chain", req.Chain).
			Msg("Processing Bittensor deposit request")

		// Get treasury address
		treasuryAddress := bittensor.GetTreasuryAddress()
		if treasuryAddress == "" {
			logging.Error(nil).Msg("TAO_TREASURY_ADDRESS not configured")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "TAO Treasury not configured"})
			return
		}
		logging.Info().Str("treasury", treasuryAddress).Msg("TAO treasury configured")

		// Try to verify extrinsic on Subscan
		transfer, err := bittensor.VerifyTransferToTreasury(ctx, req.TxHash, 0)
		if err != nil {
			// In testnet mode, fall back to trusting the amount if Subscan fails
			// This is because testnet may not have a reliable explorer API
			network := os.Getenv("BITTENSOR_NETWORK")
			if network == "testnet" {
				logging.Warn().
					Err(err).
					Str("tx_hash", req.TxHash).
					Float64("claimed_amount", req.Amount).
					Msg("Bittensor testnet verification failed - using trusted amount for development")
				verifiedAmount = req.Amount
			} else {
				logging.Error(err).Str("tx_hash", req.TxHash).Msg("Bittensor extrinsic verification failed")
				c.JSON(http.StatusBadRequest, gin.H{"error": "Extrinsic verification failed: " + err.Error()})
				return
			}
		} else {
			verifiedAmount = transfer.Amount
			logging.Info().
				Str("tx_hash", req.TxHash).
				Float64("amount_tao", verifiedAmount).
				Int64("block", transfer.BlockNumber).
				Msg("Bittensor deposit verified on-chain")
		}
	} else if req.DestinationAddress != "" {
		// Chain is not solana but dest address provided? unsupported for direct bridge now
		c.JSON(http.StatusBadRequest, gin.H{"error": "Direct bridge only supported for Solana -> Bittensor currently"})
		return
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
				UserID:      uuid.MustParse(userID),
				BalanceSOL:  0,
				BalanceUSDT: 0,
				BalanceGHS:  0,
				Currency:    "MULTI",
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

	// Logic for credits
	creditedAmount := 0.0
	currency := ""

	if req.Chain == "solana" {
		// Assuming native SOL deposit
		// TODO: Support SPL Tokens (USDT) check here later
		creditedAmount = verifiedAmount
		currency = "SOL"
		wallet.BalanceSOL += verifiedAmount
	}

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
		Currency:    currency,
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
		Amount:       creditedAmount,
		BalanceAfter: wallet.BalanceSOL,
		Type:         "deposit",
		ReferenceID:  req.TxHash,
		Description:  fmt.Sprintf("Crypto Deposit: %.6f %s", creditedAmount, currency),
	}
	if err := tx.Create(&ledger).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ledger error"})
		return
	}

	tx.Commit()

	c.JSON(http.StatusOK, gin.H{
		"status":      "success",
		"credited":    creditedAmount,
		"currency":    currency,
		"new_balance": wallet.BalanceSOL,
	})
}
