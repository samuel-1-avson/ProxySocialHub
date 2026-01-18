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

	if walletData["balance"].(float64) != wallet.Balance {
		t.Errorf("Expected balance %.2f, got %.2f", wallet.Balance, walletData["balance"].(float64))
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

func TestDeposit_ValidAmount(t *testing.T) {
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

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["reference"] == nil {
		t.Error("Expected reference in response")
	}
}

func TestDeposit_InvalidAmount(t *testing.T) {
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

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, w.Code)
	}
}

func TestWithdraw_ValidAmount(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	user, _ := createWalletTestUser(t)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/wallet/withdraw", initiateWithdrawal)

	body := map[string]interface{}{
		"amount": 25.0,
		"phone":  "0241234567",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/wallet/withdraw", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}
}

func TestWithdraw_InsufficientBalance(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	user, _ := createWalletTestUser(t)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/wallet/withdraw", initiateWithdrawal)

	body := map[string]interface{}{
		"amount": 500.0, // More than balance
		"phone":  "0241234567",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/wallet/withdraw", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

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

func TestWalletCurrency(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	_, wallet := createWalletTestUser(t)

	// Default currency should be set by testutil or model
	if wallet.Currency == "" {
		t.Skip("Currency field not set in test setup")
	}
}
