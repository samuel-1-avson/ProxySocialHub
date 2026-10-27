package api

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// W-13: withdrawals above the 0.1 SOL dust threshold require a signature
// over the server challenge binding exact lamports + destination + user.
// W-12 destination re-validation under lock shipped with P0-3.
func TestWithdrawSOL_P1_ChallengeSignatureRequiredAboveDust(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	cleanupWithdrawP0(t)

	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	addr := base58.Encode(pub)

	user, wallet := createWalletTestUser(t)
	linkSolanaWallet(t, &user, addr)
	wallet.BalanceSOL = 10
	wallet.BalanceLamports = 10_000_000_000
	wallet.LimitsEnabled = false
	if err := db.DB.Save(&wallet).Error; err != nil {
		t.Fatal(err)
	}
	withWithdrawSOLMocks(t, func(ctx context.Context, o *solana.OracleClient, dest string, amount float64) (string, error) {
		return "mock_p1_tx", nil
	})
	t.Setenv("WITHDRAW_SIGNATURE_THRESHOLD_LAMPORTS", "100000000") // real 0.1 SOL gate

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/wallet/withdraw/sol", withdrawSOL)
	r.POST("/wallet/withdraw/challenge", getWithdrawChallenge)
	post := func(path string, body map[string]interface{}) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewBuffer(raw))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	// 1 SOL without any signature -> 403 (session alone is not enough).
	w := post("/wallet/withdraw/sol", map[string]interface{}{"amount_lamports": 1_000_000_000})
	if w.Code != http.StatusForbidden {
		t.Fatalf("unsigned 1 SOL withdraw: want 403, got %d %s", w.Code, w.Body.String())
	}

	// Challenge for 1 SOL, sign it, withdraw -> 200.
	w = post("/wallet/withdraw/challenge", map[string]interface{}{"amount_lamports": 1_000_000_000})
	if w.Code != http.StatusOK {
		t.Fatalf("challenge: %d %s", w.Code, w.Body.String())
	}
	var ch struct {
		Message string `json:"message"`
		Nonce   string `json:"nonce"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &ch); err != nil || ch.Nonce == "" {
		t.Fatalf("challenge body: %v %s", err, w.Body.String())
	}
	sig := base58.Encode(ed25519.Sign(priv, []byte(ch.Message)))
	w = post("/wallet/withdraw/sol", map[string]interface{}{
		"amount_lamports": 1_000_000_000,
		"challenge_nonce": ch.Nonce,
		"signature":       sig,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("signed withdraw: want 200, got %d %s", w.Code, w.Body.String())
	}

	// Replay of the same nonce+signature -> 403 (single-use).
	w = post("/wallet/withdraw/sol", map[string]interface{}{
		"amount_lamports": 1_000_000_000,
		"challenge_nonce": ch.Nonce,
		"signature":       sig,
	})
	if w.Code != http.StatusForbidden {
		t.Fatalf("replayed challenge: want 403, got %d %s", w.Code, w.Body.String())
	}

	// Signature over 1 SOL presented for a 2 SOL withdrawal -> 403
	// (exact-lamports binding; the old float scheme bound a range).
	w = post("/wallet/withdraw/challenge", map[string]interface{}{"amount_lamports": 1_000_000_000})
	if err := json.Unmarshal(w.Body.Bytes(), &ch); err != nil {
		t.Fatal(err)
	}
	sig = base58.Encode(ed25519.Sign(priv, []byte(ch.Message)))
	w = post("/wallet/withdraw/sol", map[string]interface{}{
		"amount_lamports": 2_000_000_000,
		"challenge_nonce": ch.Nonce,
		"signature":       sig,
	})
	if w.Code != http.StatusForbidden {
		t.Fatalf("amount-swapped signature: want 403, got %d %s", w.Code, w.Body.String())
	}

	// Dust (0.05 SOL) needs no signature.
	w = post("/wallet/withdraw/sol", map[string]interface{}{"amount_lamports": 50_000_000})
	if w.Code != http.StatusOK {
		t.Fatalf("dust withdraw: want 200, got %d %s", w.Code, w.Body.String())
	}
}

// W-30: admin payout requires idempotency key + reason, enforces
// four-eyes above threshold, and queues a real payout (202) instead of
// debiting into the void with "processed".
func TestProcessPayout_P1_ValidationAndFourEyes(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "idempotency_records")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("p1-admin-provider"), "provider")
	admin := testutil.CreateTestUser(t, testutil.UniqueEmail("p1-admin"), "admin")

	r := setupTestRouter()
	r.Use(authMiddlewareMock(admin.ID.String(), "admin"))
	r.POST("/admin/users/:id/payout", processPayout)
	post := func(body map[string]interface{}, headers map[string]string) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/admin/users/"+provider.ID.String()+"/payout", bytes.NewBuffer(raw))
		req.Header.Set("Content-Type", "application/json")
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	base := map[string]interface{}{"amount_lamports": 100_000_000, "reason": "manual earnings payout"}

	// No idempotency key -> 400 (old code silently generated one,
	// making admin retries double-debit).
	if w := post(base, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("missing idempotency key: want 400, got %d %s", w.Code, w.Body.String())
	}
	// No reason -> 400.
	noReason := map[string]interface{}{"amount_lamports": 100_000_000}
	if w := post(noReason, map[string]string{"Idempotency-Key": "k-noreason"}); w.Code != http.StatusBadRequest {
		t.Fatalf("missing reason: want 400, got %d %s", w.Code, w.Body.String())
	}
	// 11 SOL without second approver -> 400 four-eyes.
	big := map[string]interface{}{"amount_lamports": 11_000_000_000, "reason": "big payout"}
	if w := post(big, map[string]string{"Idempotency-Key": "k-big"}); w.Code != http.StatusBadRequest {
		t.Fatalf("four-eyes missing: want 400, got %d %s", w.Code, w.Body.String())
	}
	// Second approver == actor -> 400.
	if w := post(big, map[string]string{"Idempotency-Key": "k-big2", "X-Second-Approver": admin.ID.String()}); w.Code != http.StatusBadRequest {
		t.Fatalf("self-approval: want 400, got %d %s", w.Code, w.Body.String())
	}
	// Small payout with key+reason but no payable/no linked wallet ->
	// honest 400 from the payout machine, never a phantom "processed".
	if w := post(base, map[string]string{"Idempotency-Key": "k-ok"}); w.Code != http.StatusBadRequest {
		t.Fatalf("no payable wallet: want 400, got %d %s", w.Code, w.Body.String())
	}

	var debits int64
	db.DB.Model(&models.WalletLedgerEntry{}).Where("type = ?", models.TransactionPayout).Count(&debits)
	if debits != 0 {
		t.Fatalf("rejected admin payouts must never debit, got %d payout debits", debits)
	}
}

// W-10: payout settings round-trip.
func TestPayoutSettings_P1_RoundTrip(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")
	user, _ := createWalletTestUser(t)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "seller"))
	r.GET("/provider/earnings/payout-settings", getPayoutSettings)
	r.PUT("/provider/earnings/payout-settings", updatePayoutSettings)

	raw, _ := json.Marshal(map[string]interface{}{
		"auto_payout_enabled":            true,
		"auto_payout_threshold_lamports": 123_000_000,
	})
	req := httptest.NewRequest(http.MethodPut, "/provider/earnings/payout-settings", bytes.NewBuffer(raw))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT settings: %d %s", w.Code, w.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/provider/earnings/payout-settings", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET settings: %d %s", w.Code, w.Body.String())
	}
	var got struct {
		AutoPayoutEnabled           bool  `json:"auto_payout_enabled"`
		AutoPayoutThresholdLamports int64 `json:"auto_payout_threshold_lamports"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.AutoPayoutEnabled || got.AutoPayoutThresholdLamports != 123_000_000 {
		t.Fatalf("settings not persisted: %+v", got)
	}
}
