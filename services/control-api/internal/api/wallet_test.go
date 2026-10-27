package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func authMiddlewareMock(userID string, role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Set user_id as UUID object (used by some handlers)
		if uid, err := uuid.Parse(userID); err == nil {
			c.Set("user_id", uid)
		} else {
			// If not a valid UUID, set as string (fallback)
			c.Set("user_id", userID)
		}
		// Set userID as string (used by session.go)
		c.Set("userID", userID)

		c.Set("role", role)
		c.Set("userRole", role) // the key the real auth middleware sets (middleware/supabase.go)
		c.Next()
	}
}

func createWalletTestUser(t *testing.T) (models.User, models.Wallet) {
	t.Helper()
	email := testutil.UniqueEmail("wallet")
	user := testutil.CreateTestUser(t, email, "buyer")

	// Get the wallet that was created with the user
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatalf("Failed to find wallet: %v", err)
	}

	return *user, wallet
}

func TestGetWallet(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries")

	user, wallet := createWalletTestUser(t)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.GET("/wallet", getWallet)

	req := httptest.NewRequest("GET", "/wallet", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	walletData, ok := response["wallet"].(map[string]interface{})
	if !ok {
		t.Fatal("Expected wallet in response")
	}

	if walletData["balance_sol"] == nil {
		t.Fatal("Expected balance_sol in response")
	}

	if walletData["balance_sol"].(float64) != wallet.BalanceSOL {
		t.Errorf("Expected balance %.2f, got %.2f", wallet.BalanceSOL, walletData["balance_sol"].(float64))
	}
}

func TestGetWallet_NotFound(t *testing.T) {
	testutil.SetupTestDB(t)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(uuid.NewString(), "buyer"))
	r.GET("/wallet", getWallet)

	req := httptest.NewRequest("GET", "/wallet", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("Expected status %d, got %d", http.StatusNotFound, w.Code)
	}
}

// P2-E: the fiat handlers were deleted as dead code (never routed in
// production). The contract now: no fiat deposit/withdraw routes exist
// on the wallet router at all.
func TestFiatRoutesAbsent_P2(t *testing.T) {
	testutil.SetupTestDB(t)
	user, _ := createWalletTestUser(t)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	RegisterWalletRoutes(r.Group("/v1"))

	for _, path := range []string{"/v1/wallet/deposit", "/v1/wallet/withdraw", "/v1/wallet/deposit/verify"} {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString("{}"))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound {
			t.Errorf("%s: want 404 (fiat removed), got %d body %s", path, w.Code, w.Body.String())
		}
	}
}


func TestWalletLedgerEntry(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries")

	_, wallet := createWalletTestUser(t)

	// Create ledger entries
	entries := []models.WalletLedgerEntry{
		{WalletID: wallet.ID, Type: "deposit", Amount: 50.0, Description: "Test deposit"},
		{WalletID: wallet.ID, Type: "usage", Amount: -10.0, Description: "Session usage"},
	}

	for _, entry := range entries {
		if err := db.DB.Create(&entry).Error; err != nil {
			t.Fatalf("Failed to create ledger entry: %v", err)
		}
	}

	// Query ledger
	var ledgerEntries []models.WalletLedgerEntry
	db.DB.Where("wallet_id = ?", wallet.ID).Find(&ledgerEntries)

	if len(ledgerEntries) != 2 {
		t.Errorf("Expected 2 ledger entries, got %d", len(ledgerEntries))
	}
}

func TestWallet_SOLOnly(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	_, wallet := createWalletTestUser(t)

	// In SOL-only system, only BalanceSOL should be relevant
	// Currency field is no longer used
	if wallet.BalanceSOL != 10.0 {
		t.Logf("Wallet initialized with SOL balance: %.2f", wallet.BalanceSOL)
	}
}

// ==================== P2P TRANSFER TESTS ====================

