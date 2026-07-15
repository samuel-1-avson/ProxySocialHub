package api

import (
	"context"
	"crypto/ed25519"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	solanaGo "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/treasury"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// LinkWalletRequest represents a request to link a wallet
type linkWalletRequest struct {
	WalletAddress string `json:"wallet_address"`
	Chain         string `json:"chain" binding:"required"` // "solana"
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
			recoverHandlerPanic(c, "linkWallet", userID, r)
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
		switch req.Chain {
		case "solana", "ethereum":
			if err := clearLinkedWalletIdentity(tx, user.ID, req.Chain); err != nil {
				tx.Rollback()
				logging.Error(err).Str("user_id", userID).Str("chain", req.Chain).Msg("Failed to unlink wallet")
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to unlink wallet"})
				return
			}
		default:
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported chain"})
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

		// Setup/update primary withdrawal address and cooldown in user's Wallet
		var wallet models.Wallet
		if err := tx.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				now := time.Now()
				wallet = models.Wallet{
					UserID:                     user.ID,
					PrimaryWithdrawalAddress:   &req.WalletAddress,
					WithdrawalAddressChangedAt: &now,
				}
				wallet.InitializeWithDefaultLimits(user.TrustTier)
				if err := tx.Create(&wallet).Error; err != nil {
					tx.Rollback()
					c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create wallet for user"})
					return
				}
			} else {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error checking wallet"})
				return
			}
		} else {
			if wallet.PrimaryWithdrawalAddress == nil || *wallet.PrimaryWithdrawalAddress == "" {
				// First linked wallet = automatic primary withdrawal address
				wallet.PrimaryWithdrawalAddress = &req.WalletAddress
				now := time.Now()
				wallet.WithdrawalAddressChangedAt = &now
				if len(wallet.WithdrawalWhitelist) == 0 {
					wallet.WithdrawalWhitelist = []string{req.WalletAddress}
				}
				if err := tx.Save(&wallet).Error; err != nil {
					tx.Rollback()
					c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update wallet primary address"})
					return
				}
			} else if *wallet.PrimaryWithdrawalAddress != req.WalletAddress {
				// Changing primary withdrawal address sets changed_at = NOW()
				wallet.PrimaryWithdrawalAddress = &req.WalletAddress
				now := time.Now()
				wallet.WithdrawalAddressChangedAt = &now
				if len(wallet.WithdrawalWhitelist) > 0 {
					found := false
					for _, a := range wallet.WithdrawalWhitelist {
						if a == req.WalletAddress {
							found = true
							break
						}
					}
					if !found {
						wallet.WithdrawalWhitelist = append(wallet.WithdrawalWhitelist, req.WalletAddress)
					}
				}
				if err := tx.Save(&wallet).Error; err != nil {
					tx.Rollback()
					c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update wallet primary address"})
					return
				}
			}
		}

		logging.Info().
			Str("user_id", userID).
			Str("wallet", req.WalletAddress).
			Msg("Solana wallet linked with Ed25519 verification")

	} else if req.Chain == "ethereum" {
		// Ethereum linking with ECDSA verification
		if req.Signature == "" || req.Message == "" {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Signature and message required for verification"})
			return
		}

		// Verify message contains binding
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

		// Verify Ethereum signature using the linked_wallets implementation
		verified, err := verifyEthereumSignature(req.WalletAddress, req.Message, req.Signature)
		if err != nil || !verified {
			tx.Rollback()
			logging.Error(err).
				Str("address", req.WalletAddress).
				Msg("Ethereum signature verification failed")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Ethereum signature verification failed"})
			return
		}

		user.WalletAddress = &req.WalletAddress

		logging.Info().
			Str("user_id", userID).
			Str("wallet", req.WalletAddress).
			Msg("Ethereum wallet linked with ECDSA verification")

	} else {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported chain"})
		return
	}

	if err := setProfileWalletAddress(tx, user.ID, user.WalletAddress); err != nil {
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

// setProfileWalletAddress updates only profiles.wallet_address (avoids Save() touching
// model fields that may not exist in older DB schemas, e.g. isp).
func setProfileWalletAddress(tx *gorm.DB, userID uuid.UUID, address *string) error {
	return tx.Model(&models.User{}).Where("id = ?", userID).Update("wallet_address", address).Error
}

// clearLinkedWalletIdentity removes the linked on-chain identity and withdrawal routing.
func clearLinkedWalletIdentity(tx *gorm.DB, userID uuid.UUID, chain string) error {
	if err := setProfileWalletAddress(tx, userID, nil); err != nil {
		return err
	}
	if err := clearWalletWithdrawalRouting(tx, userID); err != nil {
		return err
	}
	var chainType models.BlockchainType
	switch chain {
	case "solana":
		chainType = models.ChainSolana
	case "ethereum":
		chainType = models.ChainEthereum
	default:
		return fmt.Errorf("unsupported chain: %s", chain)
	}
	return deleteLinkedWalletRows(tx, userID, chainType)
}

func clearWalletWithdrawalRouting(tx *gorm.DB, userID uuid.UUID) error {
	if !tx.Migrator().HasTable(&models.Wallet{}) {
		return nil
	}
	updates := map[string]interface{}{}
	if tx.Migrator().HasColumn(&models.Wallet{}, "primary_withdrawal_address") {
		updates["primary_withdrawal_address"] = nil
	}
	if tx.Migrator().HasColumn(&models.Wallet{}, "withdrawal_whitelist") {
		updates["withdrawal_whitelist"] = []string{}
	}
	if len(updates) == 0 {
		return nil
	}
	return tx.Model(&models.Wallet{}).Where("user_id = ?", userID).Updates(updates).Error
}

func deleteLinkedWalletRows(tx *gorm.DB, userID uuid.UUID, chain models.BlockchainType) error {
	if !tx.Migrator().HasTable(&models.LinkedWallet{}) {
		return nil
	}
	return tx.Where("user_id = ? AND chain = ?", userID, chain).Delete(&models.LinkedWallet{}).Error
}

type cryptoDepositRequest struct {
	TxHash string  `json:"tx_hash" binding:"required"`
	Amount float64 `json:"amount" binding:"required,gt=0,lte=100000"`
	Chain  string  `json:"chain" binding:"required"` // "solana"
}

const (
	defaultMaxSingleDepositSOL = 10000.0
	defaultMaxDailyDepositSOL  = 50000.0
)

func getMaxSingleDepositSOL() float64 {
	if cm := GetConfigManager(); cm != nil {
		if raw, err := cm.Get("max_single_deposit_sol"); err == nil {
			if max, parseErr := strconv.ParseFloat(strings.TrimSpace(raw), 64); parseErr == nil && max > 0 {
				return max
			}
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MAX_SINGLE_DEPOSIT_SOL")); raw != "" {
		if max, err := strconv.ParseFloat(raw, 64); err == nil && max > 0 {
			return max
		}
	}
	return defaultMaxSingleDepositSOL
}

func getMaxDailyDepositSOL() float64 {
	if cm := GetConfigManager(); cm != nil {
		if raw, err := cm.Get("max_daily_deposit_sol"); err == nil {
			if max, parseErr := strconv.ParseFloat(strings.TrimSpace(raw), 64); parseErr == nil && max > 0 {
				return max
			}
		}
	}
	if raw := strings.TrimSpace(os.Getenv("MAX_DAILY_DEPOSIT_SOL")); raw != "" {
		if max, err := strconv.ParseFloat(raw, 64); err == nil && max > 0 {
			return max
		}
	}
	return defaultMaxDailyDepositSOL
}

func getWalletDepositsSince(tx *gorm.DB, walletID uuid.UUID, since time.Time) (float64, error) {
	var total float64
	err := tx.Model(&models.WalletLedgerEntry{}).
		Where("wallet_id = ? AND type = ? AND created_at >= ?", walletID, "deposit", since).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&total).Error
	return total, err
}

// verifyCryptoDeposit verifies an external crypto transfer and credits the internal wallet
func verifyCryptoDeposit(c *gin.Context) {
	var req cryptoDepositRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	maxDepositSOL := getMaxSingleDepositSOL()
	if req.Amount > maxDepositSOL {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Deposit exceeds maximum allowed amount", "max_sol": maxDepositSOL})
		return
	}

	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}
	userID := userUUID.String()
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

		// SECURITY: Verify transaction sender matches user's linked wallet
		sender, err := solana.GetTransactionSender(txResult)
		if err != nil {
			logging.Error(err).Str("tx_hash", req.TxHash).Msg("Failed to get transaction sender")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify transaction sender"})
			return
		}

		// Get user's linked wallet address
		var user models.User
		if err := db.DB.Where("id = ?", userID).First(&user).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "User lookup failed"})
			return
		}

		if user.WalletAddress == nil || *user.WalletAddress == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "No linked wallet found. Please link your wallet first"})
			return
		}

		if sender != *user.WalletAddress {
			logging.Warn().
				Str("tx_hash", req.TxHash).
				Str("expected_sender", *user.WalletAddress).
				Str("actual_sender", sender).
				Msg("Deposit sender mismatch - possible fraud attempt")
			c.JSON(http.StatusForbidden, gin.H{"error": "Transaction sender does not match your linked wallet"})
			return
		}

		verifiedAmount = receivedSOL
		logging.Info().
			Str("tx_hash", req.TxHash).
			Float64("amount_sol", verifiedAmount).
			Str("sender", sender).
			Msg("Solana deposit verified on-chain with sender ownership confirmed")

	} else if req.Chain == "ethereum" {
		// Ethereum deposit verification (for future use)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Ethereum deposits not yet implemented"})
		return
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported chain"})
		return
	}
	if verifiedAmount > maxDepositSOL {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Verified deposit exceeds maximum allowed amount", "max_sol": maxDepositSOL})
		return
	}

	// 2. Prevent Double Spending (Atomic)
	tx := db.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
			recoverHandlerPanic(c, "verifyCryptoDeposit", userID, r)
		}
	}()

	var existingTx models.PendingTransaction
	if err := tx.Where("reference = ?", req.TxHash).First(&existingTx).Error; err == nil {
		tx.Rollback()
		if existingTx.Status == "completed" {
			var wallet models.Wallet
			if db.DB.Where("user_id = ?", userID).First(&wallet).Error == nil {
				c.JSON(http.StatusOK, gin.H{
					"status":      "success",
					"message":     "Deposit already credited",
					"tx_hash":     req.TxHash,
					"solscan_url": SolscanTxURL(req.TxHash),
					"credited":    verifiedAmount,
					"currency":    "SOL",
					"new_balance": wallet.BalanceSOL,
				})
				return
			}
		}
		c.JSON(http.StatusConflict, gin.H{"error": "Transaction already processed"})
		return
	}

	// 3. Credit Internal Wallet
	var wallet models.Wallet
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).First(&wallet).Error; err != nil {
		if err.Error() == "record not found" {
			// Get user's trust tier for default limits
			var userTrustTier models.TrustTier = models.TrustTierNew
			db.DB.Model(&models.User{}).Select("trust_tier").Where("id = ?", userID).Scan(&userTrustTier)

			wallet = models.Wallet{
				UserID:     userUUID,
				BalanceSOL: 0,
			}
			wallet.InitializeWithDefaultLimits(userTrustTier)

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
		// Native SOL deposit only (platform is SOL-only)
		creditedAmount = verifiedAmount
		currency = "SOL"
	}

	maxDailyDepositSOL := getMaxDailyDepositSOL()
	depositedToday, err := getWalletDepositsSince(tx, wallet.ID, time.Now().UTC().Add(-24*time.Hour))
	if err != nil {
		tx.Rollback()
		logging.Error(err).Str("wallet_id", wallet.ID.String()).Str("user_id", userID).Msg("Failed to check daily deposit limit")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check deposit limit"})
		return
	}
	if depositedToday+creditedAmount > maxDailyDepositSOL {
		tx.Rollback()
		remainingSOL := maxDailyDepositSOL - depositedToday
		if remainingSOL < 0 {
			remainingSOL = 0
		}
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error":         "Daily deposit limit exceeded",
			"max_sol":       maxDailyDepositSOL,
			"used_sol":      depositedToday,
			"remaining_sol": remainingSOL,
		})
		return
	}

	wallet.BalanceSOL += creditedAmount

	if err := tx.Save(&wallet).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to credit wallet"})
		return
	}

	// 4. Log Transaction
	pendingTx := models.PendingTransaction{
		UserID:         userUUID,
		Reference:      req.TxHash,
		IdempotencyKey: req.TxHash,
		Type:           "crypto_deposit",
		Amount:         creditedAmount,
		Currency:       currency,
		Provider:       "blockchain",
		Status:         "completed",
		ExternalRef:    req.TxHash,
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
		TxHash:       req.TxHash,
		Description:  fmt.Sprintf("Crypto Deposit: %.6f %s", creditedAmount, currency),
	}
	if err := tx.Create(&ledger).Error; err != nil {
		tx.Rollback()
		logging.Error(err).Str("tx_hash", req.TxHash).Str("user_id", userID).Msg("Failed to create wallet ledger entry")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to record deposit in ledger"})
		return
	}

	tx.Commit()

	c.JSON(http.StatusOK, gin.H{
		"status":      "success",
		"tx_hash":     req.TxHash,
		"solscan_url": SolscanTxURL(req.TxHash),
		"credited":    creditedAmount,
		"currency":    currency,
		"new_balance": wallet.BalanceSOL,
	})
}

