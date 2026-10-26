package api

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	solanaGo "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/alerts"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/treasury"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const defaultLargeWithdrawalThresholdSOL = 10.0

func getLargeWithdrawalThresholdSOL() float64 {
	cm := GetConfigManager()
	if cm == nil {
		return defaultLargeWithdrawalThresholdSOL
	}
	raw, err := cm.Get("large_withdraw_threshold_sol")
	if err != nil {
		return defaultLargeWithdrawalThresholdSOL
	}
	threshold, err := strconv.ParseFloat(raw, 64)
	if err != nil || threshold <= 0 {
		return defaultLargeWithdrawalThresholdSOL
	}
	return threshold
}

func RegisterWalletRoutes(r *gin.RouterGroup) {
	wallet := r.Group("/wallet")
	{
		// Financial mutation endpoints are strictly rate-limited to prevent abuse.
		// 5 requests/min covers legitimate use while blocking rapid-fire attack loops.

		// P2P Transfers
		wallet.POST("/transfer", RateLimitWithConfig(5, time.Minute), transferP2P)

		// CRYPTO DEPOSITS
		wallet.POST("/deposit/crypto", RateLimitWithConfig(5, time.Minute), verifyCryptoDeposit)
		wallet.POST("/link/challenge", RateLimitWithConfig(10, time.Minute), getWalletLinkChallenge)
		wallet.POST("/link", linkWallet)
		wallet.DELETE("/link", linkWallet)

		// SOL WITHDRAWAL — send SOL to user's linked Solana wallet
		wallet.POST("/withdraw/sol", RateLimitWithConfig(5, time.Minute), withdrawSOL)

		// General Wallet Info
		wallet.GET("", getWallet)

		// Spending Limits (Security) — rate-limited to prevent rapid reset attacks
		wallet.GET("/limits", getSpendingLimits)
		wallet.PUT("/limits", RateLimitWithConfig(10, time.Minute), updateSpendingLimits)
		wallet.POST("/limits/reset", RateLimitWithConfig(5, time.Minute), resetSpendingLimits)

		wallet.GET("/withdrawal-security", getWithdrawalSecurity)
		wallet.PUT("/withdrawal-security/whitelist", RateLimitWithConfig(10, time.Minute), updateWithdrawalWhitelist)
		wallet.GET("/security-flags", getMySecurityFlags)
	}
}

// Faucet Handlers

