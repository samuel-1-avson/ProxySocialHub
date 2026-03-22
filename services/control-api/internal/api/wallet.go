package api

import (
	"context"
	"fmt"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	solanaGo "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func RegisterWalletRoutes(r *gin.RouterGroup) {
	wallet := r.Group("/wallet")
	{
		// Financial mutation endpoints are strictly rate-limited to prevent abuse.
		// 5 requests/min covers legitimate use while blocking rapid-fire attack loops.

		// P2P Transfers
		wallet.POST("/transfer", RateLimitWithConfig(5, time.Minute), transferP2P)

		// CRYPTO DEPOSITS
		wallet.POST("/deposit/crypto", RateLimitWithConfig(5, time.Minute), verifyCryptoDeposit)
		wallet.POST("/link", linkWallet)
		wallet.DELETE("/link", linkWallet)

		// SOL WITHDRAWAL — send SOL to user's linked Solana wallet
		wallet.POST("/withdraw/sol", RateLimitWithConfig(5, time.Minute), withdrawSOL)

		// FIAT ROUTES (Provider payouts via Mobile Money - kept for provider withdrawals)
		// Deposits via Paystack deprecated for users - use crypto instead
		// Fiat endpoints removed - SOL only system
		// wallet.POST("/deposit", initiateDeposit)     // REMOVED: Fiat deposits disabled
		// wallet.POST("/withdraw", initiateWithdrawal) // REMOVED: Use /withdraw/sol instead
		// wallet.GET("/verify", verifyDeposit)         // REMOVED: Paystack deprecated
		// wallet.POST("/swap", swapCurrency)           // REMOVED: No swap needed in SOL-only

		// General Wallet Info
		wallet.GET("", getWallet)

		// Spending Limits (Security)
		wallet.GET("/limits", getSpendingLimits)
		wallet.PUT("/limits", updateSpendingLimits)
		wallet.POST("/limits/reset", resetSpendingLimits)
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
	CreatedAt   time.Time `json:"created_at"`
}

func getWallet(c *gin.Context) {
	defer func() {
		if r := recover(); r != nil {
			logging.Error(fmt.Errorf("panic in getWallet: %v", r)).Msg("Recovered from panic")
			// Print stack trace for debugging
			debug.PrintStack()
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Internal Server Error (Panic): %v", r)})
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

		// Now attempt wallet creation with higher confidence
		// Get user's trust tier for default limits
		var userTrustTier models.TrustTier = models.TrustTierNew
		db.DB.Model(&models.User{}).Select("trust_tier").Where("id = ?", userID).Scan(&userTrustTier)

		wallet = models.Wallet{
			UserID:     userID,
			BalanceSOL: 0,
		}
		wallet.InitializeWithDefaultLimits(userTrustTier)

		// Attempt creation — OnConflict DoNothing handles concurrent races safely
		if err := db.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&wallet).Error; err != nil {
			logging.Error(err).Str("user_id", userIDStr).Msg("getWallet: Wallet creation failed")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create wallet: " + err.Error()})
			return
		}

		// Re-fetch to confirm existence and get ID
		if err := db.DB.Where("user_id = ?", userID).First(&wallet).Error; err != nil {
			logging.Error(err).Str("user_id", userIDStr).Msg("getWallet: Failed to retrieve wallet after creation attempt")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to initialize wallet or user not found"})
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
		transactions = append(transactions, TransactionDTO{
			ID:          l.ID.String(),
			Type:        l.Type,
			Amount:      l.Amount,
			Description: l.Description,
			Status:      "settled",
			CreatedAt:   l.CreatedAt,
		})
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

	// Fetch user to checks linked wallets
	var user models.User
	if err := db.DB.Select("wallet_address").First(&user, "id = ?", userID).Error; err != nil {
		logging.Warn().Err(err).Msg("Failed to fetch user linked wallets")
	}

	c.JSON(http.StatusOK, gin.H{
		"wallet": gin.H{
			"wallet_id":             wallet.ID,
			"balance_sol":           wallet.BalanceSOL,
			"transactions":          transactions,
			"linked_solana_address": user.WalletAddress,
		},
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

// Withdrawals would follow similar pattern (Transfer API) but skipping for MVP as per request focusing on "System" usage.
// Keeping existing withdrawal placeholder or removing if strict replacement.
// For now, removing old MoMo webhook and keep withdrawal as unused/placeholder calling error.

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
func refundWalletSOL(userID string, amount float64) {
	if err := db.DB.Model(&models.Wallet{}).Where("user_id = ?", userID).Update("balance_sol", gorm.Expr("balance_sol + ?", amount)).Error; err != nil {
		logging.Error(err).Str("user_id", userID).Float64("amount", amount).Msg("Failed to refund SOL wallet")
	}
}

type p2pTransferRequest struct {
	RecipientIdentifier string  `json:"recipient" binding:"required"` // Email or Username
	Amount              float64 `json:"amount" binding:"required,gt=0"`
}

func transferP2P(c *gin.Context) {
	var req p2pTransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	senderUUID, _ := GetUserID(c)
	senderID := senderUUID.String()

	// Wrap the entire transfer in a 30-second context timeout to prevent lock starvation.
	txCtx, txCancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer txCancel()

	tx := db.DB.WithContext(txCtx).Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 1. Find Recipient by email or username
	var recipient models.User
	if err := tx.Where("email = ? OR username = ?", req.RecipientIdentifier, req.RecipientIdentifier).First(&recipient).Error; err != nil {
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
				"error":     "Spending limit exceeded",
				"limit_type": spendingErr.LimitType,
				"limit":     spendingErr.Limit,
				"spent":     spendingErr.CurrentSpend,
				"attempted": spendingErr.Attempted,
				"remaining": spendingErr.Remaining(),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check spending limits"})
		return
	}

	// 4. Check SOL Balance & Transfer
	if senderWallet.BalanceSOL < req.Amount {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient SOL funds"})
		return
	}
	senderWallet.BalanceSOL -= req.Amount
	recipientWallet.BalanceSOL += req.Amount

	// Record spending for limit tracking
	if err := senderWallet.RecordSpending(tx, req.Amount, models.SpendingTransfer, ""); err != nil {
		logging.Error(err).Msg("Failed to record spending for transfer, continuing")
	}

	if err := tx.Save(&senderWallet).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update sender"})
		return
	}
	if err := tx.Save(&recipientWallet).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update recipient"})
		return
	}

	// 4. Record Ledger Entries
	refID := uuid.New().String()

	senderLedger := models.WalletLedgerEntry{
		WalletID:     senderWallet.ID,
		Amount:       -req.Amount,
		BalanceAfter: senderWallet.BalanceSOL,
		Type:         "p2p_sent",
		ReferenceID:  refID,
		Description:  fmt.Sprintf("Sent to %s", req.RecipientIdentifier),
	}

	recipientLedger := models.WalletLedgerEntry{
		WalletID:     recipientWallet.ID,
		Amount:       req.Amount,
		BalanceAfter: recipientWallet.BalanceSOL,
		Type:         "p2p_received",
		ReferenceID:  refID,
		Description:  fmt.Sprintf("Received from %s", senderID), // Use username if available
	}

	tx.Create(&senderLedger)
	tx.Create(&recipientLedger)

	tx.Commit()
	c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Transfer complete", "reference": refID})
}

type withdrawSOLRequest struct {
	Amount float64 `json:"amount" binding:"required,gt=0"`
}

// withdrawSOL sends SOL from the user's internal balance to their linked Solana wallet.
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

	// Validate Solana address format before touching the balance
	if _, err := solanaGo.PublicKeyFromBase58(*user.WalletAddress); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Linked wallet address is invalid. Please re-link your Solana wallet."})
		return
	}

	// Check oracle is available
	oracle := solana.GetOracleClient()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Blockchain oracle not available"})
		return
	}

	// Atomically deduct from internal balance
	var walletRecord models.Wallet
	err := db.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userUUID).First(&walletRecord).Error; err != nil {
			return fmt.Errorf("wallet not found")
		}

		// Check spending limits
		if err := walletRecord.CheckSpendingLimit(tx, req.Amount, models.SpendingWithdraw); err != nil {
			if spendingErr, ok := err.(*models.SpendingLimitError); ok {
				return fmt.Errorf("%s spending limit exceeded: limit=%.6f SOL, spent=%.6f SOL, attempted=%.6f SOL",
					spendingErr.LimitType, spendingErr.Limit, spendingErr.CurrentSpend, spendingErr.Attempted)
			}
			return err
		}

		if walletRecord.BalanceSOL < req.Amount {
			return fmt.Errorf("insufficient SOL balance: have %.6f, need %.6f", walletRecord.BalanceSOL, req.Amount)
		}
		walletRecord.BalanceSOL -= req.Amount

		// Record spending for limit tracking
		if err := walletRecord.RecordSpending(tx, req.Amount, models.SpendingWithdraw, ""); err != nil {
			logging.Error(err).Msg("Failed to record spending for withdrawal, continuing")
		}

		if err := tx.Save(&walletRecord).Error; err != nil {
			return err
		}
		return tx.Create(&models.WalletLedgerEntry{
			WalletID:     walletRecord.ID,
			Amount:       -req.Amount,
			BalanceAfter: walletRecord.BalanceSOL,
			Type:         models.TransactionPayout,
			Description:  fmt.Sprintf("SOL withdrawal to %s", *user.WalletAddress),
			CreatedAt:    time.Now(),
		}).Error
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Send on-chain — if this fails, refund the internal balance

	ctx := context.Background()
	txHash, sendErr := sendSOLOnChain(ctx, oracle, *user.WalletAddress, req.Amount)
	if sendErr != nil {
		// Refund
		db.DB.Model(&models.Wallet{}).Where("user_id = ?", userUUID).
			Update("balance_sol", gorm.Expr("balance_sol + ?", req.Amount))
		logging.Error(sendErr).
			Str("user_id", userUUID.String()).
			Float64("amount", req.Amount).
			Msg("SOL withdrawal: on-chain transfer failed, balance restored")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "On-chain transfer failed. Balance has been restored."})
		return
	}

	logging.Info().
		Str("user_id", userUUID.String()).
		Str("wallet", *user.WalletAddress).
		Float64("amount_sol", req.Amount).
		Str("tx_hash", txHash).
		Msg("SOL withdrawal completed")

	c.JSON(http.StatusOK, gin.H{
		"status":      "success",
		"tx_hash":     txHash,
		"amount_sol":  req.Amount,
		"destination": *user.WalletAddress,
		"new_balance": walletRecord.BalanceSOL,
	})
}

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
		"limits":    response,
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
