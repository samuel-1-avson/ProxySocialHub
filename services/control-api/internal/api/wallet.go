package api

import (
	"fmt"
	"net/http"
	"runtime/debug"
	"time"

	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/payments"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func RegisterWalletRoutes(r *gin.RouterGroup) {
	wallet := r.Group("/wallet")
	{

		// P2P Transfers
		wallet.POST("/transfer", transferP2P)

		// CRYPTO DEPOSITS (Primary method for users)
		// Strict rate limit: 5 requests per minute per IP/User to prevent RPC scanning
		wallet.POST("/deposit/crypto", RateLimitWithConfig(5, time.Minute), verifyCryptoDeposit)
		wallet.POST("/link", linkWallet)
		wallet.DELETE("/link", linkWallet)

		// FIAT ROUTES (Provider payouts via Mobile Money - kept for provider withdrawals)
		// Deposits via Paystack deprecated for users - use crypto instead
		wallet.POST("/deposit", initiateDeposit)     // Legacy/Provider only
		wallet.POST("/withdraw", initiateWithdrawal) // Provider MoMo payouts
		wallet.GET("/verify", verifyDeposit)         // Paystack callback
		wallet.POST("/swap", swapCurrency)           // GHS <-> SOL conversion

		// General Wallet Info
		wallet.GET("", getWallet)
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

			user = models.User{
				ID:        userID,
				Email:     userEmail,
				Username:  &username,
				TrustTier: models.TrustTierNew,
				Role:      c.GetString("userRole"),
			}
			fmt.Printf("DEBUG: Attempting fallback user create: ID=%v Email='%s' Role='%s'\n", user.ID, user.Email, user.Role)

			// Attempt to create user, log error if it fails
			if err := db.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&user).Error; err != nil {
				fmt.Printf("DEBUG: Fallback create FAILED: %v\n", err)
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
		wallet = models.Wallet{
			UserID:     userID,
			BalanceSOL: 0,
			BalanceGHS: 0,
			Currency:   "MULTI",
		}

		// Attempt creation
		if err := db.DB.Create(&wallet).Error; err != nil {
			if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint") {
				logging.Warn().Str("user_id", userIDStr).Msg("getWallet: Wallet already exists (race condition), fetching")
			} else {
				fmt.Printf("DEBUG: Wallet Create CRITICAL FAIL: %v\n", err)
				logging.Error(err).Str("user_id", userIDStr).Msg("getWallet: Wallet creation failed (Critical)")
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create wallet: " + err.Error()})
				return
			}
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
	if err := db.DB.Where("wallet_id = ?", wallet.ID).Order("created_at DESC").Limit(10).Find(&ledger).Error; err != nil {
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
	if err := db.DB.Where("user_id = ?", userIDStr).Order("created_at DESC").Limit(10).Find(&paymentAttempts).Error; err != nil {
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
			"balance":               wallet.BalanceSOL, // Default display is now SOL
			"balance_ghs":           wallet.BalanceGHS,
			"balance_sol":           wallet.BalanceSOL,
			"balance_usdt":          wallet.BalanceUSDT,
			"currency":              wallet.Currency,
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
	var req depositRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user ID from JWT token
	userUUID, _ := GetUserID(c)
	userID := userUUID.String()
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// DECENTRALIZATION ENFORCEMENT
	// Fiat deposits are disabled to ensure the system remains decentralized.
	c.JSON(http.StatusForbidden, gin.H{
		"error":   "Fiat deposits are disabled.",
		"message": "Please use Crypto deposits (Solana) to fund your wallet. This ensures the system remains decentralized.",
		"action":  "Use /wallet/deposit/crypto",
	})
	return
}

// Verify payment endpoint
func verifyDeposit(c *gin.Context) {
	reference := c.Query("reference")
	if reference == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Reference required"})
		return
	}

	client := payments.NewPaystackClient()
	resp, err := client.VerifyTransaction(reference)
	if err != nil {
		logging.Error(err).Str("reference", reference).Msg("Paystack verification failed")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Verification failed: " + err.Error()})
		return
	}

	if resp.Data.Status != "success" {
		c.JSON(http.StatusBadRequest, gin.H{"status": resp.Data.Status, "message": "Payment not successful"})
		return
	}

	// Process success
	// Use transaction to ensure atomicity
	tx := db.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var pendingTx models.PendingTransaction
	if result := tx.Where("reference = ?", reference).First(&pendingTx); result.Error != nil {
		tx.Rollback()
		logging.Error(result.Error).Str("reference", reference).Msg("Transaction reference not found in DB")
		c.JSON(http.StatusNotFound, gin.H{"error": "Transaction not found"})
		return
	}

	if pendingTx.Status == "completed" {
		tx.Rollback()
		c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Already processed"})
		return
	}

	// Update Transaction Status
	pendingTx.Status = "completed"
	pendingTx.ExternalRef = resp.Data.Reference
	if err := tx.Save(&pendingTx).Error; err != nil {
		tx.Rollback()
		logging.Error(err).Msg("Failed to update pending transaction status")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		return
	}

	// Credit Wallet with Dual Balance Logic
	var wallet models.Wallet
	// Parse UserID
	pUserID, err := uuid.Parse(pendingTx.UserID)
	if err != nil {
		logging.Error(err).Str("user_id_str", pendingTx.UserID).Msg("Invalid UserID in pending tx")
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid UserID"})
		return
	}

	// Check if wallet exists or create
	// Use locking to prevent race conditions during updates
	if result := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", pUserID).First(&wallet); result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			logging.Info().Str("user_id", pUserID.String()).Msg("verifyDeposit: Wallet missing, creating new Multi-Currency wallet")
			wallet = models.Wallet{
				UserID:      pUserID,
				BalanceGHS:  0,
				BalanceSOL:  0,
				BalanceUSDT: 0,
				Currency:    "MULTI",
			}
			if err := tx.Create(&wallet).Error; err != nil {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create wallet"})
				return
			}
		} else {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
			return
		}
	}

	// --- FINANCIAL CORE: FIAT TO CRYPTO BRIDGE ---

	// FETCH REAL TIME RATE
	// Mocking GHS to SOL rate for MVP (e.g., 1 SOL = 2200 GHS)
	// In production, fetch SOL/USD and USD/GHS
	currentRate := 2200.0

	// Calculate crypto value (SOL)
	// Formula: CryptoAmount = FiatAmount / Rate
	fiatAmount := pendingTx.Amount // In GHS
	cryptoAmount := fiatAmount / currentRate

	// Switch Wallet to Crypto Native if not already
	// previousCurrency := wallet.Currency
	if wallet.Currency != "SOL" && wallet.Currency != "MULTI" {
		logging.Info().Str("user_id", wallet.UserID.String()).Msg("Migrating wallet to SOL preference")
		wallet.Currency = "SOL"
		tx.Save(&wallet)
	}

	// Determine Logic: Auto-Swap OR Manual Hold
	autoConvert := false
	// if meta, ok := resp.Data.Metadata.(map[string]interface{}); ok {
	// 	if val, ok := meta["auto_convert"].(bool); ok {
	// 		autoConvert = val
	// 	}
	// }

	finalMessage := "Wallet credited with GHS"

	if autoConvert {
		// SWAP LOGIC (GHS -> SOL)
		newBalance := wallet.BalanceSOL + cryptoAmount

		if err := tx.Model(&wallet).Update("balance_sol", newBalance).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to credit SOL"})
			return
		}

		ledgerEntry := models.WalletLedgerEntry{
			WalletID:     wallet.ID,
			Amount:       cryptoAmount,
			BalanceAfter: newBalance,
			Type:         "auto_swap_deposit",
			ReferenceID:  reference,
			Description:  fmt.Sprintf("Auto-Swap: %.2f GHS -> %.4f SOL (Rate: %.2f)", fiatAmount, cryptoAmount, currentRate),
		}
		tx.Create(&ledgerEntry)

		finalMessage = fmt.Sprintf("Auto-Swapped %.2f GHS to %.4f SOL", fiatAmount, cryptoAmount)

	} else {
		// HOLD LOGIC (Manual Option)
		newBalance := wallet.BalanceGHS + fiatAmount

		if err := tx.Model(&wallet).Update("balance_ghs", newBalance).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to credit GHS"})
			return
		}

		ledgerEntry := models.WalletLedgerEntry{
			WalletID:     wallet.ID,
			Amount:       fiatAmount,
			BalanceAfter: newBalance,
			Type:         models.TransactionTopup,
			ReferenceID:  reference,
			Description:  fmt.Sprintf("Fiat Deposit: %.2f GHS", fiatAmount),
		}
		tx.Create(&ledgerEntry)
	}

	// Commit
	if err := tx.Commit().Error; err != nil {
		logging.Error(err).Msg("Transaction commit failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Commit failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": finalMessage,
	})
}