func TestTransferP2P_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "spending_records")

	sender, senderWallet := createWalletTestUser(t)
	recipient := testutil.CreateTestUser(t, testutil.UniqueEmail("recipient"), "buyer")

	// Seed sender with enough balance
	senderWallet.BalanceSOL = 100.0
	db.DB.Save(&senderWallet)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(sender.ID.String(), "buyer"))
	r.POST("/wallet/transfer", transferP2P)

	body := map[string]interface{}{
		"recipient": recipient.Email,
		"amount":    10.0,
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/wallet/transfer", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	// Verify sender balance decreased
	var updatedSenderWallet models.Wallet
	db.DB.Where("user_id = ?", sender.ID).First(&updatedSenderWallet)
	if updatedSenderWallet.BalanceSOL != 90.0 {
		t.Errorf("Expected sender balance 90.0, got %.2f", updatedSenderWallet.BalanceSOL)
	}

	// Verify recipient balance increased
	var updatedRecipientWallet models.Wallet
	db.DB.Where("user_id = ?", recipient.ID).First(&updatedRecipientWallet)
	if updatedRecipientWallet.BalanceSOL != 20.0 { // 10 initial + 10 received
		t.Errorf("Expected recipient balance 20.0, got %.2f", updatedRecipientWallet.BalanceSOL)
	}

	// Verify ledger entries created
	var ledgerCount int64
	db.DB.Model(&models.WalletLedgerEntry{}).Where("reference_id != ?", "").Count(&ledgerCount)
	if ledgerCount < 2 {
		t.Errorf("Expected at least 2 ledger entries, got %d", ledgerCount)
	}
}

func TestTransferP2P_InsufficientBalance(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries")

	sender, senderWallet := createWalletTestUser(t)
	recipient := testutil.CreateTestUser(t, testutil.UniqueEmail("recipient"), "buyer")

	// Set sender balance low
	senderWallet.BalanceSOL = 5.0
	db.DB.Save(&senderWallet)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(sender.ID.String(), "buyer"))
	r.POST("/wallet/transfer", transferP2P)

	body := map[string]interface{}{
		"recipient": recipient.Email,
		"amount":    10.0,
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/wallet/transfer", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusBadRequest, w.Code, w.Body.String())
	}
}

func TestTransferP2P_SelfTransfer(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries")

	sender, _ := createWalletTestUser(t)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(sender.ID.String(), "buyer"))
	r.POST("/wallet/transfer", transferP2P)

	body := map[string]interface{}{
		"recipient": sender.Email,
		"amount":    5.0,
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/wallet/transfer", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusBadRequest, w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["error"] != "Cannot transfer to yourself" {
		t.Errorf("Expected self-transfer error, got: %v", resp["error"])
	}
}

func TestTransferP2P_MaxAmountExceeded(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries")

	sender, senderWallet := createWalletTestUser(t)
	recipient := testutil.CreateTestUser(t, testutil.UniqueEmail("recipient"), "buyer")

	// Give sender huge balance
	senderWallet.BalanceSOL = 50000.0
	db.DB.Save(&senderWallet)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(sender.ID.String(), "buyer"))
	r.POST("/wallet/transfer", transferP2P)

	body := map[string]interface{}{
		"recipient": recipient.Email,
		"amount":    50000.0, // Exceeds maxTransferSOL = 10000
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/wallet/transfer", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusBadRequest, w.Code, w.Body.String())
	}
}

func TestTransferP2P_LedgerEntriesCreated(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries")

	sender, senderWallet := createWalletTestUser(t)
	recipient := testutil.CreateTestUser(t, testutil.UniqueEmail("recipient"), "buyer")

	senderWallet.BalanceSOL = 50.0
	db.DB.Save(&senderWallet)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(sender.ID.String(), "buyer"))
	r.POST("/wallet/transfer", transferP2P)

	body := map[string]interface{}{
		"recipient": recipient.Email,
		"amount":    5.0,
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/wallet/transfer", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	// Verify sender ledger
	var senderLedger models.WalletLedgerEntry
	if err := db.DB.Where("wallet_id = ? AND type = ?", senderWallet.ID, "p2p_sent").First(&senderLedger).Error; err != nil {
		t.Errorf("Sender ledger entry not found: %v", err)
	}
	if senderLedger.Amount != -5.0 {
		t.Errorf("Expected sender ledger amount -5.0, got %.2f", senderLedger.Amount)
	}

	// Verify recipient ledger
	var recipientWallet models.Wallet
	db.DB.Where("user_id = ?", recipient.ID).First(&recipientWallet)

	var recipientLedger models.WalletLedgerEntry
	if err := db.DB.Where("wallet_id = ? AND type = ?", recipientWallet.ID, "p2p_received").First(&recipientLedger).Error; err != nil {
		t.Errorf("Recipient ledger entry not found: %v", err)
	}
	if recipientLedger.Amount != 5.0 {
		t.Errorf("Expected recipient ledger amount 5.0, got %.2f", recipientLedger.Amount)
	}
}