// TransactionDTO for unified response
type TransactionDTO struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	Amount      float64   `json:"amount"`
	Description string    `json:"description"`
	Status      string    `json:"status"` // "settled", "pending", "failed", "completed"
	TxHash      string    `json:"tx_hash,omitempty"`
	SolscanURL  string    `json:"solscan_url,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

func getWallet(c *gin.Context) {
	defer func() {
		if r := recover(); r != nil {
			userID := ""
			if uid, ok := GetUserID(c); ok {
				userID = uid.String()
			}
			recoverHandlerPanic(c, "getWallet", userID, r)
		}
	}()

	// Pagination for transaction history
	txLimit := 50
	if l := c.Query("limit"); l != "" {
		if n, err := fmt.Sscanf(l, "%d", &txLimit); n == 1 && err == nil && txLimit > 0 && txLimit <= 200 {
			// txLimit is set
		} else {
			txLimit = 50
		}
	}

	userUUID, ok := GetUserID(c)
	if !ok {
		logging.Error(nil).Msg("getWallet: User ID not found in context")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	userID := userUUID
	userIDStr := userID.String()
	logging.Info().Str("user_id", userIDStr).Msg("getWallet: Request received")

	var wallet models.Wallet
	// Use Find to avoid GORM 'RecordNotFound' logging noise
	result := db.DB.Where("user_id = ?", userID).Limit(1).Find(&wallet)

	if result.Error != nil {
		logging.Error(result.Error).Str("user_id", userIDStr).Msg("getWallet: Database error retrieving wallet")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		return
	}

	if result.RowsAffected == 0 {
		// Wallet doesn't exist, try to create it.

		// SAFETY NET: Ensure user exists in local DB to prevent FK violation.
		// Middleware should handle this, but race conditions or failures might leave gaps.
		var user models.User
		if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
			// User missing, create placeholder
			logging.Warn().Str("user_id", userIDStr).Msg("getWallet: User missing in local DB, attempting fallback creation")

			userEmail := c.GetString("userEmail")
			if userEmail == "" {
				c.JSON(http.StatusNotFound, gin.H{"error": "User account not initialized"})
				return
			}
			username := strings.Split(userEmail, "@")[0]
			// Append part of UUID to username to ensure uniqueness and avoid collision errors
			if len(userIDStr) >= 8 {
				username = fmt.Sprintf("%s_%s", username, userIDStr[:8])
			}

			// Ensure auth.users parent row exists first (satisfies profiles_id_fkey FK)
			if authErr := db.DB.Exec(
				`INSERT INTO auth.users (id, email) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
				userID, userEmail,
			).Error; authErr != nil {
				logging.Error(authErr).Str("user_id", userIDStr).Msg("getWallet: Failed to sync auth.users row")
			}

			user = models.User{
				ID:        userID,
				Email:     userEmail,
				Username:  &username,
				TrustTier: models.TrustTierNew,
				Role:      c.GetString("userRole"),
			}
			// Attempt to create user, log error if it fails
			if err := db.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&user).Error; err != nil {
				logging.Error(err).Str("user_id", userIDStr).Msg("getWallet: Fallback user creation failed.")
				// We still re-check if user exists now (maybe created by concurrent request)
			}

			// Final check: Does user exist now?
			if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
				logging.Error(err).Str("user_id", userIDStr).Msg("getWallet: User does not exist and fallback creation failed")
				c.JSON(http.StatusNotFound, gin.H{"error": "User account not initialized. Please log in again."})
				return
			}
			logging.Info().Str("user_id", userIDStr).Msg("getWallet: User profile confirmed/created")
		}

		// M-02: Wrap wallet creation in a transaction with SELECT FOR UPDATE on the
		// user row to serialize concurrent creation attempts. Two goroutines that
		// both passed the "wallet doesn't exist" check above will contend on this
		// lock; only one proceeds to INSERT while the other waits, then re-fetches
		// the wallet the winner created.
		createErr := db.DB.Transaction(func(tx *gorm.DB) error {
			// Lock the user row — serializes all concurrent wallet-creation attempts
			// for this user.
			var lockedUser models.User
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ?", userID).First(&lockedUser).Error; err != nil {
				return fmt.Errorf("failed to lock user row: %w", err)
			}

			// Another goroutine may have created the wallet while we waited for the
			// lock — check again before inserting.
			var existing models.Wallet
			if err := tx.Where("user_id = ?", userID).First(&existing).Error; err == nil {
				wallet = existing
				return nil
			}

			newWallet := models.Wallet{
				UserID:     userID,
				BalanceSOL: 0,
			}
			newWallet.InitializeWithDefaultLimits(lockedUser.TrustTier)
			if err := tx.Create(&newWallet).Error; err != nil {
				return fmt.Errorf("failed to create wallet: %w", err)
			}
			wallet = newWallet
			return nil
		})
		if createErr != nil {
			logging.Error(createErr).Str("user_id", userIDStr).Msg("getWallet: Wallet creation failed")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to initialize wallet"})
			return
		}
		logging.Info().Str("wallet_id", wallet.ID.String()).Msg("getWallet: Initialized wallet")
	}

	// Prepare unified transactions list
	var transactions []TransactionDTO

	// 1. Get Settled Transactions (Ledger)
	var ledger []models.WalletLedgerEntry
	if err := db.DB.Where("wallet_id = ?", wallet.ID).Order("created_at DESC").Limit(txLimit).Find(&ledger).Error; err != nil {
		logging.Error(err).Msg("getWallet: Failed to fetch ledger")
	}

	ledgerMap := make(map[string]bool)
	for _, l := range ledger {
		ledgerMap[l.ReferenceID] = true // Track references to avoid duplicates if we merge
		dto := TransactionDTO{
			ID:          l.ID.String(),
			Type:        l.Type,
			Amount:      l.Amount,
			Description: ledgerEntryDescription(l),
			Status:      ledgerEntryStatus(l),
			CreatedAt:   l.CreatedAt,
		}
		if l.TxHash != "" {
			dto.TxHash = l.TxHash
			dto.SolscanURL = SolscanTxURL(l.TxHash)
		} else if isLikelySolanaSignature(l.ReferenceID) {
			dto.TxHash = l.ReferenceID
			dto.SolscanURL = SolscanTxURL(l.ReferenceID)
		}
		transactions = append(transactions, dto)
	}

	// 2. Get Recent Payment Attempts (Pending/Processing/Completed/Failed)
	// We fetch ALL recent attempts to debug "ghost" transactions (Status=Completed but not in ledger)
	var paymentAttempts []models.PendingTransaction
	if err := db.DB.Where("user_id = ?", userIDStr).Order("created_at DESC").Limit(txLimit).Find(&paymentAttempts).Error; err != nil {
		logging.Error(err).Msg("getWallet: Failed to fetch payment attempts")
	}

	for _, p := range paymentAttempts {
		// Skip if this reference is already in the ledger (means it is fully settled)
		if ledgerMap[p.Reference] {
			continue
		}

		status := p.Status
		if status == "processing" {
			status = "pending"
		}

		desc := fmt.Sprintf("%s (%s)", p.Type, p.Provider)
		if p.Type == "deposit" {
			desc = "Deposit via " + p.Provider
		} else if p.Type == "withdrawal" {
			desc = "Withdrawal to " + p.Provider
		}

		displayAmount := p.Amount
		if p.Type == "withdrawal" {
			displayAmount = -p.Amount
		}

		transactions = append(transactions, TransactionDTO{
			ID:          p.ID.String(),
			Type:        p.Type,
			Amount:      displayAmount,
			Description: desc, // Note: "Ghost" tx might appear here
			Status:      status,
			CreatedAt:   p.CreatedAt,
		})
	}

	// Fetch user to check linked Solana wallet
	var user models.User
	if err := db.DB.Select("wallet_address").First(&user, "id = ?", userID).Error; err != nil {
		logging.Warn().Err(err).Msg("Failed to fetch user linked wallets")
	}

	// D-C2: Query on-chain SOL balance when a Solana wallet address is linked.
	// The on-chain balance is the canonical source of truth for the user's SOL
	// holdings; the DB balance (balance_sol) is an internal ledger that tracks
	// funds already escrowed or locked inside the platform.
	var onChainSOL *float64
	var solanaNetwork string
	if user.WalletAddress != nil && *user.WalletAddress != "" {
		oracle := solana.GetOracleClient()
		if oracle != nil {
			solanaNetwork = oracle.GetNetwork()
			if solanaNetwork == "" {
				solanaNetwork = "devnet"
			}

			if pubkey, err := solanaGo.PublicKeyFromBase58(*user.WalletAddress); err == nil {
				if lamports, err := oracle.GetBalance(c.Request.Context(), pubkey); err == nil {
					bal := solana.LamportsToSOL(lamports)
					onChainSOL = &bal
				}
			}
		}
	}

	walletResp := gin.H{
		"wallet_id":             wallet.ID,
		"balance_sol":           wallet.BalanceSOL,
		"balance_lamports":      wallet.EffectiveBalanceLamports(),
		"transactions":          transactions,
		"linked_solana_address": user.WalletAddress,
	}
	if onChainSOL != nil {
		// on_chain_sol: actual SOL held in the user's external wallet (not escrowed)
		walletResp["on_chain_sol"] = *onChainSOL
		// available_sol: the smaller of on-chain + platform balance for spending
		walletResp["available_sol"] = wallet.BalanceSOL
		walletResp["available_lamports"] = wallet.EffectiveBalanceLamports()
	}
	if solanaNetwork != "" {
		walletResp["solana_network"] = solanaNetwork
	}

	c.JSON(http.StatusOK, gin.H{
		"wallet": walletResp,
	})
}

type depositRequest struct {
	Amount      float64 `json:"amount" binding:"required,gt=0"`
	Email       string  `json:"email" binding:"required,email"`
	AutoConvert bool    `json:"auto_convert"` // New field
}

func initiateDeposit(c *gin.Context) {
	// SOL-ONLY: Fiat deposits permanently disabled
	c.JSON(http.StatusForbidden, gin.H{
		"error":   "Fiat deposits are disabled.",
		"message": "This system operates on SOL only. Please use /wallet/deposit/crypto to fund your wallet with SOL.",
		"action":  "Use /wallet/deposit/crypto",
	})
}

// Verify payment endpoint - DEPRECATED: SOL-only system
func verifyDeposit(c *gin.Context) {
	c.JSON(http.StatusForbidden, gin.H{
		"error":   "Fiat deposit verification is disabled.",
		"message": "This system operates on SOL only. Use /wallet/deposit/crypto to fund your wallet.",
	})
}

type withdrawRequest struct {
	Amount float64 `json:"amount" binding:"required,gt=0"`
}

