package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	solanaGo "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func withWithdrawSOLMocks(t *testing.T, hook func(context.Context, *solana.OracleClient, string, float64) (string, error)) {
	t.Helper()
	prevHook := sendSOLOnChainHook
	prevOracle := solana.GetOracleClient()
	sendSOLOnChainHook = hook
	solana.SetOracleClientForTest(&solana.OracleClient{})
	t.Cleanup(func() {
		sendSOLOnChainHook = prevHook
		solana.SetOracleClientForTest(prevOracle)
	})
}

func withP2POnChainMocks(t *testing.T, sendFn func(context.Context, *solana.OracleClient, solanaGo.PublicKey, uint64) (string, error)) {
	t.Helper()
	prevSync := testP2PSettleSynchronously
	prevHook := solana.SendSOLTestHook
	prevOracle := solana.GetOracleClient()
	testP2PSettleSynchronously = true
	solana.SendSOLTestHook = sendFn
	solana.SetOracleClientForTest(&solana.OracleClient{})
	t.Cleanup(func() {
		testP2PSettleSynchronously = prevSync
		solana.SendSOLTestHook = prevHook
		solana.SetOracleClientForTest(prevOracle)
	})
}

func linkSolanaWallet(t *testing.T, user *models.User, addr string) {
	t.Helper()
	user.WalletAddress = &addr
	if err := db.DB.Save(user).Error; err != nil {
		t.Fatalf("link wallet: %v", err)
	}
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatalf("load wallet: %v", err)
	}
	wallet.PrimaryWithdrawalAddress = &addr
	wallet.WithdrawalWhitelist = []string{}
	wallet.WithdrawalAddressChangedAt = nil
	if err := db.DB.Save(&wallet).Error; err != nil {
		t.Fatalf("save wallet withdrawal fields: %v", err)
	}
}

func TestTransferP2P_SameWallet(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "spending_records")

	shared := "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuGui4Q5G"
	sender, senderWallet := createWalletTestUser(t)
	recipient := testutil.CreateTestUser(t, testutil.UniqueEmail("wallet-recipient"), "buyer")
	linkSolanaWallet(t, &sender, shared)
	linkSolanaWallet(t, recipient, shared)

	senderWallet.BalanceSOL = 50.0
	senderWallet.LimitsEnabled = false
	db.DB.Save(&senderWallet)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(sender.ID.String(), "buyer"))
	r.POST("/wallet/transfer", transferP2P)

	body, _ := json.Marshal(map[string]interface{}{
		"recipient": recipient.Email,
		"amount":    1.0,
	})
	req := httptest.NewRequest(http.MethodPost, "/wallet/transfer", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body %s", w.Code, w.Body.String())
	}
}

func TestTransferP2P_ConcurrentTransfers(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "spending_records")

	sender, senderWallet := createWalletTestUser(t)
	recipientA := testutil.CreateTestUser(t, testutil.UniqueEmail("wallet-a"), "buyer")
	recipientB := testutil.CreateTestUser(t, testutil.UniqueEmail("wallet-b"), "buyer")

	senderWallet.BalanceSOL = 20.0
	senderWallet.LimitsEnabled = false
	db.DB.Save(&senderWallet)

	var wg sync.WaitGroup
	results := make(chan int, 2)
	post := func(recipientEmail string, amount float64) {
		defer wg.Done()
		r := setupTestRouter()
		r.Use(authMiddlewareMock(sender.ID.String(), "buyer"))
		r.POST("/wallet/transfer", transferP2P)
		body, _ := json.Marshal(map[string]interface{}{
			"recipient": recipientEmail,
			"amount":    amount,
		})
		req := httptest.NewRequest(http.MethodPost, "/wallet/transfer", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		results <- w.Code
	}

	wg.Add(2)
	go post(recipientA.Email, 3.0)
	go post(recipientB.Email, 4.0)
	wg.Wait()
	close(results)

	okCount := 0
	for code := range results {
		if code == http.StatusOK {
			okCount++
		}
	}
	if okCount != 2 {
		t.Fatalf("expected both concurrent transfers to succeed, got %d successes", okCount)
	}

	db.DB.Where("user_id = ?", sender.ID).First(&senderWallet)
	if senderWallet.BalanceSOL != 13.0 {
		t.Fatalf("expected sender balance 13.0 after 3+4 SOL transfers, got %.6f", senderWallet.BalanceSOL)
	}
}

