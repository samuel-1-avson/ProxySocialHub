package api

import (
	"fmt"
	"net/http"
	"os"

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
	var ledger []models.WalletLedgerEntry
	db.DB.Where("wallet_id = ?", wallet.ID).Order("created_at DESC").Limit(10).Find(&ledger)

	c.JSON(http.StatusOK, gin.H{
		"wallet": gin.H{
			"wallet_id":    wallet.ID,
			"balance":      wallet.Balance,
			"currency":     wallet.Currency,
			"transactions": ledger,
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
	var pendingTx models.PendingTransaction
	if result := db.DB.Where("reference = ?", reference).First(&pendingTx); result.Error != nil {
		logging.Error(result.Error).Str("reference", reference).Msg("Transaction reference not found in DB")

		// Attempt fallback/recovery?
		// If it's valid on Paystack but missing in DB, we could theoretically recover it if we trust the user context
		// But for now, returning 404 is "correct" for the system state
		c.JSON(http.StatusNotFound, gin.H{"error": "Transaction not found"})
		return
	}

	if pendingTx.Status == "completed" {
		c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Already processed"})
		return
	}

	// Update Transaction
	pendingTx.Status = "completed"
	pendingTx.ExternalRef = resp.Data.Reference // Already a string
	db.DB.Save(&pendingTx)

	// Credit Wallet
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
			ReferenceID:  reference,
			Description:  fmt.Sprintf("Paystack Deposit (%s)", resp.Data.Channel),
		}
		db.DB.Create(&ledgerEntry)
	}

	c.JSON(http.StatusOK, gin.H{"status": "success", "message": "Wallet credited"})
}

// Withdrawals would follow similar pattern (Transfer API) but skipping for MVP as per request focusing on "System" usage.
// Keeping existing withdrawal placeholder or removing if strict replacement.
// For now, removing old MoMo webhook and keep withdrawal as unused/placeholder calling error.

func initiateWithdrawal(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Withdrawals are temporarily disabled pending Paystack Transfer integration"})
}