func initiateWithdrawal(c *gin.Context) {
	// SOL-ONLY: Redirect to SOL withdrawal
	c.JSON(http.StatusBadRequest, gin.H{
		"error":   "Fiat withdrawals are disabled.",
		"message": "This system operates on SOL only. Please use /wallet/withdraw/sol to withdraw SOL to your linked wallet.",
		"action":  "Use /wallet/withdraw/sol",
	})
}

// Helper to refund SOL on failure
// refundWalletSOL credits a user's platform balance and creates an audit
// ledger entry.  For escrow-backed sessions the on-chain EmergencyRefund
// instruction already releases SOL to the buyer; this function only mirrors
// that event in the DB ledger.  For custodial-only sessions (no escrow PDA)
// this is both the refund record and the source of truth.
func refundWalletSOL(userID string, amount float64) {
	var wallet models.Wallet
	err := db.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).First(&wallet).Error; err != nil {
			return err
		}
		refID := uuid.New().String()
		return models.CreditWalletLocked(tx, &wallet, amount, "refund", refID,
			fmt.Sprintf("Refund of %.6f SOL", amount))
	})
	if err != nil {
		logging.Error(err).Str("user_id", userID).Float64("amount", amount).Msg("Failed to refund SOL wallet")
	}
}

const maxTransferSOL = 10000.0

type p2pTransferRequest struct {
	RecipientIdentifier string  `json:"recipient" binding:"required"` // Email or Username
	Amount              float64 `json:"amount" binding:"required,gt=0,lte=10000"`
	IdempotencyKey      string  `json:"idempotency_key"`
}

