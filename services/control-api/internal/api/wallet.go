package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/payments"
)

func RegisterWalletRoutes(r *gin.RouterGroup) {
	wallet := r.Group("/wallet")
	{
		wallet.GET("/", getWallet)
		wallet.POST("/deposit", initiateDeposit)
		wallet.POST("/withdraw", initiateWithdrawal)
		wallet.POST("/webhook/momo", handleMoMoWebhook)
	}
}

func getWallet(c *gin.Context) {
	// Get user ID from JWT token
	userID := c.GetString("userID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var wallet models.Wallet
	result := db.DB.Where("user_id = ?", userID).First(&wallet)
	if result.Error != nil {
		// Create wallet if doesn't exist
		wallet = models.Wallet{
			UserID:   uuid.MustParse(userID),
			Balance:  0,
			Currency: "GHS",
		}
		db.DB.Create(&wallet)
	}

	// Get recent transactions
	var ledger []models.WalletLedgerEntry
	db.DB.Where("wallet_id = ?", wallet.ID).Order("created_at DESC").Limit(10).Find(&ledger)

	c.JSON(http.StatusOK, gin.H{
		"wallet_id":    wallet.ID,
		"balance":      wallet.Balance,
		"currency":     wallet.Currency,
		"transactions": ledger,
	})
}

type depositRequest struct {
	Amount float64 `json:"amount" binding:"required,gt=0"`
	Phone  string  `json:"phone" binding:"required"`
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

	// Detect MoMo provider from phone number
	provider := payments.DetectProvider(req.Phone)

	// Create MoMo client
	client, err := payments.NewMoMoClient(provider)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Payment provider unavailable"})
		return
	}

	// Generate reference ID
	reference := uuid.New().String()

	// Initiate collection
	paymentReq := payments.PaymentRequest{
		Amount:      req.Amount,
		Currency:    "GHS",
		Phone:       req.Phone,
		Reference:   reference,
		Description: "ProxyHub wallet deposit",
	}

	resp, err := client.RequestPayment(paymentReq)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Store pending transaction in DB for webhook reconciliation
	pendingTx := models.PendingTransaction{
		Reference: reference,
		UserID:    userID,
		Type:      "deposit",
		Amount:    req.Amount,
		Currency:  "GHS",
		Provider:  string(provider),
		Phone:     req.Phone,
		Status:    "pending",
	}
	db.DB.Create(&pendingTx)

	c.JSON(http.StatusOK, gin.H{
		"status":       resp.Status,
		"reference":    reference,
		"message":      resp.Message,
		"provider":     provider,
		"amount":       req.Amount,
		"instructions": "Please approve the payment prompt on your phone",
	})
}

type withdrawRequest struct {
	Amount   float64 `json:"amount" binding:"required,gt=0"`
	Phone    string  `json:"phone" binding:"required"`
	TOTPCode string  `json:"totp_code"` // Required if 2FA is enabled
}

