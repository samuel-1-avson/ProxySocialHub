package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/testutil"
)

const p0WithdrawAddr = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuGui4Q5G"

func seedWithdrawUser(t *testing.T, balance float64) (models.User, models.Wallet) {
	t.Helper()
	user, wallet := createWalletTestUser(t)
	linkSolanaWallet(t, &user, p0WithdrawAddr)
	wallet.BalanceSOL = balance
	wallet.LimitsEnabled = false
	if err := db.DB.Save(&wallet).Error; err != nil {
		t.Fatalf("seed wallet: %v", err)
	}
	return user, wallet
}

func postWithdraw(t *testing.T, userID uuid.UUID, body map[string]interface{}, idemKey string) *httptest.ResponseRecorder {
	t.Helper()
	r := setupTestRouter()
	r.Use(authMiddlewareMock(userID.String(), "buyer"))
	r.POST("/wallet/withdraw/sol", withdrawSOL)
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/wallet/withdraw/sol", bytes.NewBuffer(raw))
	req.Header.Set("Content-Type", "application/json")
	if idemKey != "" {
		req.Header.Set("Idempotency-Key", idemKey)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func cleanupWithdrawP0(t *testing.T) {
	t.Helper()
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "spending_records", "withdrawal_payout_queue", "idempotency_records", "ledger_journals", "ledger_journal_lines")
}

// W-03 regression: a confirmed withdrawal leaves a durable payout row in
// completed state carrying the on-chain tx hash.
func TestWithdrawSOL_P0_DurableRowCompletedWithTxHash(t *testing.T) {
	testutil.SetupTestDB(t)
	cleanupWithdrawP0(t)
	user, _ := seedWithdrawUser(t, 10.0)
	withWithdrawSOLMocks(t, func(ctx context.Context, o *solana.OracleClient, dest string, amount float64) (string, error) {
		return "mock_withdraw_tx", nil
	})

	w := postWithdraw(t, user.ID, map[string]interface{}{"amount": 2.0}, "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body %s", w.Code, w.Body.String())
	}

	var row models.WithdrawalPayout
	if err := db.DB.Where("user_id = ?", user.ID).First(&row).Error; err != nil {
		t.Fatalf("durable payout row missing: %v", err)
	}
	if row.Status != models.WithdrawalPayoutCompleted {
		t.Fatalf("want status completed, got %q", row.Status)
	}
	if row.TxHash != "mock_withdraw_tx" {
		t.Fatalf("want persisted tx hash, got %q", row.TxHash)
	}
	if row.Reference == "" || row.Destination != p0WithdrawAddr {
		t.Fatalf("row reference/destination wrong: %+v", row)
	}
	// Ledger debit joins to the payout row by reference.
	var debits int64
	db.DB.Model(&models.WalletLedgerEntry{}).
		Where("reference_id = ? AND type = ?", row.Reference, models.TransactionPayout).Count(&debits)
	if debits != 1 {
		t.Fatalf("want exactly 1 payout debit for reference, got %d", debits)
	}
}

// W-03 regression: broadcast-but-unconfirmed is NOT reported as success; the
// row stays submitted (worker sweep owns completion) and funds stay debited.
func TestWithdrawSOL_P0_UnconfirmedReturns202Submitted(t *testing.T) {
	testutil.SetupTestDB(t)
	cleanupWithdrawP0(t)
	user, _ := seedWithdrawUser(t, 10.0)
	withWithdrawSOLMocks(t, func(ctx context.Context, o *solana.OracleClient, dest string, amount float64) (string, error) {
		return "mock_pending_tx", nil
	})
	confirmWithdrawTxHook = func(ctx context.Context, oracle *solana.OracleClient, txHash string) solana.TxConfirmState {
		return solana.TxPending
	}

	w := postWithdraw(t, user.ID, map[string]interface{}{"amount": 2.0}, "")
	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202 for unconfirmed withdrawal, got %d body %s", w.Code, w.Body.String())
	}

	var row models.WithdrawalPayout
	if err := db.DB.Where("user_id = ?", user.ID).First(&row).Error; err != nil {
		t.Fatalf("durable payout row missing: %v", err)
	}
	if row.Status != models.WithdrawalPayoutSubmitted || row.TxHash != "mock_pending_tx" {
		t.Fatalf("want submitted row with tx hash, got status=%q hash=%q", row.Status, row.TxHash)
	}
	var wallet models.Wallet
	db.DB.Where("user_id = ?", user.ID).First(&wallet)
	if wallet.BalanceSOL != 8.0 {
		t.Fatalf("balance must stay debited while submitted, got %.6f", wallet.BalanceSOL)
	}
}