func transferP2P(c *gin.Context) {
	var req p2pTransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	senderUUID, _ := GetUserID(c)
	senderID := senderUUID.String()

	// P0-9: replay a previously completed transfer with the same key.
	idemKey := clientIdempotencyKey(c, req.IdempotencyKey)
	if idemKey != "" && replayStoredIdempotent(c, senderUUID, models.IdempotencyEndpointWalletTransfer, idemKey) {
		return
	}

	// Runtime check: prevent extremely large amounts that could cause float overflow
	if req.Amount > maxTransferSOL {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Transfer amount exceeds maximum allowed", "max": maxTransferSOL})
		return
	}

	// Wrap the entire transfer in a 30-second context timeout to prevent lock starvation.
	txCtx, txCancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer txCancel()

	tx := db.DB.WithContext(txCtx).Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
			recoverHandlerPanic(c, "transferP2P", senderID, r)
		}
	}()

	// 1. Find Recipient by email, email_hash, or username
	var recipient models.User
	ident := strings.TrimSpace(req.RecipientIdentifier)
	hash := models.HashEmail(ident)
	recipQ := tx.Where("email = ? OR username = ?", ident, ident)
	if hash != "" {
		recipQ = tx.Where("email = ? OR email_hash = ? OR username = ?", ident, hash, ident)
	}
	if err := recipQ.First(&recipient).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusNotFound, gin.H{"error": "Recipient not found"})
		return
	}

	// Prevent self-transfer: UUID comparison is the authoritative check (not identifier string).
	if recipient.ID == senderUUID {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot transfer to yourself"})
		return
	}

	// Also guard against sending to an account that shares the same linked Solana wallet address.
	var senderUser models.User
	if err := db.DB.Select("wallet_address").Where("id = ?", senderUUID).First(&senderUser).Error; err == nil {
		if senderUser.WalletAddress != nil && recipient.WalletAddress != nil &&
			*senderUser.WalletAddress != "" && *senderUser.WalletAddress == *recipient.WalletAddress {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot transfer to yourself"})
			return
		}
	}

	// 2. Lock Wallets in a consistent order (lower UUID first) to prevent
	// deadlocks when two concurrent transfers involve the same pair of users.
	// P1-06: Use explicit pointer assignment instead of a fragile map lookup.
	var senderWallet, recipientWallet models.Wallet

	var firstUserID, secondUserID string
	var firstWallet, secondWallet *models.Wallet
	if senderID < recipient.ID.String() {
		firstUserID, secondUserID = senderID, recipient.ID.String()
		firstWallet, secondWallet = &senderWallet, &recipientWallet
	} else {
		firstUserID, secondUserID = recipient.ID.String(), senderID
		firstWallet, secondWallet = &recipientWallet, &senderWallet
	}

	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", firstUserID).First(firstWallet).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to lock wallet 1"})
		return
	}

	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", secondUserID).First(secondWallet).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to lock wallet 2"})
		return
	}

	// Ensure wallets were found (Create recipient wallet if missing?)
	if recipientWallet.ID == uuid.Nil {
		// Create if missing
		recipientWallet = models.Wallet{UserID: recipient.ID}
		// Initialize with recipient's trust tier
		var recipientTrustTier models.TrustTier = models.TrustTierNew
		db.DB.Model(&models.User{}).Select("trust_tier").Where("id = ?", recipient.ID).Scan(&recipientTrustTier)
		recipientWallet.InitializeWithDefaultLimits(recipientTrustTier)

		if err := tx.Create(&recipientWallet).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to init recipient wallet"})
			return
		}
	}

	// 3. Check Spending Limits
	if err := senderWallet.CheckSpendingLimit(tx, req.Amount, models.SpendingTransfer); err != nil {
		tx.Rollback()
		if spendingErr, ok := err.(*models.SpendingLimitError); ok {
			c.JSON(http.StatusForbidden, gin.H{
				"error":      "Spending limit exceeded",
				"limit_type": spendingErr.LimitType,
				"limit":      spendingErr.Limit,
				"spent":      spendingErr.CurrentSpend,
				"attempted":  spendingErr.Attempted,
				"remaining":  spendingErr.Remaining(),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check spending limits"})
		return
	}

	// 4. Check SOL Balance & Transfer
	if !senderWallet.CanAffordSOL(req.Amount) {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient SOL funds"})
		return
	}

	// Record spending for limit tracking
	if err := senderWallet.RecordSpending(tx, req.Amount, models.SpendingTransfer, ""); err != nil {
		logging.Error(err).Msg("Failed to record spending for transfer, continuing")
	}

	refID := uuid.New().String()
	senderDesc := fmt.Sprintf("Sent to %s", req.RecipientIdentifier)
	recipientDesc := fmt.Sprintf("Received from %s", senderID)
	if idemKey != "" {
		if err := claimIdempotencyTx(tx, senderUUID, models.IdempotencyEndpointWalletTransfer, idemKey, refID); err != nil {
			tx.Rollback()
			if replayStoredIdempotent(c, senderUUID, models.IdempotencyEndpointWalletTransfer, idemKey) {
				return
			}
			c.JSON(http.StatusConflict, gin.H{"error": "Duplicate request in progress"})
			return
		}
	}
	if err := models.TransferP2PLocked(tx, &senderWallet, &recipientWallet, req.Amount, refID, senderDesc, recipientDesc); err != nil {
		tx.Rollback()
		logging.Error(err).Str("ref", refID).Msg("Failed to transfer P2P")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Transfer failed — could not update balances"})
		return
	}

	if err := tx.Commit().Error; err != nil {
		logging.Error(err).Str("ref", refID).Msg("Failed to commit P2P transfer")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Transfer failed — could not commit transaction"})
		return
	}

	// BE-CRIT-01: this is an internal book transfer. It must only move balances in
	// the ledger. It used to also send real SOL from the treasury hot wallet to the
	// recipient's linked wallet without debiting the recipient, so two accounts could
	// bounce a balance back and forth and drain the treasury. Users who want SOL on
	// chain withdraw it through POST /v1/wallet/withdraw/sol, which debits them.

	body := gin.H{"status": "success", "message": "Transfer complete", "reference": refID}
	storeIdempotentResponse(senderUUID, models.IdempotencyEndpointWalletTransfer, idemKey, http.StatusOK, body)
	c.JSON(http.StatusOK, body)
}

type withdrawSOLRequest struct {
	Amount         float64 `json:"amount" binding:"required,gt=0,lte=10000"`
	IdempotencyKey string  `json:"idempotency_key"`
	Nonce          string  `json:"nonce"`
	Signature      string  `json:"signature"`
}

func verifyWithdrawalSignature(c *gin.Context, walletAddress string, amount float64, nonce string, signature string) bool {
	message := fmt.Sprintf("withdraw:%s:%.6f", nonce, amount)
	return verifyWalletSignedMessage(c, walletAddress, nonce, signature, message, "withdrawal:nonce")
}

// verifyWalletSignedMessage checks an Ed25519 signature over message with a fresh nonce (replay-protected via Redis).
func verifyWalletSignedMessage(c *gin.Context, walletAddress, nonce, signature, message, redisPrefix string) bool {
	if signature == "" || nonce == "" {
		return false
	}
	var nonceTime int64
	if _, err := fmt.Sscanf(nonce, "%d", &nonceTime); err != nil {
		return false
	}
	t := time.Unix(nonceTime, 0)
	if time.Since(t).Abs() > 5*time.Minute {
		return false
	}

	key := fmt.Sprintf("%s:%s:%s", redisPrefix, walletAddress, nonce)
	if !redis.Client.SetNX(c.Request.Context(), key, "1", 5*time.Minute).Val() {
		return false
	}

	pubKeyBytes, err := base58.Decode(walletAddress)
	if err != nil || len(pubKeyBytes) != 32 {
		return false
	}
	sigBytes, err := base58.Decode(signature)
	if err != nil || len(sigBytes) != 64 {
		return false
	}

	return ed25519.Verify(pubKeyBytes, []byte(message), sigBytes)
}

// --- P0-9: client idempotency helpers (transfer + withdrawal) ---

var errIdempotencyClaimed = errors.New("idempotency key already claimed")

// clientIdempotencyKey resolves the key from the Idempotency-Key header,
// falling back to the JSON body field. Oversized keys are ignored.
func clientIdempotencyKey(c *gin.Context, bodyKey string) string {
	key := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	if key == "" {
		key = strings.TrimSpace(bodyKey)
	}
	if len(key) > 128 {
		return ""
	}
	return key
}

// replayStoredIdempotent writes the stored terminal response (or an
// in-progress 409) for a previously claimed key. Returns true when the
// request was handled.
func replayStoredIdempotent(c *gin.Context, userID uuid.UUID, endpoint, key string) bool {
	if key == "" || db.DB == nil {
		return false
	}
	var rec models.IdempotencyRecord
	err := db.DB.Where("user_id = ? AND endpoint = ? AND idempotency_key = ?", userID, endpoint, key).First(&rec).Error
	if err != nil {
		return false
	}
	if rec.ResponseBody != "" && rec.ResponseStatus != 0 {
		c.Data(rec.ResponseStatus, "application/json; charset=utf-8", []byte(rec.ResponseBody))
		return true
	}
	body := gin.H{"error": "Duplicate request in progress", "status": "in_progress"}
	if rec.Reference != "" {
		body["reference"] = rec.Reference
		// Surface live withdrawal queue state when available.
		var row models.WithdrawalPayout
		if err := db.DB.Where("reference = ?", rec.Reference).First(&row).Error; err == nil {
			body["status"] = row.Status
			if row.TxHash != "" {
				body["tx_hash"] = row.TxHash
			}
		}
	}
	c.JSON(http.StatusConflict, body)
	return true
}

// claimIdempotencyTx inserts the key claim inside the money transaction so
// the claim and the balance change commit atomically.
func claimIdempotencyTx(tx *gorm.DB, userID uuid.UUID, endpoint, key, reference string) error {
	rec := models.IdempotencyRecord{
		UserID:         userID,
		Endpoint:       endpoint,
		IdempotencyKey: key,
		Reference:      reference,
	}
	if err := tx.Create(&rec).Error; err != nil {
		return fmt.Errorf("%w: %v", errIdempotencyClaimed, err)
	}
	return nil
}

// storeIdempotentResponse persists the terminal response for verbatim replay.
func storeIdempotentResponse(userID uuid.UUID, endpoint, key string, status int, body gin.H) {
	if key == "" || db.DB == nil {
		return
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return
	}
	if err := db.DB.Model(&models.IdempotencyRecord{}).
		Where("user_id = ? AND endpoint = ? AND idempotency_key = ?", userID, endpoint, key).
		Updates(map[string]interface{}{"response_status": status, "response_body": string(raw)}).Error; err != nil {
		logging.Error(err).Str("endpoint", endpoint).Msg("idempotency: failed to store response")
	}
}

// --- P0-3: durable withdrawal state machine ---

var (
	errWithdrawalDestinationChanged = errors.New("withdrawal destination changed during processing")
	errWithdrawalFrozen             = errors.New("account is flagged and withdrawals are frozen pending security review")
	errWithdrawalCooldown           = errors.New("withdrawal address changed recently")
)

// confirmWithdrawTxHook resolves on-chain confirmation for a withdrawal.
// Tests override it like sendSOLOnChainHook.
var confirmWithdrawTxHook = func(ctx context.Context, oracle *solana.OracleClient, txHash string) solana.TxConfirmState {
	return solana.WaitForTxConfirmation(ctx, oracle, txHash)
}

// withdrawSOL sends SOL from the user's internal balance to their linked Solana wallet.
// P0-3: the debit and a durable withdrawal_payout_queue row (status=requested)
// commit in ONE transaction. A fast-path then claims the row, sends with a
// bounded context, persists submitted+tx_hash, and only reports success after
// on-chain confirmation; otherwise the payout worker owns completion.
func withdrawSOL(c *gin.Context) {
	var req withdrawSOLRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	// Look up linked Solana wallet address
	var user models.User
	if err := db.DB.Select("id, wallet_address").Where("id = ?", userUUID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	if user.WalletAddress == nil || *user.WalletAddress == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":  "No linked Solana wallet",
			"action": "Link a Solana wallet at /v1/wallet/link before withdrawing",
		})
		return
	}

	var walletRecord models.Wallet
	if err := db.DB.Where("user_id = ?", userUUID).First(&walletRecord).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}

	destAddress, err := walletRecord.WithdrawalDestination(user.WalletAddress)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	if _, err := solanaGo.PublicKeyFromBase58(destAddress); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Withdrawal address is invalid. Please re-link your Solana wallet."})
		return
	}

	// Large withdrawal requires re-signature before balance/oracle work.
	largeWithdrawalThresholdSOL := getLargeWithdrawalThresholdSOL()
	if req.Amount > largeWithdrawalThresholdSOL {
		if !verifyWithdrawalSignature(c, destAddress, req.Amount, req.Nonce, req.Signature) {
			c.JSON(http.StatusForbidden, gin.H{
				"error":         fmt.Sprintf("Signature verification required for large withdrawals (>%.6g SOL)", largeWithdrawalThresholdSOL),
				"threshold_sol": largeWithdrawalThresholdSOL,
			})
			return
		}
	}

	oracle := solana.GetOracleClient()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Blockchain oracle not available"})
		return
	}

	// P0-9: replay before touching balances.
	idemKey := clientIdempotencyKey(c, req.IdempotencyKey)
	if idemKey != "" && replayStoredIdempotent(c, userUUID, models.IdempotencyEndpointWalletWithdraw, idemKey) {
		return
	}

	// Atomically: re-validate destination/flags/cooldown/limits under lock,
	// debit, and create the durable payout intent (+ idempotency claim).
	withdrawalRef := uuid.NewString()
	var payoutID uuid.UUID
	err = db.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userUUID).First(&walletRecord).Error; err != nil {
			return fmt.Errorf("wallet not found")
		}

		var lockedUser models.User
		if err := tx.Select("id, wallet_address").Where("id = ?", userUUID).First(&lockedUser).Error; err != nil {
			return fmt.Errorf("user not found")
		}
		lockedDest, destErr := walletRecord.WithdrawalDestination(lockedUser.WalletAddress)
		if destErr != nil || lockedDest != destAddress {
			return errWithdrawalDestinationChanged
		}
		{
		}
		var flagCount int64
		if err := tx.Model(&models.UserFlag{}).Where("user_id = ? AND resolved = ?", userUUID, false).Count(&flagCount).Error; err == nil && flagCount > 0 {
			return errWithdrawalFrozen
		}

		if walletRecord.PrimaryWithdrawalAddress != nil &&
			walletRecord.WithdrawalAddressChangedAt != nil &&
			time.Since(*walletRecord.WithdrawalAddressChangedAt) < 24*time.Hour {
			return errWithdrawalCooldown
		}

		if err := walletRecord.CheckSpendingLimit(tx, req.Amount, models.SpendingWithdraw); err != nil {
			return err
		}
		if !walletRecord.CanAffordSOL(req.Amount) {
			return fmt.Errorf("insufficient SOL balance: have %.6f, need %.6f", walletRecord.BalanceSOL, req.Amount)
		}

		desc := fmt.Sprintf("SOL withdrawal to %s", destAddress)
		if err := models.DebitWalletLocked(tx, &walletRecord, req.Amount, models.TransactionPayout, withdrawalRef, desc); err != nil {
			return err
		}
		if err := walletRecord.RecordSpending(tx, req.Amount, models.SpendingWithdraw, withdrawalRef); err != nil {
			return err
		}

		walletID := walletRecord.ID
		row := models.WithdrawalPayout{
			UserID:      userUUID,
			WalletID:    &walletID,
			Reference:   withdrawalRef,
			Destination: destAddress,
			AmountSOL:   req.Amount,
			Status:      models.WithdrawalPayoutRequested,
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		payoutID = row.ID

		if idemKey != "" {
			if err := claimIdempotencyTx(tx, userUUID, models.IdempotencyEndpointWalletWithdraw, idemKey, withdrawalRef); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, errIdempotencyClaimed) {
			if replayStoredIdempotent(c, userUUID, models.IdempotencyEndpointWalletWithdraw, idemKey) {
				return
			}
			c.JSON(http.StatusConflict, gin.H{"error": "Duplicate request in progress"})
			return
		}
		if errors.Is(err, errWithdrawalDestinationChanged) {
			c.JSON(http.StatusConflict, gin.H{"error": "Withdrawal destination changed during processing. Please retry."})
			return
		}
		if errors.Is(err, errWithdrawalFrozen) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Account is flagged and withdrawals are frozen pending security review."})
			return
		}
		if errors.Is(err, errWithdrawalCooldown) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Withdrawal address changed recently. Please wait 24 hours."})
			return
		}
		if spendingErr, ok := err.(*models.SpendingLimitError); ok {
			c.JSON(http.StatusForbidden, gin.H{
				"error":      "Spending limit exceeded",
				"limit_type": spendingErr.LimitType,
				"limit":      spendingErr.Limit,
				"spent":      spendingErr.CurrentSpend,
				"attempted":  spendingErr.Attempted,
				"remaining":  spendingErr.Remaining(),
			})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	status, body := attemptWithdrawalPayout(c, oracle, userUUID, payoutID, withdrawalRef, destAddress, req.Amount, walletRecord.BalanceSOL)
	storeIdempotentResponse(userUUID, models.IdempotencyEndpointWalletWithdraw, idemKey, status, body)
	c.JSON(status, body)
}

func isHotWalletInsufficientErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "insufficient sol balance") ||
		strings.Contains(msg, "insufficient lamports") ||
		strings.Contains(msg, "insufficient funds")
}

// attemptWithdrawalPayout claims the durable payout row and tries to pay it
// now. Every exit leaves the row in a state the worker can finish safely.
func attemptWithdrawalPayout(c *gin.Context, oracle *solana.OracleClient, userUUID, payoutID uuid.UUID, withdrawalRef, destAddress string, amountSOL, newBalance float64) (int, gin.H) {
	processing := gin.H{
		"status":      "processing",
		"reference":   withdrawalRef,
		"amount_sol":  amountSOL,
		"destination": destAddress,
		"new_balance": newBalance,
		"message":     "Withdrawal submitted — usually completes in under a few minutes",
	}

	claim := db.DB.Model(&models.WithdrawalPayout{}).
		Where("id = ? AND status = ?", payoutID, models.WithdrawalPayoutRequested).
		Updates(map[string]interface{}{
			"status":   models.WithdrawalPayoutPaying,
			"attempts": gorm.Expr("attempts + 1"),
		})
	if claim.Error != nil || claim.RowsAffected == 0 {
		return http.StatusAccepted, processing
	}

	const feeHeadroomLamports uint64 = 10_000
	needLamports := models.SOLToLamports(amountSOL) + feeHeadroomLamports
	tm := treasury.GetManager()

	// Best-effort vault->hot top-up when the payout balance is readable and
	// thin. The send itself is the authority on sufficiency.
	if tm != nil {
		balCtx, balCancel := context.WithTimeout(context.Background(), 10*time.Second)
		if payoutBal, balErr := oracle.GetBalance(balCtx, oracle.GetPayoutPublicKey()); balErr == nil && payoutBal < needLamports {
			topCtx, topCancel := context.WithTimeout(context.Background(), 45*time.Second)
			if _, topErr := tm.EnsureHotLiquidity(topCtx, needLamports); topErr != nil {
				logging.Warn().Err(topErr).Str("reference", withdrawalRef).Msg("withdraw: fast-path vault top-up failed; attempting send, worker retains ownership on failure")
			}
			topCancel()
		}
		balCancel()
	}

	sendCtx, sendCancel := context.WithTimeout(context.Background(), 45*time.Second)
	txHash, sendErr := sendSOLOnChainHook(sendCtx, oracle, destAddress, amountSOL)
	timedOut := errors.Is(sendCtx.Err(), context.DeadlineExceeded)
	sendCancel()

	if sendErr != nil {
		if timedOut {
			// Ambiguous: the tx may have broadcast. Leave the row in
			// paying; the worker parks stale paying rows for review and
			// never blindly re-sends or refunds.
			if uerr := db.DB.Model(&models.WithdrawalPayout{}).Where("id = ?", payoutID).
				Update("last_error", "fast-path send timed out; outcome ambiguous").Error; uerr != nil {
				logging.Warn().Err(uerr).Str("payout_id", payoutID.String()).Msg("WithdrawSOL: failed to note ambiguous send on payout row")
			}
			return http.StatusAccepted, processing
		}
		if isHotWalletInsufficientErr(sendErr) {
			if uerr := db.DB.Model(&models.WithdrawalPayout{}).Where("id = ?", payoutID).
				Updates(map[string]interface{}{
					"status":     models.WithdrawalPayoutFunding,
					"last_error": "hot wallet thin on fast path; queued for payout worker",
				}).Error; uerr != nil {
				// Row stays in paying and is swept by the worker, so the
				// 202 is still honest — but the failure must be visible.
				logging.Error(uerr).Str("payout_id", payoutID.String()).Msg("WithdrawSOL: failed to move payout to funding; worker sweep will recover")
			}
			go func() {
				bg, cancel := context.WithTimeout(context.Background(), 60*time.Second)
				defer cancel()
				if tm != nil {
					_, _ = tm.EnsureHotLiquidity(bg, needLamports)
				}
				treasury.NotifyPayoutDrain()
			}()
			return http.StatusAccepted, processing
		}
		// Definite pre-broadcast failure: refund synchronously (prior API
		// behaviour), through the durable row.
		if refundErr := refundWithdrawalPayoutRow(payoutID, withdrawalRef, userUUID, amountSOL, "Withdrawal failed: "+summarizeOnChainSendError(sendErr)+" — balance restored"); refundErr != nil {
			logging.Error(refundErr).Str("user_id", userUUID.String()).Float64("amount", amountSOL).
				Msg("CRITICAL: Compensating refund failed — enqueued for retry")
			alerts.Send(alerts.Critical, "Compensating Refund Failed", fmt.Sprintf("User: %s | Amount: %.6f SOL | Ref: %s | Err: %v", userUUID, amountSOL, withdrawalRef, refundErr))
			EnqueueCompensation(models.CompensationKindWithdrawalRefund, userUUID, nil, amountSOL, withdrawalRef, refundErr.Error())
			return http.StatusInternalServerError, gin.H{
				"error":  "On-chain transfer failed. Balance restoration is being retried.",
				"reason": summarizeOnChainSendError(sendErr),
			}
		}
		logging.Error(sendErr).Str("user_id", userUUID.String()).Float64("amount", amountSOL).
			Msg("SOL withdrawal: on-chain transfer failed, balance restored")
		return http.StatusInternalServerError, gin.H{
			"error":  "On-chain transfer failed. Balance has been restored.",
			"reason": summarizeOnChainSendError(sendErr),
		}
	}

	// Persist submitted + tx hash before any success claim.
	now := time.Now()
	if updErr := db.DB.Model(&models.WithdrawalPayout{}).Where("id = ?", payoutID).Updates(map[string]interface{}{
		"status":  models.WithdrawalPayoutSubmitted,
		"tx_hash": txHash,
		"paid_at": now,
	}).Error; updErr != nil {
		logging.Error(updErr).Str("reference", withdrawalRef).Str("tx_hash", txHash).
			Msg("CRITICAL: withdrawal sent but submitted state not persisted — manual reconciliation required")
		alerts.Send(alerts.Critical, "Withdrawal Sent But State Not Persisted",
			fmt.Sprintf("User: %s | Ref: %s | Tx: %s | Amount: %.6f SOL", userUUID, withdrawalRef, txHash, amountSOL))
	}

	confirmCtx, confirmCancel := context.WithTimeout(context.Background(), 25*time.Second)
	state := confirmWithdrawTxHook(confirmCtx, oracle, txHash)
	confirmCancel()

	switch state {
	case solana.TxConfirmed:
		if err := db.DB.Model(&models.WithdrawalPayout{}).
			Where("id = ? AND status != ?", payoutID, models.WithdrawalPayoutCompleted).
			Update("status", models.WithdrawalPayoutCompleted).Error; err != nil {
			logging.Error(err).Str("reference", withdrawalRef).Msg("withdraw: failed to mark payout completed")
		}
		if tm != nil {
			_ = tm.RecordOutgoingTransfer(context.Background(), amountSOL)
		}
		logging.Info().Str("user_id", userUUID.String()).Str("wallet", destAddress).
			Float64("amount_sol", amountSOL).Str("tx_hash", txHash).Msg("SOL withdrawal completed")
		return http.StatusOK, gin.H{
			"status":      "success",
			"tx_hash":     txHash,
			"solscan_url": SolscanTxURL(txHash),
			"amount_sol":  amountSOL,
			"destination": destAddress,
			"new_balance": newBalance,
		}
	case solana.TxFailed:
		if refundErr := refundWithdrawalPayoutRow(payoutID, withdrawalRef, userUUID, amountSOL, "Withdrawal transaction failed on-chain — balance restored"); refundErr != nil {
			EnqueueCompensation(models.CompensationKindWithdrawalRefund, userUUID, nil, amountSOL, withdrawalRef, refundErr.Error())
			alerts.Send(alerts.Critical, "Compensating Refund Failed", fmt.Sprintf("User: %s | Amount: %.6f SOL | Ref: %s | Err: %v", userUUID, amountSOL, withdrawalRef, refundErr))
			return http.StatusInternalServerError, gin.H{
				"error":  "On-chain transfer failed. Balance restoration is being retried.",
				"reason": "transaction failed on-chain",
			}
		}
		return http.StatusInternalServerError, gin.H{
			"error":  "On-chain transfer failed. Balance has been restored.",
			"reason": "transaction failed on-chain",
		}
	default:
		body := gin.H{
			"status":      "processing",
			"reference":   withdrawalRef,
			"tx_hash":     txHash,
			"solscan_url": SolscanTxURL(txHash),
			"amount_sol":  amountSOL,
			"destination": destAddress,
			"new_balance": newBalance,
			"message":     "Withdrawal submitted — awaiting on-chain confirmation",
		}
		return http.StatusAccepted, body
	}
}

