package api

import (
	"context"
	"errors"
	"crypto/ed25519"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	solanaGo "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/audit"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
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

// linkWallet links or unlinks an external wallet address to the user profile.
// P0-4: linking requires a fresh server-issued challenge (single-use, 5 min)
// obtained from POST /v1/wallet/link/challenge; the signed message must match
// it verbatim. All identity stores are updated through the unified helpers
// in wallet_identity.go.
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
		if err := tx.Commit().Error; err != nil {
			logging.Error(err).Str("user_id", userID).Msg("Failed to commit wallet unlink")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to unlink wallet"})
			return
		}
		audit.Log(c, models.AuditWalletUnlinked, "user", userID,
			"Unlinked wallet via /wallet/link", map[string]interface{}{"chain": req.Chain})
		c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Wallet unlinked successfully"})
		return
	}

	// Handle Link (POST)
	if req.Signature == "" || req.Message == "" {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Signature and message required for verification"})
		return
	}

	// Single-use, server-issued challenge binds user+chain+address+nonce.
	if !consumeLinkChallenge(c.Request.Context(), user.ID, req.Chain, req.WalletAddress, req.Message) {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Link challenge expired or invalid. Request a new challenge."})
		return
	}

	if req.Chain == "solana" {
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

		if err := applySolanaLinkIdentity(tx, user, req.WalletAddress, &req.Signature, &req.Message); err != nil {
			tx.Rollback()
			logging.Error(err).Str("user_id", userID).Str("wallet_address", req.WalletAddress).Msg("Failed to link Solana wallet")
			status := http.StatusInternalServerError
			msg := "Failed to link wallet"
			if errors.Is(err, ErrWalletLinkedElsewhere) {
				status = http.StatusConflict
				msg = err.Error()
			}
			c.JSON(status, gin.H{"error": msg})
			return
		}
		logging.Info().Str("user_id", userID).Str("wallet", req.WalletAddress).Msg("Solana wallet linked with challenge + Ed25519 verification")

	} else if req.Chain == "ethereum" {
		verified, err := verifyEthereumSignature(req.WalletAddress, req.Message, req.Signature)
		if err != nil || !verified {
			tx.Rollback()
			logging.Error(err).Str("address", req.WalletAddress).Msg("Ethereum signature verification failed")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Ethereum signature verification failed"})
			return
		}

		// W-05: Ethereum identity lives only in linked_wallets; it must
		// never overwrite profiles.wallet_address (the Solana identity).
		if err := applyEthereumLinkIdentity(tx, user.ID, req.WalletAddress, &req.Signature, &req.Message); err != nil {
			tx.Rollback()
			logging.Error(err).Str("user_id", userID).Str("wallet_address", req.WalletAddress).Msg("Failed to link Ethereum wallet")
			status := http.StatusInternalServerError
			msg := "Failed to link wallet"
			if errors.Is(err, ErrWalletLinkedElsewhere) {
				status = http.StatusConflict
				msg = err.Error()
			}
			c.JSON(status, gin.H{"error": msg})
			return
		}
		logging.Info().Str("user_id", userID).Str("wallet", req.WalletAddress).Msg("Ethereum wallet linked with challenge + ECDSA verification")

	} else {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported chain"})
		return
	}

	if err := tx.Commit().Error; err != nil {
		logging.Error(err).Str("user_id", userID).Msg("Failed to commit wallet link")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to link wallet"})
		return
	}
	// W-34: withdrawal-security changes are audit-logged.
	audit.Log(c, models.AuditWalletLinked, "user", userID,
		"Linked wallet via /wallet/link", map[string]interface{}{"chain": req.Chain})
	c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Wallet linked successfully"})
}

// setProfileWalletAddress updates only profiles.wallet_address (avoids Save() touching
// model fields that may not exist in older DB schemas, e.g. isp).
func setProfileWalletAddress(tx *gorm.DB, userID uuid.UUID, address *string) error {
	return tx.Model(&models.User{}).Where("id = ?", userID).Update("wallet_address", address).Error
}

