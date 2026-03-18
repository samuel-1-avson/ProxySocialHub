package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
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

func TestDeposit_FiatDisabled(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries")

	user, _ := createWalletTestUser(t)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/wallet/deposit", initiateDeposit)

	body := map[string]interface{}{
		"amount": 50.0,
		"phone":  "0241234567",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/wallet/deposit", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	// SOL-only: Fiat deposits return 403 Forbidden
	if w.Code != http.StatusForbidden {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusForbidden, w.Code, w.Body.String())
	}
}

func TestDeposit_InvalidAmount_ReturnsForbidden(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	user, _ := createWalletTestUser(t)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/wallet/deposit", initiateDeposit)

	body := map[string]interface{}{
		"amount": -10.0, // Invalid
		"phone":  "0241234567",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/wallet/deposit", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	// SOL-only: All fiat deposits return 403 Forbidden regardless of amount
	if w.Code != http.StatusForbidden {
		t.Errorf("Expected status %d, got %d", http.StatusForbidden, w.Code)
	}
}

func TestWithdraw_FiatDisabled(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	user, _ := createWalletTestUser(t)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/wallet/withdraw", initiateWithdrawal)

	body := map[string]interface{}{
		"amount": 25.0,
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/wallet/withdraw", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	// SOL-only: Fiat withdrawals return 400 Bad Request with instructions to use SOL
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusBadRequest, w.Code, w.Body.String())
	}
}

func TestWithdraw_InsufficientBalance_ReturnsBadRequest(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	user, _ := createWalletTestUser(t)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/wallet/withdraw", initiateWithdrawal)

	body := map[string]interface{}{
		"amount": 500.0, // More than balance
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/wallet/withdraw", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	// SOL-only: All fiat withdrawals return 400 with instructions to use /withdraw/sol
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, w.Code)
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
	if wallet.BalanceSOL != 0 {
		t.Logf("Wallet initialized with SOL balance: %.2f", wallet.BalanceSOL)
	}
}
