package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/custody"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/paystack"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// cashoutTestEnv is a managed-wallet provider with fake Paystack and Solana.
type cashoutTestEnv struct {
	router         *gin.Engine
	user           *models.User
	address        sol.PublicKey
	float          sol.PublicKey
	mu             sync.Mutex
	balance        uint64
	landed         map[string]bool // sweep signatures the "chain" has confirmed
	signed         int
	sent           int
	refunds        []uint64
	transferStatus string // what Transfer returns
	verifyStatus   string // what VerifyTransfer returns
	transfers      int
	googleSub      string
}

func setupCashoutTest(t *testing.T) *cashoutTestEnv {
	t.Helper()
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "cashouts", "payout_destinations", "fiat_payments", "user_identities", "embedded_wallets", "linked_wallets", "user_flags", "wallets", "users")
	if err := db.DB.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_cashouts_user_open ON cashouts (user_id)
		WHERE status IN ('confirmed', 'sweeping', 'swept', 'transferring', 'refunding')`).Error; err != nil {
		t.Fatal(err)
	}
	t.Setenv("CASHOUT_ENABLED", "true")
	t.Setenv("PAYSTACK_SECRET_KEY", "sk_test_cashout")
	t.Setenv("CASHOUT_FEE_BUFFER_PCT", "3")
	t.Setenv("CASHOUT_FLAT_FEE_GHS", "1")

	user, addr := managedWalletUser(t)
	db.DB.Model(&models.User{}).Where("id = ?", user.ID).Update("role", "provider")
	user.Role = "provider"
	if err := db.DB.Create(&models.LinkedWallet{ID: uuid.New(), UserID: user.ID, Chain: models.ChainSolana, Address: addr, Verified: true, IsPrimary: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.DB.Create(&models.UserIdentity{ID: uuid.New(), UserID: user.ID, Provider: models.IdentityProviderGoogle, Subject: "google-sub-provider"}).Error; err != nil {
		t.Fatal(err)
	}

	env := &cashoutTestEnv{
		user: user, address: sol.MustPublicKeyFromBase58(addr), float: sol.NewWallet().PublicKey(),
		balance: 100_000_000, landed: map[string]bool{}, transferStatus: "success", verifyStatus: "success",
		googleSub: "google-sub-provider",
	}

	prev := []func(){}
	save := func(restore func()) { prev = append(prev, restore) }
	{
		a, b, c2, d, e, f, g, h, i, j, k, l, m := cashoutCreateRecipient, cashoutTransfer, cashoutVerifyTransfer, cashoutEncryptPhone,
			cashoutFloatAddress, cashoutSignSweep, cashoutSendSigned, cashoutSigStatus, cashoutRefund, cashoutGoogleClientID,
			fiatWalletBalance, fiatSOLPriceUSD, fiatUSDToGHS
		v := verifyGoogleToken
		save(func() {
			cashoutCreateRecipient, cashoutTransfer, cashoutVerifyTransfer, cashoutEncryptPhone = a, b, c2, d
			cashoutFloatAddress, cashoutSignSweep, cashoutSendSigned, cashoutSigStatus, cashoutRefund, cashoutGoogleClientID = e, f, g, h, i, j
			fiatWalletBalance, fiatSOLPriceUSD, fiatUSDToGHS = k, l, m
			verifyGoogleToken = v
		})
	}
	t.Cleanup(func() {
		for _, r := range prev {
			r()
		}
	})

	cashoutCreateRecipient = func(_ context.Context, name, phone, network string) (string, error) {
		if !strings.HasPrefix(phone, "0") || len(phone) != 10 {
			t.Errorf("phone not normalised: %q", phone)
		}
		return "RCP_test", nil
	}
	cashoutEncryptPhone = func(p string) (string, error) { return "enc:" + p, nil }
	cashoutFloatAddress = func() (sol.PublicKey, error) { return env.float, nil }
	cashoutSignSweep = func(_ context.Context, signer *custody.Signer, from, to sol.PublicKey, lamports uint64) (*sol.Transaction, error) {
		env.mu.Lock()
		env.signed++
		n := env.signed
		env.mu.Unlock()
		tx, err := sol.NewTransaction(
			[]sol.Instruction{mustTransferIx(t, from, to, lamports)},
			sol.Hash{byte(n)}, sol.TransactionPayer(from))
		if err != nil {
			return nil, err
		}
		return tx, signer.SignTransaction(tx)
	}
	cashoutSendSigned = func(_ context.Context, tx *sol.Transaction) error {
		env.mu.Lock()
		defer env.mu.Unlock()
		env.sent++
		env.landed[tx.Signatures[0].String()] = true
		return nil
	}
	cashoutSigStatus = func(_ context.Context, sig string) (bool, bool, error) {
		env.mu.Lock()
		defer env.mu.Unlock()
		return env.landed[sig], env.landed[sig], nil
	}
	cashoutRefund = func(_ context.Context, to sol.PublicKey, lamports uint64) (string, error) {
		env.mu.Lock()
		defer env.mu.Unlock()
		env.refunds = append(env.refunds, lamports)
		return "refundtx", nil
	}
	cashoutTransfer = func(_ context.Context, ref string, amount int64, recipient, _ string) (*paystack.TransferResult, error) {
		env.mu.Lock()
		defer env.mu.Unlock()
		env.transfers++
		if recipient != "RCP_test" {
			t.Errorf("transfer to %q", recipient)
		}
		return &paystack.TransferResult{TransferCode: "TRF_1", Reference: ref, Status: env.transferStatus, Amount: amount}, nil
	}
	cashoutVerifyTransfer = func(_ context.Context, ref string) (*paystack.TransferResult, error) {
		env.mu.Lock()
		defer env.mu.Unlock()
		return &paystack.TransferResult{TransferCode: "TRF_1", Reference: ref, Status: env.verifyStatus}, nil
	}
	cashoutGoogleClientID = func() string { return "test-client.apps.googleusercontent.com" }
	verifyGoogleToken = func(_ context.Context, credential, _ string) (googleIdentity, error) {
		if credential != "fresh-google-token" {
			return googleIdentity{}, errors.New("bad token")
		}
		return googleIdentity{Subject: env.googleSub, EmailVerified: true}, nil
	}
	fiatWalletBalance = func(_ context.Context, _ sol.PublicKey) (uint64, error) {
		env.mu.Lock()
		defer env.mu.Unlock()
		return env.balance, nil
	}
	fiatSOLPriceUSD = func(context.Context) (float64, error) { return 100, nil }
	fiatUSDToGHS = func(context.Context) (float64, error) { return 12, nil }

	r := setupTestRouter()
	r.Use(func(c *gin.Context) { c.Set("userID", env.user.ID.String()); c.Next() })
	// Handlers mounted without StrictRateLimit, which would trip across tests.
	r.GET("/wallet/cashout", getCashoutOverview)
	r.POST("/wallet/cashout/destination", setCashoutDestination)
	r.POST("/wallet/cashout/quote", quoteCashout)
	r.POST("/wallet/cashout/:id/confirm", confirmCashout)
	r.GET("/wallet/cashout/:id", getCashout)
	env.router = r
	return env
}

func mustTransferIx(t *testing.T, from, to sol.PublicKey, lamports uint64) sol.Instruction {
	t.Helper()
	ix, err := solana.BuildSOLTransferIx(from, to, lamports)
	if err != nil {
		t.Fatal(err)
	}
	return ix
}

func (e *cashoutTestEnv) do(t *testing.T, method, path, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	e.router.ServeHTTP(w, req)
	out := map[string]any{}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w, out
}

func (e *cashoutTestEnv) addDestination(t *testing.T) {
	t.Helper()
	w, out := e.do(t, http.MethodPost, "/wallet/cashout/destination", `{"network":"MTN","phone":"+233 55 123 4987","account_name":"Ama Mensah"}`)
	if w.Code != http.StatusOK || out["phone_last4"] != "4987" {
		t.Fatalf("destination: %d %s", w.Code, w.Body.String())
	}
}

func (e *cashoutTestEnv) quote(t *testing.T, ghs string) map[string]any {
	t.Helper()
	w, out := e.do(t, http.MethodPost, "/wallet/cashout/quote", `{"amount_ghs":`+ghs+`}`)
	if w.Code != http.StatusOK {
		t.Fatalf("quote: %d %s", w.Code, w.Body.String())
	}
	return out
}

func (e *cashoutTestEnv) confirm(t *testing.T, id string, token string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	return e.do(t, http.MethodPost, "/wallet/cashout/"+id+"/confirm", `{"google_credential":"`+token+`"}`)
}

func (e *cashoutTestEnv) row(t *testing.T, id string) models.Cashout {
	t.Helper()
	var c models.Cashout
	if err := db.DB.First(&c, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	return c
}

func TestCashoutQuoteMath(t *testing.T) {
	env := setupCashoutTest(t)
	env.addDestination(t)
	q := env.quote(t, "50")
	// (50 + 1 fee) GH₵ / (100 USD/SOL * 12 GHS/USD) * 1.03 = 0.043775 SOL
	c := env.row(t, q["id"].(string))
	if c.Lamports != 43_775_000 || c.AmountMinor != 5000 || c.FeeMinor != 100 || c.Status != models.CashoutQuoted {
		t.Fatalf("quote row = %+v", c)
	}
}

func TestCashoutHappyPathMovesMoneyOnce(t *testing.T) {
	env := setupCashoutTest(t)
	env.addDestination(t)
	q := env.quote(t, "50")
	id := q["id"].(string)

	w, out := env.confirm(t, id, "fresh-google-token")
	if w.Code != http.StatusOK || out["status"] != string(models.CashoutCompleted) {
		t.Fatalf("confirm: %d %s", w.Code, w.Body.String())
	}
	c := env.row(t, id)
	if c.SweepTx == "" || !env.landed[c.SweepTx] {
		t.Fatalf("sweep not recorded/landed: %+v", c)
	}
	// Replays never move money again.
	for i := 0; i < 3; i++ {
		if _, err := processCashout(context.Background(), c.Reference); err != nil {
			t.Fatalf("replay: %v", err)
		}
	}
	if env.sent != 1 || env.transfers != 1 || len(env.refunds) != 0 {
		t.Fatalf("sent=%d transfers=%d refunds=%d", env.sent, env.transfers, len(env.refunds))
	}
}

func TestCashoutRequiresSameGoogleAccount(t *testing.T) {
	env := setupCashoutTest(t)
	env.addDestination(t)
	q := env.quote(t, "20")
	id := q["id"].(string)

	if w, _ := env.confirm(t, id, "stolen-session-no-google"); w.Code != http.StatusUnauthorized {
		t.Fatalf("bad token: %d", w.Code)
	}
	env.googleSub = "someone-else"
	if w, out := env.confirm(t, id, "fresh-google-token"); w.Code != http.StatusForbidden || out["code"] != "step_up_mismatch" {
		t.Fatalf("other google account: %d %v", w.Code, out)
	}
	if c := env.row(t, id); c.Status != models.CashoutQuoted || env.sent != 0 {
		t.Fatalf("money moved without step-up: status=%s sent=%d", c.Status, env.sent)
	}
}

func TestCashoutTransferFailureRefundsSOL(t *testing.T) {
	env := setupCashoutTest(t)
	env.addDestination(t)
	env.transferStatus = "failed"
	q := env.quote(t, "20")
	id := q["id"].(string)

	w, out := env.confirm(t, id, "fresh-google-token")
	if w.Code != http.StatusOK || out["status"] != string(models.CashoutRefunded) {
		t.Fatalf("confirm: %d %s", w.Code, w.Body.String())
	}
	c := env.row(t, id)
	if len(env.refunds) != 1 || env.refunds[0] != uint64(c.Lamports) || c.RefundTx != "refundtx" {
		t.Fatalf("refunds=%v row=%+v", env.refunds, c)
	}
}

func TestCashoutPendingTransferCompletesLater(t *testing.T) {
	env := setupCashoutTest(t)
	env.addDestination(t)
	env.transferStatus, env.verifyStatus = "pending", "pending"
	q := env.quote(t, "20")
	id := q["id"].(string)

	_, out := env.confirm(t, id, "fresh-google-token")
	if out["status"] != string(models.CashoutTransferring) {
		t.Fatalf("expected transferring, got %v", out)
	}
	env.verifyStatus = "success" // what the transfer.success webhook would trigger
	c := env.row(t, id)
	if p, err := processCashout(context.Background(), c.Reference); err != nil || p.Status != models.CashoutCompleted {
		t.Fatalf("after webhook: %v %+v", err, p)
	}
	if env.transfers != 1 {
		t.Fatalf("transfer started %d times", env.transfers)
	}
}

func TestCashoutResumesAfterCrashWithoutSecondSweep(t *testing.T) {
	env := setupCashoutTest(t)
	env.addDestination(t)
	q := env.quote(t, "20")
	id := q["id"].(string)
	c := env.row(t, id)

	// Crash after the sweep was signed, recorded and landed, before "swept" was saved.
	now := time.Now().UTC()
	db.DB.Model(&models.Cashout{}).Where("id = ?", c.ID).Updates(map[string]any{
		"status": models.CashoutSweeping, "sweep_tx": "LandedSweepSig", "sweep_sent_at": now,
	})
	env.landed["LandedSweepSig"] = true

	if p, err := processCashout(context.Background(), c.Reference); err != nil || p.Status != models.CashoutCompleted {
		t.Fatalf("resume: %v %+v", err, p)
	}
	if env.signed != 0 || env.sent != 0 {
		t.Fatalf("swept again: signed=%d sent=%d", env.signed, env.sent)
	}
}

func TestCashoutDroppedSweepIsResigned(t *testing.T) {
	env := setupCashoutTest(t)
	env.addDestination(t)
	q := env.quote(t, "20")
	c := env.row(t, q["id"].(string))
	old := time.Now().UTC().Add(-3 * time.Minute)
	db.DB.Model(&models.Cashout{}).Where("id = ?", c.ID).Updates(map[string]any{
		"status": models.CashoutSweeping, "sweep_tx": "NeverLandedSig", "sweep_sent_at": old,
	})

	if p, err := processCashout(context.Background(), c.Reference); err != nil || p.Status != models.CashoutCompleted {
		t.Fatalf("resign: %v %+v", err, p)
	}
	if env.signed != 1 || env.sent != 1 {
		t.Fatalf("expected one new sweep, signed=%d sent=%d", env.signed, env.sent)
	}
}

func TestCashoutUnknownRefundIsNeverResent(t *testing.T) {
	env := setupCashoutTest(t)
	env.addDestination(t)
	q := env.quote(t, "20")
	c := env.row(t, q["id"].(string))
	now := time.Now().UTC()
	db.DB.Model(&models.Cashout{}).Where("id = ?", c.ID).Updates(map[string]any{
		"status": models.CashoutRefunding, "refund_started_at": now,
	})

	p, err := processCashout(context.Background(), c.Reference)
	if err == nil || p.Status != models.CashoutFailed || len(env.refunds) != 0 {
		t.Fatalf("expected failed for ops without resend: %v status=%s refunds=%d", err, p.Status, len(env.refunds))
	}
}

func TestCashoutGuards(t *testing.T) {
	env := setupCashoutTest(t)

	// No destination yet.
	if w, out := env.do(t, http.MethodPost, "/wallet/cashout/quote", `{"amount_ghs":20}`); w.Code != http.StatusBadRequest || out["code"] != "no_destination" {
		t.Fatalf("no destination: %d %v", w.Code, out)
	}
	env.addDestination(t)

	// Not enough earnings.
	env.balance = 2_000_000
	if w, out := env.do(t, http.MethodPost, "/wallet/cashout/quote", `{"amount_ghs":500}`); w.Code != http.StatusPaymentRequired || out["code"] != "insufficient_balance" {
		t.Fatalf("insufficient: %d %v", w.Code, out)
	}
	env.balance = 100_000_000

	// A changed number waits 24h.
	db.DB.Model(&models.PayoutDestination{}).Where("user_id = ?", env.user.ID).
		Updates(map[string]any{"created_at": time.Now().Add(-2 * time.Hour), "updated_at": time.Now()})
	if w, out := env.do(t, http.MethodPost, "/wallet/cashout/quote", `{"amount_ghs":20}`); w.Code != http.StatusForbidden || out["code"] != "destination_cooldown" {
		t.Fatalf("cooldown: %d %v", w.Code, out)
	}
	db.DB.Model(&models.PayoutDestination{}).Where("user_id = ?", env.user.ID).
		Updates(map[string]any{"created_at": time.Now().Add(-48 * time.Hour), "updated_at": time.Now().Add(-48 * time.Hour)})

	// A card payment still settling blocks cash-out.
	db.DB.Create(&models.FiatPayment{ID: uuid.New(), OrderID: uuid.New(), UserID: env.user.ID, Reference: "phub_x",
		AmountMinor: 100, Currency: "GHS", USDAmount: 1, USDGHSRate: 12, SOLPriceUSD: 100, LamportsNeeded: 1, Status: models.FiatPaymentFunded})
	if w, out := env.do(t, http.MethodPost, "/wallet/cashout/quote", `{"amount_ghs":20}`); w.Code != http.StatusConflict || out["code"] != "busy" {
		t.Fatalf("fiat in flight: %d %v", w.Code, out)
	}
	db.DB.Where("reference = ?", "phub_x").Delete(&models.FiatPayment{})

	// Buyers (not providers) cannot cash out.
	db.DB.Model(&models.User{}).Where("id = ?", env.user.ID).Update("role", "buyer")
	if w, out := env.do(t, http.MethodPost, "/wallet/cashout/quote", `{"amount_ghs":20}`); w.Code != http.StatusForbidden || out["code"] != "provider_only" {
		t.Fatalf("buyer: %d %v", w.Code, out)
	}
}

func TestNormalizeGhanaPhone(t *testing.T) {
	for in, want := range map[string]string{
		"0551234987": "0551234987", "+233551234987": "0551234987", "233 24 123 4567": "0241234567",
	} {
		if got, ok := normalizeGhanaPhone(in); !ok || got != want {
			t.Fatalf("%q -> %q %v", in, got, ok)
		}
	}
	for _, bad := range []string{"12345", "0151234987", "+44 7700 900123"} {
		if _, ok := normalizeGhanaPhone(bad); ok {
			t.Fatalf("%q should be rejected", bad)
		}
	}
}
