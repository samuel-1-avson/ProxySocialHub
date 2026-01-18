package api

import (
	"fmt"
	"net/http"
	"os"
	"time"

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
	}
}

func getWallet(c *gin.Context) {
	// Get user ID from JWT token
	userID := c.GetString("userID")
	if userID == "" {
		logging.Error(nil).Msg("getWallet: User ID not found in context")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var wallet models.Wallet
	result := db.DB.Where("user_id = ?", userID).First(&wallet)
	if result.Error != nil {
		// Log the error
		logging.Warn().Err(result.Error).Str("user_id", userID).Msg("getWallet: Wallet not found, checking user")

		// Verify user exists first
		var user models.User
		if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
			logging.Error(err).Str("user_id", userID).Msg("getWallet: User not found in DB")
			c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
			return
		}

		// Create wallet if doesn't exist
		parsedUserID, err := uuid.Parse(userID)
		if err != nil {
			logging.Error(err).Str("user_id", userID).Msg("getWallet: Invalid user ID format")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid user ID"})
			return
		}

		wallet = models.Wallet{
			UserID:   parsedUserID,
			Balance:  0,
			Currency: "GHS",
		}
		if err := db.DB.Create(&wallet).Error; err != nil {
			logging.Error(err).Msg("getWallet: Failed to create wallet")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create wallet"})
			return
		}
		logging.Info().Str("wallet_id", wallet.ID.String()).Msg("getWallet: Created new wallet")
	}

	// Get recent transactions
	// Unified Transaction DTO
	type TransactionDTO struct {
		ID          string    `json:"id"`
		Type        string    `json:"type"`
		Amount      float64   `json:"amount"`
		Description string    `json:"description"`
		Status      string    `json:"status"` // "settled", "pending", "failed"
		CreatedAt   time.Time `json:"created_at"`
	}

	var transactions []TransactionDTO

	// 1. Get Settled Transactions (Ledger)
	var ledger []models.WalletLedgerEntry
	db.DB.Where("wallet_id = ?", wallet.ID).Order("created_at DESC").Limit(10).Find(&ledger)

	for _, l := range ledger {
		transactions = append(transactions, TransactionDTO{
			ID:          l.ID.String(),
			Type:        l.Type,
			Amount:      l.Amount,
			Description: l.Description,
			Status:      "settled",
			CreatedAt:   l.CreatedAt,
		})
	}

	// 2. Get Pending Transactions (Deposits/Withdrawals)
	// PendingTransaction uses string UserID
	var pending []models.PendingTransaction
	db.DB.Where("user_id = ? AND status != 'completed'", userID).Order("created_at DESC").Limit(5).Find(&pending)

	for _, p := range pending {
		desc := fmt.Sprintf("%s (%s)", p.Type, p.Provider)
		if p.Type == "deposit" {
			desc = "Deposit via " + p.Provider
		} else if p.Type == "withdrawal" {
			desc = "Withdrawal to " + p.Provider
		}

		// Pending transactions shouldn't have signed amount in DB usually, but for display we want:
		// Deposit = Positive (potential), Withdrawal = Negative (potential)
		// Logic:
		displayAmount := p.Amount
		if p.Type == "withdrawal" {
			displayAmount = -p.Amount
		}

		status := p.Status // "pending", "failed", "processing"
		if status == "processing" {
			status = "pending"
		}

		transactions = append(transactions, TransactionDTO{
			ID:          p.ID.String(),
			Type:        p.Type,
			Amount:      displayAmount,
			Description: desc,
			Status:      status,
			CreatedAt:   p.CreatedAt,
		})
	}

	// 3. Sort Combined List (Newest First)
	// Simple bubble sort or just append and rely on client?
	// The lists are individually sorted. We should probably sort the final list.
	// For < 20 items, simple sort is fine.
	// Actually, let's just return them. The frontend might re-sort or we can sort here.
	// Let's sort here for correctness.
	// We need "sort" package.
	// Adding sort logic is verbose in Go inline without slice.SortFunc (Go 1.21+).
	// Assuming Go 1.21+ available, or implementing Sort interface.
	// Let's create a helper or just insert carefully?
	// User lists are sorted. We can merge sorted lists efficiently, but just appending is "okay" if we don't care about strict interleaving.
	// However, having a pending tx from 1 minute ago appear AFTER a settled tx from 1 day ago is weird if we just append.
	// Let's append pending at top? No, pending could be old.
	// Let's just return as is (Ledger first) for now, OR do a quick sort if possible.
	// Actually, "sort" is not imported in original file.
	// I need to add "sort" to imports if I want to sort.
	// Let's stick to simple append for now. Ledger (Settled) is usually more important history.
	// Pending is usually VERY recent. So actually, putting Pending FIRST (at top of list) is often better UX for "Where is my deposit?".
	// Let's prepend Pending to Transactions.

	// Re-doing the slice construction to put Pending FIRST.
	finalTransactions := make([]TransactionDTO, 0, len(pending)+len(transactions))

	// Convert pending first
	for _, p := range pending {
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

		status := p.Status
		if status == "processing" {
			status = "pending"
		}

		finalTransactions = append(finalTransactions, TransactionDTO{
			ID:          p.ID.String(),
			Type:        p.Type,
			Amount:      displayAmount,
			Description: desc,
			Status:      status,
			CreatedAt:   p.CreatedAt,
		})
	}

	// Then add ledger (settled)
	finalTransactions = append(finalTransactions, transactions...)

	c.JSON(http.StatusOK, gin.H{
		"wallet": gin.H{
			"wallet_id":    wallet.ID,
			"balance":      wallet.Balance,
			"currency":     wallet.Currency,
			"transactions": finalTransactions,
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