func TestTransferP2P_OnChainFallback(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "spending_records")

	sharedSender := "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuGui4Q5G"
	recipientAddr := "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9wYt5WGy"

	sender, senderWallet := createWalletTestUser(t)
	recipient := testutil.CreateTestUser(t, testutil.UniqueEmail("wallet-onchain"), "buyer")
	linkSolanaWallet(t, &sender, sharedSender)
	linkSolanaWallet(t, recipient, recipientAddr)

	senderWallet.BalanceSOL = 10.0
	senderWallet.LimitsEnabled = false
	db.DB.Save(&senderWallet)

	withP2POnChainMocks(t, func(ctx context.Context, c *solana.OracleClient, recipient solanaGo.PublicKey, lamports uint64) (string, error) {
		return "", errors.New("simulated chain failure")
	})

	r := setupTestRouter()
	r.Use(authMiddlewareMock(sender.ID.String(), "buyer"))
	r.POST("/wallet/transfer", transferP2P)

	body, _ := json.Marshal(map[string]interface{}{
		"recipient": recipient.Email,
		"amount":    2.0,
	})
	req := httptest.NewRequest(http.MethodPost, "/wallet/transfer", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected transfer HTTP success before async refund, got %d body %s", w.Code, w.Body.String())
	}

	db.DB.Where("user_id = ?", sender.ID).First(&senderWallet)
	if senderWallet.BalanceSOL != 10.0 {
		t.Fatalf("expected sender balance restored to 10.0 after on-chain failure, got %.6f", senderWallet.BalanceSOL)
	}

	var refundLedger models.WalletLedgerEntry
	if err := db.DB.Where("wallet_id = ? AND type = ?", senderWallet.ID, "p2p_failed_refund").First(&refundLedger).Error; err != nil {
		t.Fatalf("expected p2p_failed_refund ledger entry: %v", err)
	}
}

func TestWithdrawSOL_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "spending_records")

	addr := "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuGui4Q5G"
	user, wallet := createWalletTestUser(t)
	linkSolanaWallet(t, &user, addr)
	wallet.BalanceSOL = 10.0
	wallet.LimitsEnabled = false
	db.DB.Save(&wallet)

	withWithdrawSOLMocks(t, func(ctx context.Context, o *solana.OracleClient, dest string, amount float64) (string, error) {
		return "mock_withdraw_tx", nil
	})

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/wallet/withdraw/sol", withdrawSOL)

	body, _ := json.Marshal(map[string]interface{}{"amount": 2.0})
	req := httptest.NewRequest(http.MethodPost, "/wallet/withdraw/sol", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body %s", w.Code, w.Body.String())
	}

	db.DB.Where("user_id = ?", user.ID).First(&wallet)
	if wallet.BalanceSOL != 8.0 {
		t.Fatalf("expected balance 8.0 after withdraw, got %.6f", wallet.BalanceSOL)
	}
}

func TestWithdrawSOL_OnChainFailureCompensates(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "spending_records")

	addr := "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuGui4Q5G"
	user, wallet := createWalletTestUser(t)
	linkSolanaWallet(t, &user, addr)
	wallet.BalanceSOL = 10.0
	wallet.LimitsEnabled = false
	db.DB.Save(&wallet)

	withWithdrawSOLMocks(t, func(ctx context.Context, o *solana.OracleClient, dest string, amount float64) (string, error) {
		return "", fmt.Errorf("simulated payout failure")
	})

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/wallet/withdraw/sol", withdrawSOL)

	body, _ := json.Marshal(map[string]interface{}{"amount": 2.0})
	req := httptest.NewRequest(http.MethodPost, "/wallet/withdraw/sol", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 with refund message, got %d body %s", w.Code, w.Body.String())
	}

	db.DB.Where("user_id = ?", user.ID).First(&wallet)
	if wallet.BalanceSOL != 10.0 {
		t.Fatalf("expected balance restored to 10.0, got %.6f", wallet.BalanceSOL)
	}

	var refund models.WalletLedgerEntry
	if err := db.DB.Where("wallet_id = ? AND type = ?", wallet.ID, "withdrawal_failed_refund").First(&refund).Error; err != nil {
		t.Fatalf("expected withdrawal_failed_refund ledger: %v", err)
	}
}

func TestWithdrawSOL_SpendingLimitExceeded(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "spending_records")

	addr := "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuGui4Q5G"
	user, wallet := createWalletTestUser(t)
	linkSolanaWallet(t, &user, addr)
	wallet.BalanceSOL = 100.0
	wallet.LimitsEnabled = true
	wallet.DailyLimit = 1.0
	db.DB.Save(&wallet)

	withWithdrawSOLMocks(t, func(ctx context.Context, o *solana.OracleClient, dest string, amount float64) (string, error) {
		return "should-not-run", nil
	})

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/wallet/withdraw/sol", withdrawSOL)

	body, _ := json.Marshal(map[string]interface{}{"amount": 5.0})
	req := httptest.NewRequest(http.MethodPost, "/wallet/withdraw/sol", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for spending limit, got %d body %s", w.Code, w.Body.String())
	}
}