// refundWithdrawalPayoutRow credits the user back exactly once for a payout
// reference and terminates the queue row as failed.
func refundWithdrawalPayoutRow(payoutID uuid.UUID, withdrawalRef string, userUUID uuid.UUID, amountSOL float64, reason string) error {
	return db.DB.Transaction(func(tx *gorm.DB) error {
		var refunds int64
		if err := tx.Model(&models.WalletLedgerEntry{}).
			Where("reference_id = ? AND type = ?", withdrawalRef, "withdrawal_failed_refund").
			Count(&refunds).Error; err != nil {
			return err
		}
		if refunds == 0 {
			var refundWallet models.Wallet
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userUUID).First(&refundWallet).Error; err != nil {
				return err
			}
			if err := models.CreditWalletLocked(tx, &refundWallet, amountSOL, "withdrawal_failed_refund", withdrawalRef, reason); err != nil {
				return err
			}
			if err := tx.Where("wallet_id = ? AND user_id = ? AND type = ? AND reference = ?", refundWallet.ID, userUUID, models.SpendingWithdraw, withdrawalRef).
				Delete(&models.SpendingRecord{}).Error; err != nil {
				return err
			}
		}
		return tx.Model(&models.WithdrawalPayout{}).
			Where("id = ? AND status != ?", payoutID, models.WithdrawalPayoutCompleted).
			Updates(map[string]interface{}{
				"status":     models.WithdrawalPayoutFailed,
				"last_error": reason,
			}).Error
	})
}

