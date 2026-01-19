package api

import (
	"fmt"
	"net/http"
	"os"
	"runtime/debug"
	"time"

	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/payments"
)

func RegisterWalletRoutes(r *gin.RouterGroup) {
	wallet := r.Group("/wallet")
	{
		wallet.GET("/", getWallet)
		wallet.POST("/deposit", initiateDeposit)
		wallet.POST("/withdraw", initiateWithdrawal)
		wallet.GET("/verify", verifyDeposit)

		// TAO Routes
		wallet.POST("/deposit/tao", initiateTaoDeposit)
		wallet.POST("/withdraw/tao", initiateTaoWithdrawal)
		wallet.POST("/verify/tao", verifyTaoDeposit)
	}
}

type taoDepositRequest struct {
	TxHash string  `json:"tx_hash" binding:"required"`
	Amount float64 `json:"amount" binding:"required"`
}

func initiateTaoDeposit(c *gin.Context) {
	// For "Push" deposits (user sends first), this endpoint just gives info
	// or user calls verify after sending.
	// We can return the system deposit address.

	client := payments.NewTaoClient(GetBittensorClient())
	addr, err := client.GetDepositAddress()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get deposit address"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"address": addr,
		"message": "Send TAO to this address and call /verify/tao with tx_hash",
	})
}

func verifyTaoDeposit(c *gin.Context) {
	var req taoDepositRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetString("userID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	client := payments.NewTaoClient(GetBittensorClient())

	// Verify On-Chain
	isValid, err := client.VerifyDeposit(req.TxHash, req.Amount)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Verification failed: " + err.Error()})
		return
	}
	if !isValid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid transaction"})
		return
	}

	// Check if already processed
	var existingTx models.PendingTransaction
	if err := db.DB.Where("reference = ?", req.TxHash).First(&existingTx).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Transaction already processed"})
		return
	}

	// Credit Wallet
	tx := db.DB.Begin()
	var wallet models.Wallet
	if err := tx.Where("user_id = ?", userID).First(&wallet).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}

	// If wallet is GHS, we might need conversion or just switch to TAO.
	// Switching to TAO for this "Total Decentralization" goal.
	if wallet.Currency != "TAO" {
		wallet.Currency = "TAO" // Force switch
		wallet.Balance = 0      // Reset or convert? Resetting safest for prototype switch.
		tx.Save(&wallet)
	}

	newBalance := wallet.Balance + req.Amount
	if err := tx.Model(&wallet).Update("balance", newBalance).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to credit wallet"})
		return
	}

	// Record Transaction
	pendingTx := models.PendingTransaction{
		UserID:      userID,
		Reference:   req.TxHash, // TX Hash as reference
		Type:        "deposit",
		Amount:      req.Amount,
		Currency:    "TAO",
		Provider:    "bittensor",
		Status:      "completed",
		ExternalRef: req.TxHash,
	}
	tx.Create(&pendingTx)

	ledger := models.WalletLedgerEntry{
		WalletID:     wallet.ID,
		Amount:       req.Amount,
		BalanceAfter: newBalance,
		Type:         models.TransactionTopup,
		ReferenceID:  req.TxHash,
		Description:  "TAO Deposit via Bridge",
	}
	tx.Create(&ledger)

	tx.Commit()
	c.JSON(http.StatusOK, gin.H{"status": "success", "new_balance": newBalance})
}

type taoWithdrawRequest struct {
	Amount      float64 `json:"amount" binding:"required,gt=0"`
	Destination string  `json:"destination" binding:"required"`
}

func initiateTaoWithdrawal(c *gin.Context) {
	var req taoWithdrawRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetString("userID")

	tx := db.DB.Begin()
	var wallet models.Wallet
	if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("user_id = ?", userID).First(&wallet).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}

	if wallet.Balance < req.Amount {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient funds"})
		return
	}

	// Deduct
	newBalance := wallet.Balance - req.Amount
	if err := tx.Model(&wallet).Update("balance", newBalance).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to deduct funds"})
		return
	}

	// Call Bridge
	client := payments.NewTaoClient(GetBittensorClient())
	err := client.Transfer(req.Destination, req.Amount)

	if err != nil {
		tx.Rollback()
		logging.Error(err).Msg("TAO Transfer failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Transfer failed: " + err.Error()})
		return
	}

	// Record
	ref := uuid.New().String()
	ledger := models.WalletLedgerEntry{
		WalletID:     wallet.ID,
		Amount:       -req.Amount,
		BalanceAfter: newBalance,
		Type:         models.TransactionPayout,
		ReferenceID:  ref,
		Description:  fmt.Sprintf("TAO Withdrawal to %s", req.Destination),
	}
	tx.Create(&ledger)

	tx.Commit()
	c.JSON(http.StatusOK, gin.H{"status": "success", "tx_hash": "pending_bridge_tx"})
}

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
	// Get user ID from JWT token
	userIDStr := c.GetString("userID")
	logging.Info().Str("user_id", userIDStr).Msg("getWallet: Request received")

	if userIDStr == "" {
		logging.Error(nil).Msg("getWallet: User ID not found in context")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		logging.Error(err).Str("user_id", userIDStr).Msg("getWallet: Invalid user ID format")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid user ID"})
		return
	}

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
			// Attempt to create user, log error if it fails
			if err := db.DB.Create(&user).Error; err != nil {
				logging.Error(err).Str("user_id", userIDStr).Msg("getWallet: Fallback user creation failed")
				// If this fails, wallet creation below will likely fail with FK violation
				// We can return error here to be clearer, or let it fall through
			}
		}

		// Now attempt wallet creation with higher confidence
		wallet = models.Wallet{
			UserID:   userID,
			Balance:  0,
			Currency: "GHS",
		}

		// Attempt creation
		if err := db.DB.Create(&wallet).Error; err != nil {
			if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint") {
				logging.Warn().Str("user_id", userIDStr).Msg("getWallet: Wallet already exists (race condition), fetching")
			} else {
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

	c.JSON(http.StatusOK, gin.H{
		"wallet": gin.H{
			"wallet_id":    wallet.ID,
			"balance":      wallet.Balance,
			"currency":     wallet.Currency,
			"transactions": transactions,
		},
	})
}