// Withdrawals would follow similar pattern (Transfer API) but skipping for MVP as per request focusing on "System" usage.
// Keeping existing withdrawal placeholder or removing if strict replacement.
// For now, removing old MoMo webhook and keep withdrawal as unused/placeholder calling error.

type withdrawRequest struct {
	Amount  float64 `json:"amount" binding:"required,gt=0"`
	Phone   string  `json:"phone" binding:"required"`
	Network string  `json:"network" binding:"required"` // MTN, VOD, ATL
}

func initiateWithdrawal(c *gin.Context) {
	var req withdrawRequest
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

	// 1. Transactional Balance Check & Deduction
	tx := db.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var wallet models.Wallet
	if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("user_id = ?", userID).First(&wallet).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Wallet not found"})
		return
	}

	if wallet.BalanceGHS < req.Amount {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient GHS funds (Swap TAO to GHS if needed)"})
		return
	}

	// Deduct balance immediately (optimistic)
	newBalance := wallet.BalanceGHS - req.Amount
	if err := tx.Model(&wallet).Update("balance_ghs", newBalance).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update balance"})
		return
	}

	// Create pending transaction record
	reference := uuid.New().String()
	transaction := models.PendingTransaction{ // Using PendingTransaction table for history
		UserID:    userID,
		Reference: reference,
		Type:      "withdrawal",
		Amount:    req.Amount,
		Currency:  "GHS",
		Provider:  "paystack",
		Phone:     &req.Phone,
		Status:    "processing",
	}
	if err := tx.Create(&transaction).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create transaction record"})
		return
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Transaction commit failed"})
		return
	}

	// 2. Perform Paystack Transfer (Outside DB Lock)
	client := payments.NewPaystackClient()
	var recipientCode string

	// Check for cached recipient code
	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err == nil && user.PaystackRecipientCode != nil {
		recipientCode = *user.PaystackRecipientCode
	} else {
		// Create Recipient
		recipientReq := payments.CreateRecipientRequest{
			Type:          "mobile_money",
			Name:          "ProxyHubb User", // Ideally fetch real name from profile
			AccountNumber: req.Phone,
			BankCode:      req.Network, // e.g. "MTN", "VOD", "ATL" - Frontend must send correct codes
			Currency:      "GHS",
		}

		recipient, err := client.CreateTransferRecipient(recipientReq)
		if err != nil {
			// Refund on failure
			refundWallet(userID, req.Amount)
			updateTxStatus(reference, "failed")
			logging.Error(err).Msg("Paystack create recipient failed")
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid account details: " + err.Error()})
			return
		}

		recipientCode = recipient.Data.RecipientCode

		// Cache the recipient code
		if err := db.DB.Model(&models.User{}).Where("id = ?", userID).Update("paystack_recipient_code", recipientCode).Error; err != nil {
			logging.Warn().Err(err).Msg("Failed to cache Paystack recipient code")
		}
	}

	// Initiate Transfer
	amountPesewas := int64(req.Amount * 100)
	transferReq := payments.TransferRequest{
		Source:    "balance",
		Amount:    fmt.Sprintf("%d", amountPesewas),
		Recipient: recipientCode,
		Reason:    "ProxyHubb Payout",
		Reference: reference,
	}

	transfer, err := client.InitiateTransfer(transferReq)
	if err != nil {
		// Refund on failure
		refundWallet(userID, req.Amount)
		updateTxStatus(reference, "failed")
		logging.Error(err).Msg("Paystack transfer init failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Transfer failed: " + err.Error()})
		return
	}

	// Success (Status is usually "pending" or "success")
	updateTxStatus(reference, transfer.Data.Status)

	// Record Ledger Entry
	ledger := models.WalletLedgerEntry{
		WalletID:     wallet.ID,
		Amount:       -req.Amount, // Negative for withdrawal
		BalanceAfter: newBalance,
		Type:         models.TransactionPayout,
		ReferenceID:  reference,
		Description:  fmt.Sprintf("Payout to %s (%s)", req.Phone, req.Network),
	}
	db.DB.Create(&ledger)

	c.JSON(http.StatusOK, gin.H{
		"status":    "success",
		"message":   "Withdrawal processed successfully",
		"reference": reference,
	})
}