// W-03: a thin hot wallet (send reports insufficient balance) queues for the
// worker instead of refunding/failing: row=funding, balance stays debited.
func TestWithdrawSOL_P0_HotWalletThinQueuesFunding(t *testing.T) {
	testutil.SetupTestDB(t)
	cleanupWithdrawP0(t)
	user, _ := seedWithdrawUser(t, 10.0)
	withWithdrawSOLMocks(t, func(ctx context.Context, o *solana.OracleClient, dest string, amount float64) (string, error) {
		return "", errors.New("insufficient SOL balance (have 100 lamports, need 2000010000 + fees)")
	})

	w := postWithdraw(t, user.ID, map[string]interface{}{"amount": 2.0}, "")
	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d body %s", w.Code, w.Body.String())
	}
	var row models.WithdrawalPayout
	if err := db.DB.Where("user_id = ?", user.ID).First(&row).Error; err != nil {
		t.Fatalf("durable payout row missing: %v", err)
	}
	if row.Status != models.WithdrawalPayoutFunding {
		t.Fatalf("want funding, got %q", row.Status)
	}
	var wallet models.Wallet
	db.DB.Where("user_id = ?", user.ID).First(&wallet)
	if wallet.BalanceSOL != 8.0 {
		t.Fatalf("balance must stay debited while funding, got %.6f", wallet.BalanceSOL)
	}
	var refunds int64
	db.DB.Model(&models.WalletLedgerEntry{}).Where("type = ?", "withdrawal_failed_refund").Count(&refunds)
	if refunds != 0 {
		t.Fatalf("thin-hot-wallet queueing must not refund, found %d refunds", refunds)
	}
}

// W-11 regression: retrying a withdrawal with the same Idempotency-Key
// replays the first response and never debits or sends twice.
func TestWithdrawSOL_P0_IdempotencyKeyDebitsOnce(t *testing.T) {
	testutil.SetupTestDB(t)
	cleanupWithdrawP0(t)
	user, _ := seedWithdrawUser(t, 10.0)
	var sends atomic.Int32
	withWithdrawSOLMocks(t, func(ctx context.Context, o *solana.OracleClient, dest string, amount float64) (string, error) {
		sends.Add(1)
		return "mock_idem_tx", nil
	})

	key := "withdraw-test-" + uuid.NewString()
	w1 := postWithdraw(t, user.ID, map[string]interface{}{"amount": 2.0}, key)
	if w1.Code != http.StatusOK {
		t.Fatalf("first request: expected 200, got %d body %s", w1.Code, w1.Body.String())
	}
	w2 := postWithdraw(t, user.ID, map[string]interface{}{"amount": 2.0}, key)
	if w2.Code != http.StatusOK {
		t.Fatalf("retry: expected replayed 200, got %d body %s", w2.Code, w2.Body.String())
	}
	if w1.Body.String() != w2.Body.String() {
		t.Fatalf("retry must replay stored response verbatim:\nfirst:  %s\nsecond: %s", w1.Body.String(), w2.Body.String())
	}
	if sends.Load() != 1 {
		t.Fatalf("on-chain send must happen exactly once, got %d", sends.Load())
	}
	var wallet models.Wallet
	db.DB.Where("user_id = ?", user.ID).First(&wallet)
	if wallet.BalanceSOL != 8.0 {
		t.Fatalf("want single debit (balance 8.0), got %.6f", wallet.BalanceSOL)
	}
	var rows int64
	db.DB.Model(&models.WithdrawalPayout{}).Where("user_id = ?", user.ID).Count(&rows)
	if rows != 1 {
		t.Fatalf("want exactly 1 payout row, got %d", rows)
	}
}

// W-11 regression: retrying a P2P transfer with the same Idempotency-Key
// moves funds exactly once and replays the original reference.
func TestTransferP2P_P0_IdempotencyKeyTransfersOnce(t *testing.T) {
	testutil.SetupTestDB(t)
	cleanupWithdrawP0(t)

	sender, senderWallet := createWalletTestUser(t)
	recipient := testutil.CreateTestUser(t, testutil.UniqueEmail("wallet-p0-idem"), "buyer")
	var recipientWallet models.Wallet
	if err := db.DB.Where("user_id = ?", recipient.ID).FirstOrCreate(&recipientWallet, models.Wallet{UserID: recipient.ID}).Error; err != nil {
		t.Fatalf("recipient wallet: %v", err)
	}
	senderWallet.BalanceSOL = 20.0
	senderWallet.LimitsEnabled = false
	db.DB.Save(&senderWallet)
	recipientWallet.BalanceSOL = 0
	db.DB.Save(&recipientWallet)

	key := "p2p-test-" + uuid.NewString()
	post := func() *httptest.ResponseRecorder {
		r := setupTestRouter()
		r.Use(authMiddlewareMock(sender.ID.String(), "buyer"))
		r.POST("/wallet/transfer", transferP2P)
		body, _ := json.Marshal(map[string]interface{}{"recipient": recipient.Email, "amount": 3.0})
		req := httptest.NewRequest(http.MethodPost, "/wallet/transfer", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", key)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	w1 := post()
	if w1.Code != http.StatusOK {
		t.Fatalf("first transfer: expected 200, got %d body %s", w1.Code, w1.Body.String())
	}
	w2 := post()
	if w2.Code != http.StatusOK {
		t.Fatalf("retry: expected replayed 200, got %d body %s", w2.Code, w2.Body.String())
	}
	if w1.Body.String() != w2.Body.String() {
		t.Fatalf("retry must replay stored response:\nfirst:  %s\nsecond: %s", w1.Body.String(), w2.Body.String())
	}

	db.DB.Where("user_id = ?", sender.ID).First(&senderWallet)
	if senderWallet.BalanceSOL != 17.0 {
		t.Fatalf("sender must be debited once (17.0), got %.6f", senderWallet.BalanceSOL)
	}
	db.DB.Where("user_id = ?", recipient.ID).First(&recipientWallet)
	if recipientWallet.BalanceSOL != 3.0 {
		t.Fatalf("recipient must be credited once (3.0), got %.6f", recipientWallet.BalanceSOL)
	}
}