func initiateWithdrawal(c *gin.Context) {
	var req withdrawRequest
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

	// Get user to check 2FA status
	var user models.User
	if result := db.DB.First(&user, "id = ?", userID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Require 2FA verification for withdrawals if 2FA is enabled
	if user.TOTPEnabled {
		if req.TOTPCode == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":        "2FA code required for withdrawals",
				"code":         "2fa_required",
				"requires_2fa": true,
			})
			return
		}

		// Verify the TOTP code
		if user.TOTPSecret == nil || !verifyTOTPCode(*user.TOTPSecret, req.TOTPCode) {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid 2FA code",
				"code":  "invalid_2fa",
			})
			return
		}
	}

	// Get wallet and check balance
	var wallet models.Wallet
	if result := db.DB.Where("user_id = ?", userID).First(&wallet); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Wallet not found"})
		return
	}

	// Minimum withdrawal (e.g., 5 GHS)
	if req.Amount < 5 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Minimum withdrawal is 5 GHS"})
		return
	}

	// Check sufficient balance
	if wallet.Balance < req.Amount {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Insufficient balance"})
		return
	}

	// Detect provider and create client
	provider := payments.DetectProvider(req.Phone)
	client, err := payments.NewMoMoClient(provider)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Payment provider unavailable"})
		return
	}

	// Generate reference
	reference := uuid.New().String()

	// Initiate disbursement
	disbursementReq := payments.DisbursementRequest{
		Amount:      req.Amount,
		Currency:    "GHS",
		Phone:       req.Phone,
		Reference:   reference,
		Description: "ProxyHub wallet withdrawal",
	}

	resp, err := client.Disburse(disbursementReq)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Deduct from wallet immediately (will refund if disbursement fails)
	db.DB.Model(&wallet).Update("balance", wallet.Balance-req.Amount)

	// Create ledger entry
	ledgerEntry := models.WalletLedgerEntry{
		WalletID:     wallet.ID,
		Amount:       -req.Amount,
		BalanceAfter: wallet.Balance - req.Amount,
		Type:         models.TransactionPayout,
		ReferenceID:  reference,
		Description:  "Withdrawal to " + req.Phone,
	}
	db.DB.Create(&ledgerEntry)

	// Store pending transaction
	pendingTx := models.PendingTransaction{
		Reference: reference,
		UserID:    userID,
		Type:      "withdrawal",
		Amount:    req.Amount,
		Currency:  "GHS",
		Provider:  string(provider),
		Phone:     req.Phone,
		Status:    "pending",
	}
	db.DB.Create(&pendingTx)

	c.JSON(http.StatusOK, gin.H{
		"status":      resp.Status,
		"reference":   reference,
		"message":     resp.Message,
		"amount":      req.Amount,
		"new_balance": wallet.Balance - req.Amount,
	})
}

// MoMo webhook callback
type momoWebhookPayload struct {
	Reference     string `json:"externalId"`
	TransactionID string `json:"financialTransactionId"`
	Status        string `json:"status"`
	Reason        string `json:"reason"`
}

func handleMoMoWebhook(c *gin.Context) {
	var payload momoWebhookPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Find pending transaction
	var pendingTx models.PendingTransaction
	if result := db.DB.Where("reference = ?", payload.Reference).First(&pendingTx); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Transaction not found"})
		return
	}

	// Already processed
	if pendingTx.Status != "pending" {
		c.JSON(http.StatusOK, gin.H{"status": "already_processed"})
		return
	}

	// Update transaction status
	if payload.Status == "SUCCESSFUL" {
		pendingTx.Status = "completed"
		pendingTx.ExternalRef = payload.TransactionID
		db.DB.Save(&pendingTx)

		// If deposit, credit wallet
		if pendingTx.Type == "deposit" {
			var wallet models.Wallet
			if result := db.DB.Where("user_id = ?", pendingTx.UserID).First(&wallet); result.Error == nil {
				newBalance := wallet.Balance + pendingTx.Amount
				db.DB.Model(&wallet).Update("balance", newBalance)

				// Create ledger entry
				ledgerEntry := models.WalletLedgerEntry{
					WalletID:     wallet.ID,
					Amount:       pendingTx.Amount,
					BalanceAfter: newBalance,
					Type:         models.TransactionTopup,
					ReferenceID:  pendingTx.Reference,
					Description:  "MoMo deposit from " + pendingTx.Phone,
				}
				db.DB.Create(&ledgerEntry)
			}
		}
	} else {
		pendingTx.Status = "failed"
		pendingTx.FailureReason = payload.Reason
		db.DB.Save(&pendingTx)

		// If withdrawal failed, refund the wallet
		if pendingTx.Type == "withdrawal" {
			var wallet models.Wallet
			if result := db.DB.Where("user_id = ?", pendingTx.UserID).First(&wallet); result.Error == nil {
				newBalance := wallet.Balance + pendingTx.Amount
				db.DB.Model(&wallet).Update("balance", newBalance)

				// Create refund ledger entry
				ledgerEntry := models.WalletLedgerEntry{
					WalletID:     wallet.ID,
					Amount:       pendingTx.Amount,
					BalanceAfter: newBalance,
					Type:         models.TransactionRefund,
					ReferenceID:  pendingTx.Reference,
					Description:  "Failed withdrawal refund",
				}
				db.DB.Create(&ledgerEntry)
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"status": "processed"})
}

// verifyTOTPCode verifies a TOTP code - wrapper for the function in tofa.go
func verifyTOTPCode(secret, code string) bool {
	return verifyTOTP(secret, code)
}