type depositRequest struct {
	Amount float64 `json:"amount" binding:"required,gt=0"`
	Email  string  `json:"email" binding:"required,email"`
}

func initiateDeposit(c *gin.Context) {
	var req depositRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user ID from JWT token
	userID := c.GetString("userID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Validate minimum deposit (e.g., 1 GHS)
	if req.Amount < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Minimum deposit is 1 GHS"})
		return
	}

	client := payments.NewPaystackClient()
	if client.SecretKey == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Payment configuration missing"})
		return
	}

	// Amount in kobo/pesewas (x100)
	// Paystack expects string for amount to avoid float precision issues, but we pass valid float.
	// Convert to minor units (pesewas) int, then string
	amountPesewas := int64(req.Amount * 100)
	amountStr := fmt.Sprintf("%d", amountPesewas)

	// Generate reference ID
	reference := uuid.New().String()

	// Initialize Paystack Transaction
	paystackReq := payments.InitializeRequest{
		Email:     req.Email,
		Amount:    amountStr,
		Currency:  "GHS",
		Reference: reference,
		Channels:  []string{"card", "mobile_money"},                         // Enable both
		Callback:  os.Getenv("FRONTEND_URL") + "/dashboard/wallet/callback", // Frontend callback
		Metadata: map[string]interface{}{
			"user_id": userID,
			"custom_fields": []map[string]string{
				{
					"display_name":  "User ID",
					"variable_name": "user_id",
					"value":         userID,
				},
			},
		},
	}

	resp, err := client.InitializeTransaction(paystackReq)
	if err != nil {
		logging.Error(err).Msg("Paystack initialization failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to initialize payment"})
		return
	}

	// Store pending transaction in DB
	pendingTx := models.PendingTransaction{
		Reference: reference,
		UserID:    userID,
		Type:      "deposit",
		Amount:    req.Amount,
		Currency:  "GHS",
		Provider:  "paystack",
		Status:    "pending",
		// Phone is not mandatory for Paystack init, captured during checkout
	}
	if err := db.DB.Create(&pendingTx).Error; err != nil {
		logging.Error(err).Msg("Failed to save pending transaction to DB")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		return
	}
	logging.Info().Str("reference", reference).Msg("Deposit initialized and saved")

	c.JSON(http.StatusOK, gin.H{
		"status":            "success",
		"reference":         reference,
		"authorization_url": resp.Data.AuthorizationURL,
		"access_code":       resp.Data.AccessCode,
		"message":           "Payment initialized",
	})
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

	// Credit Wallet
	var wallet models.Wallet
	if result := tx.Where("user_id = ?", pendingTx.UserID).First(&wallet); result.Error != nil {
		tx.Rollback()
		logging.Error(result.Error).Str("user_id", pendingTx.UserID).Msg("Wallet not found for user during deposit")
		// If wallet doesn't exist, we should probably create it or error out.
		// Since user is present, we try to create?
		// For now, error out to avoid data inconsistency.
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Wallet not found for processing"})
		return
	}

	newBalance := wallet.Balance + pendingTx.Amount
	if err := tx.Model(&wallet).Update("balance", newBalance).Error; err != nil {
		tx.Rollback()
		logging.Error(err).Msg("Failed to update wallet balance")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to credit wallet"})
		return
	}

	// Create ledger entry
	ledgerEntry := models.WalletLedgerEntry{
		WalletID:     wallet.ID,
		Amount:       pendingTx.Amount,
		BalanceAfter: newBalance,
		Type:         models.TransactionTopup,
		ReferenceID:  reference,
		Description:  fmt.Sprintf("Paystack Deposit (%s)", resp.Data.Channel),
	}
	if err := tx.Create(&ledgerEntry).Error; err != nil {
		tx.Rollback()
		logging.Error(err).Msg("Failed to create ledger entry")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to log transaction"})
		return
	}

	// Commit
	if err := tx.Commit().Error; err != nil {
		logging.Error(err).Msg("Transaction commit failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Commit failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Wallet credited"})
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

	userID := c.GetString("userID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

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

	if wallet.Balance < req.Amount {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient funds"})
		return
	}

	// Deduct balance immediately (optimistic)
	newBalance := wallet.Balance - req.Amount
	if err := tx.Model(&wallet).Update("balance", newBalance).Error; err != nil {
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

	// Initiate Transfer
	amountPesewas := int64(req.Amount * 100)
	transferReq := payments.TransferRequest{
		Source:    "balance",
		Amount:    fmt.Sprintf("%d", amountPesewas),
		Recipient: recipient.Data.RecipientCode,
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
func refundWallet(userID string, amount float64) {
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", userID).First(&wallet).Error; err == nil {
		db.DB.Model(&wallet).Update("balance", wallet.Balance+amount)
	}
}

func updateTxStatus(ref, status string) {
	db.DB.Model(&models.PendingTransaction{}).Where("reference = ?", ref).Update("status", status)
}