func isLikelySolanaSignature(s string) bool {
	if len(s) < 80 || len(s) > 90 {
		return false
	}
	for _, c := range s {
		if (c >= '1' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') {
			continue
		}
		return false
	}
	return true
}

// ledgerEntryStatus maps internal ledger rows to UI protocol status.
func ledgerEntryStatus(l models.WalletLedgerEntry) string {
	switch l.Type {
	case "withdrawal_failed_refund":
		return "failed"
	default:
		return "settled"
	}
}

// ledgerEntryDescription keeps refund rows readable in the settlement ledger.
func ledgerEntryDescription(l models.WalletLedgerEntry) string {
	if l.Type == "withdrawal_failed_refund" && strings.HasPrefix(l.Description, "On-chain transfer failed:") {
		// Legacy rows stored the full RPC error blob.
		return "Withdrawal failed — balance restored (no SOL sent to linked wallet)"
	}
	return l.Description
}

// summarizeOnChainSendError turns RPC/oracle errors into short user-facing text.
func summarizeOnChainSendError(err error) string {
	if err == nil {
		return "unknown error"
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "insufficient lamports"):
		return "treasury wallet has insufficient devnet SOL to pay this withdrawal (fund the platform oracle/treasury, then retry)"
	case strings.Contains(msg, "velocity guard"):
		return "transfer blocked by treasury safety limits"
	case strings.Contains(msg, "frozen"):
		return "treasury transfers are temporarily frozen"
	case strings.Contains(msg, "velocityguard not initialised"):
		return "treasury payout service is not fully configured"
	default:
		return "blockchain transfer could not be submitted"
	}
}

// getWithdrawalSecurity returns withdrawal address, whitelist, and cooldown state.
func getWithdrawalSecurity(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var walletRecord models.Wallet
	if err := db.DB.Where("user_id = ?", userUUID).First(&walletRecord).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}

	cooldownActive := false
	var cooldownUntil *time.Time
	if walletRecord.WithdrawalAddressChangedAt != nil &&
		time.Since(*walletRecord.WithdrawalAddressChangedAt) < 24*time.Hour {
		cooldownActive = true
		until := walletRecord.WithdrawalAddressChangedAt.Add(24 * time.Hour)
		cooldownUntil = &until
	}

	c.JSON(http.StatusOK, gin.H{
		"primary_withdrawal_address":    walletRecord.PrimaryWithdrawalAddress,
		"withdrawal_whitelist":          walletRecord.WithdrawalWhitelist,
		"withdrawal_cooldown_active":    cooldownActive,
		"withdrawal_cooldown_until":     cooldownUntil,
		"withdrawal_address_changed_at": walletRecord.WithdrawalAddressChangedAt,
	})
}

type updateWithdrawalWhitelistRequest struct {
	Addresses []string `json:"addresses" binding:"required,max=20,dive,required"`
}