// Helper to refund wallet on failure
// Helper to refund wallet on failure
func refundWallet(userID string, amount float64) {
	if err := db.DB.Model(&models.Wallet{}).Where("user_id = ?", userID).Update("balance_ghs", gorm.Expr("balance_ghs + ?", amount)).Error; err != nil {
		logging.Error(err).Str("user_id", userID).Float64("amount", amount).Msg("Failed to refund wallet")
	}
}

func updateTxStatus(ref, status string) {
	db.DB.Model(&models.PendingTransaction{}).Where("reference = ?", ref).Update("status", status)
}

type p2pTransferRequest struct {
	RecipientIdentifier string  `json:"recipient" binding:"required"` // Email or Username
	Amount              float64 `json:"amount" binding:"required,gt=0"`
	Currency            string  `json:"currency" binding:"required"` // TAO or GHS
}

func transferP2P(c *gin.Context) {
	var req p2pTransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	senderUUID, _ := GetUserID(c)
	senderID := senderUUID.String()

	// Prevent self-transfer
	if req.RecipientIdentifier == senderID { // Weak check, RecipientIdentifier is email/username usually
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot transfer to yourself"})
		return
	}

	tx := db.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 1. Find Recipient
	var recipient models.User
	if err := tx.Where("email = ? OR username = ?", req.RecipientIdentifier, req.RecipientIdentifier).First(&recipient).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusNotFound, gin.H{"error": "Recipient not found"})
		return
	}

	if recipient.ID == senderUUID {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot transfer to yourself"})
		return
	}

	// 2. Lock Wallets (Sort by ID to prevent Deadlock)
	// We need both wallet IDs. Fetch them first without lock, then key-lock?
	// Or just fetch them.
	ids := []string{senderID, recipient.ID.String()}
	// Simple string sort
	if ids[0] > ids[1] {
		ids[0], ids[1] = ids[1], ids[0]
	}

	var senderWallet, recipientWallet models.Wallet

	// Lock First
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", ids[0]).First(
		map[string]*models.Wallet{senderID: &senderWallet, recipient.ID.String(): &recipientWallet}[ids[0]],
	).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to lock wallet 1"})
		return
	}

	// Lock Second
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", ids[1]).First(
		map[string]*models.Wallet{senderID: &senderWallet, recipient.ID.String(): &recipientWallet}[ids[1]],
	).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to lock wallet 2"})
		return
	}

	// Ensure wallets were found (Create recipient wallet if missing?)
	if recipientWallet.ID == uuid.Nil {
		// Create if missing
		recipientWallet = models.Wallet{UserID: recipient.ID, Currency: "MULTI"}
		if err := tx.Create(&recipientWallet).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to init recipient wallet"})
			return
		}
	}

	// 3. Check Balance & Transfer
	if req.Currency == "SOL" {
		if senderWallet.BalanceSOL < req.Amount {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient SOL funds"})
			return
		}
		senderWallet.BalanceSOL -= req.Amount
		recipientWallet.BalanceSOL += req.Amount
	} else if req.Currency == "GHS" {
		if senderWallet.BalanceGHS < req.Amount {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient GHS funds"})
			return
		}
		senderWallet.BalanceGHS -= req.Amount
		recipientWallet.BalanceGHS += req.Amount
	} else {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported currency"})
		return
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
		BalanceAfter: getBalance(&senderWallet, req.Currency),
		Type:         "p2p_sent",
		ReferenceID:  refID,
		Description:  fmt.Sprintf("Sent to %s", req.RecipientIdentifier),
	}

	recipientLedger := models.WalletLedgerEntry{
		WalletID:     recipientWallet.ID,
		Amount:       req.Amount,
		BalanceAfter: getBalance(&recipientWallet, req.Currency),
		Type:         "p2p_received",
		ReferenceID:  refID,
		Description:  fmt.Sprintf("Received from %s", senderID), // Use username if available
	}

	tx.Create(&senderLedger)
	tx.Create(&recipientLedger)

	tx.Commit()
	c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Transfer complete", "reference": refID})
}

func getBalance(w *models.Wallet, currency string) float64 {
	if currency == "SOL" {
		return w.BalanceSOL
	}
	return w.BalanceGHS
}