// BatchSettlementRequest represents a request to settle multiple escrows
type BatchSettlementRequest struct {
	Settlements []SettlementItem `json:"settlements" binding:"required,min=1,max=10"`
}

// SettlementItem represents a single settlement in a batch
type SettlementItem struct {
	EscrowPDA       string `json:"escrow_pda" binding:"required"`
	Buyer           string `json:"buyer" binding:"required"`
	Seller          string `json:"seller" binding:"required"`
	BandwidthUsedGB uint64 `json:"bandwidth_used_gb" binding:"required"`
}

// settleBatchEscrows settles multiple escrows in a single transaction
func settleBatchEscrows(c *gin.Context) {
	var req BatchSettlementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get multi-sig oracle
	multisig := solana.GetMultiSigOracle()
	if multisig == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Multi-sig oracle not initialized"})
		return
	}

	// Check if this node is an authorized signer
	if !multisig.IsAuthorizedSigner() {
		c.JSON(http.StatusForbidden, gin.H{"error": "This node is not an authorized oracle signer"})
		return
	}

	// Build settlement parameters
	params := make([]solana.SettleEscrowParams, len(req.Settlements))
	for i, item := range req.Settlements {
		escrowPDA, err := solanaGo.PublicKeyFromBase58(item.EscrowPDA)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid escrow PDA at index %d", i)})
			return
		}
		buyer, err := solanaGo.PublicKeyFromBase58(item.Buyer)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid buyer address at index %d", i)})
			return
		}
		seller, err := solanaGo.PublicKeyFromBase58(item.Seller)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid seller address at index %d", i)})
			return
		}

		params[i] = solana.SettleEscrowParams{
			EscrowPDA:       escrowPDA,
			Buyer:           buyer,
			Seller:          seller,
			BandwidthUsedGB: item.BandwidthUsedGB,
		}
	}

	// Execute batch settlement
	ctx := context.Background()
	txHash, err := multisig.BatchSettleEscrows(ctx, "api.crypto.batch_settle", params)
	if err != nil {
		logging.Error(err).Msg("Batch settlement failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Settlement failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":     "success",
		"tx_hash":    txHash,
		"count":      len(req.Settlements),
		"settled_at": time.Now().Unix(),
	})
}

