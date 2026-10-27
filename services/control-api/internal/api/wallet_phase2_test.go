package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	solanaGo "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func withWithdrawSOLMocks(t *testing.T, hook func(context.Context, *solana.OracleClient, string, float64) (string, error)) {
	t.Helper()
	// W-13: pre-P1 withdraw tests exercise queue mechanics, not signature
	// auth; lift the dust threshold (P1 challenge tests reset it).
	t.Setenv("WITHDRAW_SIGNATURE_THRESHOLD_LAMPORTS", "100000000000000")
	prevHook := sendSOLOnChainHook
	prevConfirm := confirmWithdrawTxHook
	prevOracle := solana.GetOracleClient()
	sendSOLOnChainHook = hook
	// P0-3: withdrawals confirm on-chain before reporting success; the mock
	// environment confirms instantly (individual tests override).
	confirmWithdrawTxHook = func(ctx context.Context, oracle *solana.OracleClient, txHash string) solana.TxConfirmState {
		return solana.TxConfirmed
	}
	solana.SetOracleClientForTest(&solana.OracleClient{})
	t.Cleanup(func() {
		sendSOLOnChainHook = prevHook
		confirmWithdrawTxHook = prevConfirm
		solana.SetOracleClientForTest(prevOracle)
	})
}

// withSendSOLRecorder replaces the treasury SendSOL path and counts calls, so tests
// can assert that a flow does (or does not) move real SOL.
func withSendSOLRecorder(t *testing.T) *atomic.Int32 {
	t.Helper()
	var calls atomic.Int32
	prevHook := solana.SendSOLTestHook
	prevOracle := solana.GetOracleClient()
	solana.SendSOLTestHook = func(ctx context.Context, c *solana.OracleClient, recipient solanaGo.PublicKey, lamports uint64) (string, error) {
		calls.Add(1)
		return "mock_tx", nil
	}
	solana.SetOracleClientForTest(&solana.OracleClient{})
	t.Cleanup(func() {
		solana.SendSOLTestHook = prevHook
		solana.SetOracleClientForTest(prevOracle)
	})
	return &calls
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

// BE-CRIT-01: an internal P2P transfer between two users with linked Solana wallets
// is a ledger-only move. It must not send SOL from the treasury, otherwise the
// recipient is paid twice (ledger credit plus an on-chain transfer).
func TestTransferP2P_LinkedWalletsDoNotSendOnChain(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "compensation_outbox", "users", "wallets", "wallet_ledger_entries", "spending_records")

	sharedSender := "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuGui4Q5G"
	recipientAddr := "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9wYt5WGy"

	sender, senderWallet := createWalletTestUser(t)
	recipient := testutil.CreateTestUser(t, testutil.UniqueEmail("wallet-onchain"), "buyer")
	linkSolanaWallet(t, &sender, sharedSender)
	linkSolanaWallet(t, recipient, recipientAddr)

	senderWallet.BalanceSOL = 10.0
	senderWallet.LimitsEnabled = false
	db.DB.Save(&senderWallet)

	sends := withSendSOLRecorder(t)

	var recipientBefore models.Wallet
	if err := db.DB.Where("user_id = ?", recipient.ID).First(&recipientBefore).Error; err != nil {
		t.Fatalf("load recipient wallet: %v", err)
	}

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
		t.Fatalf("expected 200, got %d body %s", w.Code, w.Body.String())
	}

	var recipientWallet models.Wallet
	db.DB.Where("user_id = ?", sender.ID).First(&senderWallet)
	db.DB.Where("user_id = ?", recipient.ID).First(&recipientWallet)
	if senderWallet.BalanceSOL != 8.0 {
		t.Fatalf("expected sender balance 8.0, got %.6f", senderWallet.BalanceSOL)
	}
	if got := recipientWallet.BalanceSOL - recipientBefore.BalanceSOL; got < 1.999999 || got > 2.000001 {
		t.Fatalf("expected recipient credited exactly once (+2.0), got %+.6f (before %.6f, after %.6f)",
			got, recipientBefore.BalanceSOL, recipientWallet.BalanceSOL)
	}

	var queued int64
	db.DB.Model(&models.CompensationOutbox{}).Where("kind = ?", models.CompensationKindP2PSettle).Count(&queued)
	if queued != 0 {
		t.Fatalf("expected no p2p_settle outbox rows, got %d", queued)
	}
	// Draining the outbox must not send anything either.
	ProcessCompensationOutboxOnce(50)
	if n := sends.Load(); n != 0 {
		t.Fatalf("expected zero on-chain SOL sends for an internal transfer, got %d", n)
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

	// W-33: failed withdrawal keeps its spending record plus a
	// compensating reversal (net zero), never a DELETE.
	var spendingCount int64
	db.DB.Model(&models.SpendingRecord{}).Where("wallet_id = ? AND type = ?", wallet.ID, models.SpendingWithdraw).Count(&spendingCount)
	if spendingCount != 2 {
		t.Fatalf("expected original + reversal spending records, got %d", spendingCount)
	}
	var netSpend float64
	db.DB.Model(&models.SpendingRecord{}).
		Where("wallet_id = ? AND type = ?", wallet.ID, models.SpendingWithdraw).
		Select("COALESCE(SUM(amount),0)").Scan(&netSpend)
	if netSpend != 0 {
		t.Fatalf("withdraw spending must net to zero after reversal, got %v", netSpend)
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

	// withdrawSOL answers a SpendingLimitError with 403 and the limit details (wallet.go),
	// as it has since the limits were added.
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), `"limit_type":"daily"`) {
		t.Fatalf("expected 403 with the daily limit for a spending-limit refusal, got %d body %s", w.Code, w.Body.String())
	}
}