// updateWithdrawalWhitelist replaces the user's withdrawal whitelist (empty = no whitelist restriction).
func updateWithdrawalWhitelist(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var req updateWithdrawalWhitelistRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	seen := make(map[string]struct{}, len(req.Addresses))
	normalized := make([]string, 0, len(req.Addresses))
	for _, addr := range req.Addresses {
		addr = strings.TrimSpace(addr)
		if _, err := solanaGo.PublicKeyFromBase58(addr); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid Solana address: %s", addr)})
			return
		}
		if _, dup := seen[addr]; dup {
			continue
		}
		seen[addr] = struct{}{}
		normalized = append(normalized, addr)
	}

	var walletRecord models.Wallet
	if err := db.DB.Where("user_id = ?", userUUID).First(&walletRecord).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}

	if walletRecord.PrimaryWithdrawalAddress != nil && *walletRecord.PrimaryWithdrawalAddress != "" && len(normalized) > 0 {
		primaryInList := false
		for _, addr := range normalized {
			if addr == *walletRecord.PrimaryWithdrawalAddress {
				primaryInList = true
				break
			}
		}
		if !primaryInList {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Whitelist must include your primary withdrawal address"})
			return
		}
	}

	walletRecord.WithdrawalWhitelist = normalized
	if err := db.DB.Save(&walletRecord).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update whitelist"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"withdrawal_whitelist": walletRecord.WithdrawalWhitelist,
		"message":              "Withdrawal whitelist updated",
	})
}

// getMySecurityFlags lists unresolved and recent account security flags for the current user.
func getMySecurityFlags(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var flags []models.UserFlag
	if err := db.DB.Where("user_id = ?", userUUID).Order("created_at DESC").Limit(50).Find(&flags).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load security flags"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"flags": flags, "count": len(flags)})
}

// sendSOLOnChainHook is overridden in tests to mock treasury payouts without a live oracle.
var sendSOLOnChainHook = sendSOLOnChain

// sendSOLOnChain builds and submits a SOL transfer instruction from the treasury to recipient.
func sendSOLOnChain(ctx context.Context, oracle *solana.OracleClient, recipientAddress string, amountSOL float64) (string, error) {
	recipient, err := solanaGo.PublicKeyFromBase58(recipientAddress)
	if err != nil {
		return "", fmt.Errorf("invalid recipient address: %w", err)
	}

	lamports := solana.SOLToLamports(amountSOL)
	return oracle.SendSOL(ctx, recipient, lamports)
}

// Spending Limit Handlers

type spendingLimitsResponse struct {
	Daily struct {
		Limit float64 `json:"limit"`
		Spent float64 `json:"spent"`
	} `json:"daily"`
	Weekly struct {
		Limit float64 `json:"limit"`
		Spent float64 `json:"spent"`
	} `json:"weekly"`
	Monthly struct {
		Limit float64 `json:"limit"`
		Spent float64 `json:"spent"`
	} `json:"monthly"`
}

// getSpendingLimits returns the user's current spending limits and usage
func getSpendingLimits(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", userUUID).First(&wallet).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}

	// Get current spending
	spending, err := wallet.GetSpendingForWindow(db.DB)
	if err != nil {
		logging.Error(err).Msg("Failed to get spending for window")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve spending data"})
		return
	}

	response := spendingLimitsResponse{}
	response.Daily.Limit = wallet.DailyLimit
	response.Daily.Spent = spending.DailySpent
	response.Weekly.Limit = wallet.WeeklyLimit
	response.Weekly.Spent = spending.WeeklySpent
	response.Monthly.Limit = wallet.MonthlyLimit
	response.Monthly.Spent = spending.MonthlySpent

	c.JSON(http.StatusOK, gin.H{
		"limits":       response,
		"window_start": wallet.LimitWindowStart,
	})
}

type updateLimitsRequest struct {
	Daily   *float64 `json:"daily,omitempty"`
	Weekly  *float64 `json:"weekly,omitempty"`
	Monthly *float64 `json:"monthly,omitempty"`
}

// updateSpendingLimits allows users to set their own spending limits
// Users can only set limits equal to or lower than system maximums
func updateSpendingLimits(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var req updateLimitsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user's trust tier for max limits
	var user models.User
	if err := db.DB.Select("trust_tier").Where("id = ?", userUUID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	maxLimits := models.GetDefaultLimits(user.TrustTier)

	// Validate and apply limits
	updates := map[string]interface{}{}

	if req.Daily != nil {
		if *req.Daily <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Daily limit must be greater than 0; omit the field to leave it unchanged"})
			return
		}
		if *req.Daily > maxLimits.Daily {
			c.JSON(http.StatusForbidden, gin.H{
				"error":       "Daily limit exceeds maximum allowed",
				"requested":   *req.Daily,
				"max_allowed": maxLimits.Daily,
			})
			return
		}
		updates["daily_limit"] = *req.Daily
	}

	if req.Weekly != nil {
		if *req.Weekly <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Weekly limit must be greater than 0; omit the field to leave it unchanged"})
			return
		}
		if *req.Weekly > maxLimits.Weekly {
			c.JSON(http.StatusForbidden, gin.H{
				"error":       "Weekly limit exceeds maximum allowed",
				"requested":   *req.Weekly,
				"max_allowed": maxLimits.Weekly,
			})
			return
		}
		updates["weekly_limit"] = *req.Weekly
	}

	if req.Monthly != nil {
		if *req.Monthly <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Monthly limit must be greater than 0; omit the field to leave it unchanged"})
			return
		}
		if *req.Monthly > maxLimits.Monthly {
			c.JSON(http.StatusForbidden, gin.H{
				"error":       "Monthly limit exceeds maximum allowed",
				"requested":   *req.Monthly,
				"max_allowed": maxLimits.Monthly,
			})
			return
		}
		updates["monthly_limit"] = *req.Monthly
	}

	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No limits provided"})
		return
	}

	if err := db.DB.Model(&models.Wallet{}).Where("user_id = ?", userUUID).Updates(updates).Error; err != nil {
		logging.Error(err).Msg("Failed to update spending limits")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update limits"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Spending limits updated",
		"limits":  updates,
	})
}

// resetSpendingLimits resets limits to default based on trust tier
func resetSpendingLimits(c *gin.Context) {
	userUUID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var user models.User
	if err := db.DB.Select("trust_tier").Where("id = ?", userUUID).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	defaults := models.GetDefaultLimits(user.TrustTier)

	updates := map[string]interface{}{
		"daily_limit":   defaults.Daily,
		"weekly_limit":  defaults.Weekly,
		"monthly_limit": defaults.Monthly,
	}

	if err := db.DB.Model(&models.Wallet{}).Where("user_id = ?", userUUID).Updates(updates).Error; err != nil {
		logging.Error(err).Msg("Failed to reset spending limits")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reset limits"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Spending limits reset to defaults",
		"limits":  defaults,
	})
}