// EmergencyPauseRequest triggers emergency pause on the Solana program
type EmergencyPauseRequest struct {
	Reason string `json:"reason" binding:"required"`
}

// emergencyPause triggers the emergency pause on the Solana program
func emergencyPause(c *gin.Context) {
	// Only admin can trigger emergency pause
	userRole, _ := c.Get("userRole")
	if userRole != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only admin can trigger emergency pause"})
		return
	}

	var req EmergencyPauseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Attempt to trigger emergency pause via Solana program
	oracle := solana.GetOracleClient()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Oracle not initialized"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	// Call the watchtower to trigger emergency pause
	wt := treasury.NewWatchtower()
	if err := wt.TriggerEmergencyPause(ctx, req.Reason); err != nil {
		logging.Error(err).
			Str("reason", req.Reason).
			Str("triggered_by", c.GetString("user_id")).
			Msg("Failed to trigger emergency pause")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to trigger emergency pause: " + err.Error()})
		return
	}

	logging.Error(nil).
		Str("reason", req.Reason).
		Str("triggered_by", c.GetString("user_id")).
		Msg("EMERGENCY PAUSE TRIGGERED")

	c.JSON(http.StatusOK, gin.H{
		"status":  "paused",
		"reason":  req.Reason,
		"message": "Emergency pause activated - all operations halted",
	})
}