// clearLinkedWalletIdentity removes the linked on-chain identity and withdrawal routing.
func clearLinkedWalletIdentity(tx *gorm.DB, userID uuid.UUID, chain string) error {
	// W-05: only a Solana unlink clears the Solana profile identity and
	// withdrawal routing. Ethereum identity lives solely in linked_wallets.
	if chain == "solana" {
		if err := setProfileWalletAddress(tx, userID, nil); err != nil {
			return err
		}
		if err := clearWalletWithdrawalRouting(tx, userID); err != nil {
			return err
		}
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
	TxHash         string  `json:"tx_hash" binding:"required"`
	Amount         float64 `json:"amount" binding:"gte=0,lte=100000"`
	AmountLamports int64   `json:"amount_lamports"`
	Chain          string  `json:"chain" binding:"required"` // "solana"
}

func getMaxSingleDepositSOL() float64 {
	if cm := GetConfigManager(); cm != nil {
		if raw, err := cm.Get("max_single_deposit_sol"); err == nil {
			if max, parseErr := strconv.ParseFloat(strings.TrimSpace(raw), 64); parseErr == nil && max > 0 {
				return max
			}
		}
	}
	return models.MaxSingleDepositSOL()
}

func getMaxDailyDepositSOL() float64 {
	if cm := GetConfigManager(); cm != nil {
		if raw, err := cm.Get("max_daily_deposit_sol"); err == nil {
			if max, parseErr := strconv.ParseFloat(strings.TrimSpace(raw), 64); parseErr == nil && max > 0 {
				return max
			}
		}
	}
	return models.MaxDailyDepositSOL()
}

func getWalletDepositsSince(tx *gorm.DB, walletID uuid.UUID, since time.Time) (float64, error) {
	return models.SumDepositsSince(tx, walletID, since)
}

// verifyCryptoDeposit verifies an external crypto transfer and credits the internal wallet
func verifyCryptoDeposit(c *gin.Context) {
	var req cryptoDepositRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// W-20: exact lamports win; the credited amount is still proven on-chain.
	if req.AmountLamports > 0 {
		req.Amount = float64(req.AmountLamports) / 1e9
	}
	if req.Amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "amount_lamports (or amount) must be positive"})
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
	var depositDestKind solana.DepositDestinationKind

	if req.Chain == "solana" {
		if solana.GetTreasuryAddress() == "" && solana.GetDepositVaultAddress() == "" {
			logging.Error(nil).Msg("No deposit destination configured (treasury or vault)")
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

		// SECURITY (P0-6): the fee-payer signer must be the user's linked
		// wallet, and the credited legs must be System Program transfers
		// sourced from that signer — proven at instruction level in
		// integer lamports, never from balance deltas alone.
		sender, err := solana.GetTransactionSender(txResult)
		if err != nil {
			logging.Error(err).Str("tx_hash", req.TxHash).Msg("Failed to get transaction sender")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify transaction sender"})
			return
		}

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

		// W-34 screening: refuse credit from a deny-listed sender.
		if models.AddressBlocked(sender) {
			logging.Error(nil).Str("tx_hash", req.TxHash).Str("sender", sender).
				Msg("CRITICAL: deposit from blocked sender refused (funds remain in treasury, ops review required)")
			c.JSON(http.StatusForbidden, gin.H{"error": "Deposit sender is blocked by screening policy"})
			return
		}

		// Credit EVERY verified leg to an enabled destination (a tx can
		// legitimately pay both vault and treasury); previously only the
		// first matching leg was credited and the rest silently dropped.
		candidates := []struct {
			addr string
			kind solana.DepositDestinationKind
		}{}
		if v := solana.GetDepositVaultAddress(); v != "" {
			candidates = append(candidates, struct {
				addr string
				kind solana.DepositDestinationKind
			}{v, solana.DepositDestVault})
		}
		if taddr := solana.GetTreasuryAddress(); taddr != "" {
			candidates = append(candidates, struct {
				addr string
				kind solana.DepositDestinationKind
			}{taddr, solana.DepositDestTreasury})
		}

		var totalLamports uint64
		var creditedKinds []string
		for _, cand := range candidates {
			kind := solana.ResolveDepositDestination(cand.addr)
			if kind == "" {
				continue // flag disabled for this destination
			}
			lamports, verr := solana.VerifyDepositTransfers(txResult, cand.addr, sender)
			if verr != nil || lamports == 0 {
				continue
			}
			totalLamports += lamports
			creditedKinds = append(creditedKinds, string(kind))
			// Prefer vault as the recorded kind when both legs paid.
			if depositDestKind != solana.DepositDestVault {
				depositDestKind = kind
			}
		}
		if totalLamports == 0 {
			logging.Warn().Str("tx_hash", req.TxHash).Msg("Transaction did not credit an allowed deposit destination")
			c.JSON(http.StatusBadRequest, gin.H{"error": "Transaction does not credit platform treasury or deposit vault"})
			return
		}

		verifiedAmount = float64(totalLamports) / 1e9
		logging.Info().
			Str("tx_hash", req.TxHash).
			Uint64("amount_lamports", totalLamports).
			Float64("amount_sol", verifiedAmount).
			Str("sender", sender).
			Strs("destination_kinds", creditedKinds).
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
		if errors.Is(err, gorm.ErrRecordNotFound) {
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

	// W-34: KYC/trust-tiered caps (never above the global env caps,
	// ConfigManager global ceiling still honoured via min()).
	tierSingle, tierDaily := models.DepositCapsForUser(tx, userUUID)
	if g := getMaxSingleDepositSOL(); g < tierSingle {
		tierSingle = g
	}
	maxDailyDepositSOL := getMaxDailyDepositSOL()
	if tierDaily < maxDailyDepositSOL {
		maxDailyDepositSOL = tierDaily
	}
	if creditedAmount > tierSingle {
		tx.Rollback()
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error":   "Deposit exceeds your tier single-deposit limit",
			"max_sol": tierSingle,
		})
		return
	}
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

	if err := models.CreditWalletLockedOpts(tx, &wallet, creditedAmount, models.LedgerKindDeposit, req.TxHash,
		fmt.Sprintf("Crypto Deposit: %.6f %s", creditedAmount, currency),
		models.LedgerOpts{
			TxHash:      req.TxHash,
			JournalKind: solana.JournalKindForDeposit(depositDestKind),
		},
	); err != nil {
		tx.Rollback()
		logging.Error(err).Str("tx_hash", req.TxHash).Str("user_id", userID).Msg("Failed to credit wallet / ledger")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to credit wallet"})
		return
	}

	// 4. Log Transaction
	pendingTx := models.PendingTransaction{
		UserID:          userUUID,
		Reference:       req.TxHash,
		IdempotencyKey:  req.TxHash,
		Type:            "crypto_deposit",
		Amount:          creditedAmount,
		Currency:        currency,
		Provider:        "blockchain",
		Status:          "completed",
		ExternalRef:     req.TxHash,
		DestinationKind: string(depositDestKind),
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

	// P0-10: a failed commit must never report a credited deposit. The
	// chain payment is verifiable, so ask for a retry (idempotency on the
	// pending_tx signature makes retrying safe).
	if err := tx.Commit().Error; err != nil {
		logging.Error(err).
			Str("user_id", userID).
			Str("tx_hash", req.TxHash).
			Msg("CRITICAL: deposit verified on-chain but commit failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist deposit credit; retry with the same transaction signature"})
		return
	}

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

// EmergencyPauseRequest triggers app-level emergency pause (Redis watchtower).
// On-chain program pause is NOT invoked from this API by default (Wave 4.4).
type EmergencyPauseRequest struct {
	Reason        string `json:"reason" binding:"required"`
	OnchainPause  bool   `json:"onchain_pause"` // ignored unless PROXYHUB_OPS_ONCHAIN_PAUSE=true
}

// emergencyPause triggers the Redis/app emergency breaker.
// Wave 4.4: JWT admin cannot halt the Solana program alone — on-chain pause
// requires OpsOnchainPauseEnabled + CONFIRM_ONCHAIN_PAUSE via ops tooling.
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

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	wt := treasury.NewWatchtower()
	if err := wt.TriggerEmergencyPause(ctx, req.Reason); err != nil {
		logging.Error(err).
			Str("reason", req.Reason).
			Str("triggered_by", c.GetString("user_id")).
			Msg("Failed to trigger emergency pause")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to trigger emergency pause: " + err.Error()})
		return
	}

	onchainSig := ""
	onchainSkipped := "app_level_only"
	if req.OnchainPause {
		if !decentralization.OpsOnchainPauseEnabled() {
			onchainSkipped = "PROXYHUB_OPS_ONCHAIN_PAUSE=false"
		} else if oracle := solana.GetOracleClient(); oracle != nil {
			if sig, err := oracle.EmergencyPauseOnChain(ctx); err != nil {
				logging.Warn().Err(err).Msg("on-chain pause refused or failed")
				onchainSkipped = err.Error()
			} else {
				onchainSig = sig
				onchainSkipped = ""
			}
		} else {
			onchainSkipped = "oracle_unavailable"
		}
	}

	logging.Error(nil).
		Str("reason", req.Reason).
		Str("triggered_by", c.GetString("user_id")).
		Str("onchain_sig", onchainSig).
		Msg("EMERGENCY PAUSE TRIGGERED (app-level)")

	c.JSON(http.StatusOK, gin.H{
		"status":           "paused",
		"scope":            "app_level_redis",
		"reason":           req.Reason,
		"onchain_sig":      onchainSig,
		"onchain_skipped":  onchainSkipped,
		"governance":       decentralization.GovernanceAutonomyMeta(),
		"message":          "App-level emergency pause activated. On-chain program pause requires separate ops confirm.",
	})
}

// getTreasuryAddress returns the configured deposit destination for users.
func getTreasuryAddress(c *gin.Context) {
	address := solana.GetDepositDestinationAddress()
	if address == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Treasury not configured"})
		return
	}

	kind := "treasury"
	if decentralization.DepositVaultUIEnabled() && solana.GetDepositVaultAddress() != "" &&
		address == solana.GetDepositVaultAddress() {
		kind = "vault"
	}

	c.JSON(http.StatusOK, gin.H{
		"treasury_address":  address,
		"deposit_address":   address,
		"destination_kind":  kind,
		"vault_address":     solana.GetDepositVaultAddress(),
		"legacy_treasury":   solana.GetTreasuryAddress(),
		"chain":             "solana",
		"network":           "devnet",
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