// ==================== WITHDRAWAL TESTS ====================

func TestWithdrawSOL_InsufficientBalance(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries")

	user, wallet := createWalletTestUser(t)
	wallet.BalanceSOL = 1.0
	db.DB.Save(&wallet)

	walletAddr := "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH"
	user.WalletAddress = &walletAddr
	db.DB.Save(&user)
	wallet.PrimaryWithdrawalAddress = &walletAddr
	db.DB.Save(&wallet)

	withWithdrawSOLMocks(t, func(ctx context.Context, o *solana.OracleClient, dest string, amount float64) (string, error) {
		return "unused", nil
	})

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/wallet/withdraw/sol", withdrawSOL)

	body := map[string]interface{}{
		"amount": 5.0, // More than balance
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/wallet/withdraw/sol", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	// Should fail with bad request (insufficient balance)
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusBadRequest, w.Code, w.Body.String())
	}
}

func TestWithdrawSOL_NoLinkedWallet(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries")

	user, wallet := createWalletTestUser(t)
	wallet.BalanceSOL = 50.0
	db.DB.Save(&wallet)
	// No wallet_address linked

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/wallet/withdraw/sol", withdrawSOL)

	body := map[string]interface{}{
		"amount": 5.0,
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/wallet/withdraw/sol", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusBadRequest, w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["error"] != "No linked Solana wallet" {
		t.Errorf("Expected 'No linked Solana wallet' error, got: %v", resp["error"])
	}
}

func TestWithdrawSOL_InvalidAmount(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	user, _ := createWalletTestUser(t)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/wallet/withdraw/sol", withdrawSOL)

	body := map[string]interface{}{
		"amount": -5.0,
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/wallet/withdraw/sol", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusBadRequest, w.Code, w.Body.String())
	}
}

func TestWithdrawSOL_MaxAmountExceeded(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	user, wallet := createWalletTestUser(t)
	wallet.BalanceSOL = 50000.0
	db.DB.Save(&wallet)

	walletAddr := "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH"
	user.WalletAddress = &walletAddr
	db.DB.Save(&user)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/wallet/withdraw/sol", withdrawSOL)

	body := map[string]interface{}{
		"amount": 50000.0, // Exceeds max
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/wallet/withdraw/sol", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusBadRequest, w.Code, w.Body.String())
	}
}

// ==================== SPENDING LIMIT TESTS ====================

func TestSpendingLimit_WithinLimit(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "spending_records")

	_, wallet := createWalletTestUser(t)
	wallet.LimitsEnabled = true
	wallet.DailyLimit = 10.0
	wallet.WeeklyLimit = 50.0
	wallet.MonthlyLimit = 100.0
	db.DB.Save(&wallet)

	err := wallet.CheckSpendingLimit(db.DB, 5.0, models.SpendingTransfer)
	if err != nil {
		t.Errorf("Expected no error for spending within limit, got: %v", err)
	}
}

func TestSpendingLimit_ExceedsDaily(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "spending_records")

	_, wallet := createWalletTestUser(t)
	wallet.LimitsEnabled = true
	wallet.DailyLimit = 5.0
	db.DB.Save(&wallet)

	// Record existing spending
	wallet.RecordSpending(db.DB, 3.0, models.SpendingTransfer, "test-tx-1")

	err := wallet.CheckSpendingLimit(db.DB, 3.0, models.SpendingTransfer)
	if err == nil {
		t.Error("Expected spending limit error, got nil")
	} else {
		spendingErr, ok := err.(*models.SpendingLimitError)
		if !ok {
			t.Errorf("Expected SpendingLimitError, got %T", err)
		} else if spendingErr.LimitType != "daily" {
			t.Errorf("Expected daily limit error, got: %s", spendingErr.LimitType)
		}
	}
}