// getTreasuryAddress returns the configured treasury address
func getTreasuryAddress(c *gin.Context) {
	address := solana.GetTreasuryAddress()
	if address == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Treasury not configured"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"treasury_address": address,
		"chain":            "solana",
		"network":          "devnet",
	})
}

// getMultiSigStatus returns the current multi-sig oracle status
func getMultiSigStatus(c *gin.Context) {
	multisig := solana.GetMultiSigOracle()
	if multisig == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Multi-sig oracle not initialized"})
		return
	}

	// Reload config from chain
	ctx := context.Background()
	if err := multisig.LoadMultiSigConfig(ctx); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Failed to load config: " + err.Error()})
		return
	}

	signers := multisig.GetSigners()
	signerStrs := make([]string, len(signers))
	for i, s := range signers {
		signerStrs[i] = s.String()
	}

	c.JSON(http.StatusOK, gin.H{
		"threshold":     multisig.GetThreshold(),
		"total_signers": len(signers),
		"signers":       signerStrs,
		"is_authority":  multisig.IsAuthorizedSigner(),
	})
}

// getSettlementTelemetry returns in-memory settlement path telemetry.
func getSettlementTelemetry(c *gin.Context) {
	telemetry := solana.GetSettlementTelemetrySnapshot()
	c.JSON(http.StatusOK, gin.H{
		"settlement_paths": telemetry,
		"count":            len(telemetry),
		"captured_at":      time.Now().UTC().Format(time.RFC3339),
	})
}

// RegisterCryptoRoutes registers admin-only crypto operations.
// User deposits use POST /v1/wallet/deposit/crypto (RegisterWalletRoutes).
func RegisterCryptoRoutes(r *gin.RouterGroup) {
	crypto := r.Group("/crypto")
	crypto.Use(RequireRole("admin"))
	{
		crypto.POST("/batch-settle", settleBatchEscrows)
		crypto.POST("/emergency-pause", emergencyPause)
		crypto.GET("/treasury", getTreasuryAddress)
		crypto.GET("/multisig-status", getMultiSigStatus)
		crypto.GET("/settlement-telemetry", getSettlementTelemetry)
	}
}
