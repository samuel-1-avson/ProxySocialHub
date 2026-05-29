package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestVerifyCryptoDeposit_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "pending_transactions", "wallet_ledger_entries")

	// Set up environment / configs
	treasuryAddr := "TreasuryAddress111111111111111111111111111"
	senderAddr := "SenderAddress11111111111111111111111111111"
	os.Setenv("SOLANA_TREASURY_ADDRESS", treasuryAddr)

	user, _ := createWalletTestUser(t)
	// Update user's wallet address to the mock sender address
	user.WalletAddress = &senderAddr
	db.DB.Save(&user)

	// Mock the Solana RPC server
	mockRPC := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"jsonrpc": "2.0",
			"result": map[string]interface{}{
				"slot": 12345,
				"meta": map[string]interface{}{
					"err":          nil,
					"preBalances":  []uint64{10000000000, 0},
					"postBalances": []uint64{8900000000, 1000000000}, // Recipient got 1.0 SOL (1,000,000,000 lamports)
				},
				"transaction": map[string]interface{}{
					"message": map[string]interface{}{
						"accountKeys": []string{senderAddr, treasuryAddr},
					},
					"signatures": []string{"mock_sig"},
				},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer mockRPC.Close()

	// Override RPC endpoint to mock server URL
	solana.SetRPCEndpoint(mockRPC.URL)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/deposit/verify", verifyCryptoDeposit)

	payload := map[string]interface{}{
		"tx_hash": "mock_sig",
		"amount":  1.0,
		"chain":   "solana",
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest("POST", "/deposit/verify", bytes.NewBuffer(body))
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	// Verify balance credited in DB
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatalf("Wallet not found: %v", err)
	}
	if wallet.BalanceSOL != 1.0 {
		t.Errorf("Expected wallet balance to be 1.0, got %f", wallet.BalanceSOL)
	}

	// Verify ledger entry created
	var ledger models.WalletLedgerEntry
	if err := db.DB.Where("wallet_id = ?", wallet.ID).First(&ledger).Error; err != nil {
		t.Fatalf("Ledger entry not found: %v", err)
	}
	if ledger.Amount != 1.0 || ledger.Type != "deposit_auto" {
		t.Errorf("Expected ledger amount 1.0, type deposit_auto; got amount %f, type %s", ledger.Amount, ledger.Type)
	}
}

func TestVerifyCryptoDeposit_DoubleSpend(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "pending_transactions", "wallet_ledger_entries")

	user, _ := createWalletTestUser(t)
	txHash := "mock_sig_double_spend"

	// Create pre-existing transaction
	existingTx := models.PendingTransaction{
		ID:        uuid.New(),
		UserID:    user.ID,
		Reference: txHash,
		Type:      "crypto_deposit",
		Amount:    1.0,
		Currency:  "SOL",
		Status:    "completed",
	}
	db.DB.Create(&existingTx)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/deposit/verify", verifyCryptoDeposit)

	payload := map[string]interface{}{
		"tx_hash": txHash,
		"amount":  1.0,
		"chain":   "solana",
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest("POST", "/deposit/verify", bytes.NewBuffer(body))
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusConflict {
		t.Errorf("Expected status %d (Conflict) for double-spend, got %d. Body: %s", http.StatusConflict, w.Code, w.Body.String())
	}
}

func TestVerifyCryptoDeposit_SenderMismatch(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "pending_transactions", "wallet_ledger_entries")

	treasuryAddr := "TreasuryAddress111111111111111111111111111"
	senderAddr := "SenderAddress11111111111111111111111111111"
	differentAddr := "DifferentAddress1111111111111111111111111"
	os.Setenv("SOLANA_TREASURY_ADDRESS", treasuryAddr)

	user, _ := createWalletTestUser(t)
	// User linked wallet is differentAddr
	user.WalletAddress = &differentAddr
	db.DB.Save(&user)

	// Mock the Solana RPC server (transaction came from senderAddr, not differentAddr)
	mockRPC := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"jsonrpc": "2.0",
			"result": map[string]interface{}{
				"slot": 12345,
				"meta": map[string]interface{}{
					"err":          nil,
					"preBalances":  []uint64{10000000000, 0},
					"postBalances": []uint64{8900000000, 1000000000},
				},
				"transaction": map[string]interface{}{
					"message": map[string]interface{}{
						"accountKeys": []string{senderAddr, treasuryAddr},
					},
					"signatures": []string{"mock_sig_mismatch"},
				},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer mockRPC.Close()

	solana.SetRPCEndpoint(mockRPC.URL)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/deposit/verify", verifyCryptoDeposit)

	payload := map[string]interface{}{
		"tx_hash": "mock_sig_mismatch",
		"amount":  1.0,
		"chain":   "solana",
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest("POST", "/deposit/verify", bytes.NewBuffer(body))
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("Expected status %d (Forbidden) for sender mismatch, got %d. Body: %s", http.StatusForbidden, w.Code, w.Body.String())
	}
}