func TestSpendingLimit_Disabled(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	_, wallet := createWalletTestUser(t)
	wallet.LimitsEnabled = false
	wallet.DailyLimit = 1.0
	db.DB.Save(&wallet)

	// Should allow any amount when limits are disabled
	err := wallet.CheckSpendingLimit(db.DB, 1000.0, models.SpendingTransfer)
	if err != nil {
		t.Errorf("Expected no error when limits disabled, got: %v", err)
	}
}

func TestSpendingLimit_ExceedsWeekly(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "spending_records")

	user, wallet := createWalletTestUser(t)
	// P0-5: every window must be configured and spend-time tier ceilings
	// apply; use premium ceilings so the weekly window is what trips.
	user.TrustTier = models.TrustTierPremium
	db.DB.Save(&user)
	wallet.LimitsEnabled = true
	wallet.DailyLimit = 100.0
	wallet.WeeklyLimit = 10.0
	wallet.MonthlyLimit = 2000.0
	db.DB.Save(&wallet)

	// Record existing spending
	wallet.RecordSpending(db.DB, 8.0, models.SpendingTransfer, "test-tx-1")

	err := wallet.CheckSpendingLimit(db.DB, 5.0, models.SpendingTransfer)
	if err == nil {
		t.Error("Expected spending limit error, got nil")
	} else {
		spendingErr, ok := err.(*models.SpendingLimitError)
		if !ok {
			t.Errorf("Expected SpendingLimitError, got %T", err)
		} else if spendingErr.LimitType != "weekly" {
			t.Errorf("Expected weekly limit error, got: %s", spendingErr.LimitType)
		}
	}
}

// ==================== P2P TRANSFER WITH SPENDING LIMITS ====================

func TestTransferP2P_SpendingLimitExceeded(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "spending_records")

	sender, senderWallet := createWalletTestUser(t)
	recipient := testutil.CreateTestUser(t, testutil.UniqueEmail("recipient"), "buyer")

	// Enable spending limits
	senderWallet.LimitsEnabled = true
	senderWallet.DailyLimit = 2.0
	senderWallet.BalanceSOL = 100.0
	db.DB.Save(&senderWallet)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(sender.ID.String(), "buyer"))
	r.POST("/wallet/transfer", transferP2P)

	body := map[string]interface{}{
		"recipient": recipient.Email,
		"amount":    5.0, // Exceeds daily limit of 2.0
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/wallet/transfer", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusForbidden, w.Code, w.Body.String())
	}
}

// ==================== KYC STATUS AUTHORIZATION TESTS ====================

func TestGetKYCStatus_SelfAccess(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users")

	user, _ := createWalletTestUser(t)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.GET("/kyc/status/:user_id", getKYCStatus)

	req := httptest.NewRequest("GET", "/kyc/status/"+user.ID.String(), nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}
}

func TestGetKYCStatus_OtherUserForbidden(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users")

	user1, _ := createWalletTestUser(t)
	user2, _ := createWalletTestUser(t)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user1.ID.String(), "buyer"))
	r.GET("/kyc/status/:user_id", getKYCStatus)

	req := httptest.NewRequest("GET", "/kyc/status/"+user2.ID.String(), nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusForbidden, w.Code, w.Body.String())
	}
}

func TestGetKYCStatus_AdminCanAccessAny(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users")

	admin := testutil.CreateTestUser(t, testutil.UniqueEmail("admin"), "admin")
	user, _ := createWalletTestUser(t)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(admin.ID.String(), "admin"))
	r.GET("/kyc/status/:user_id", getKYCStatus)

	req := httptest.NewRequest("GET", "/kyc/status/"+user.ID.String(), nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}
}

