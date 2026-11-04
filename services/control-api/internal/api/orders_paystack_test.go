package api

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
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
	"gorm.io/gorm"
)

const (
	fiatTestRent      uint64 = 2_000_000
	fiatTestSOLUSD           = 100.0
	fiatTestUSDGHS           = 12.0
	fiatTestOrderUSD         = 2.0 // 0.02 SOL at $100
	fiatTestSellerKey        = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
)

// fiatTestEnv is a managed-wallet buyer, an order, and fake Paystack / Solana.
type fiatTestEnv struct {
	router    *gin.Engine
	userID    uuid.UUID
	address   sol.PublicKey
	order     models.Order
	mu        sync.Mutex
	balances  map[string]uint64
	paystack  map[string]*paystack.Transaction // reference -> verify result
	sends     []uint64
	escrows   []solana.InitializeEscrowParams
	refunds   []string
	escrowErr error
	builds    int
	pending   map[string]fiatPendingTx // funding tx signature -> what it does
	landed    map[string]bool
	inits     int
	escrowSet bool     // an escrow already exists at the order's PDA
	async     []string // references handed to fiatProcessAsync
}

type fiatPendingTx struct {
	fund   uint64
	params solana.InitializeEscrowParams
}

func setupFiatTest(t *testing.T) *fiatTestEnv {
	t.Helper()
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "fiat_payments", "orders", "proxy_listings", "embedded_wallets", "linked_wallets", "wallets", "users")
	if err := db.DB.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_fiat_payments_order_paid ON fiat_payments (order_id)
		WHERE status IN ('paid', 'funded', 'escrowed', 'active')`).Error; err != nil {
		t.Fatalf("paid-order index: %v", err)
	}
	t.Setenv("FIAT_PAYMENTS_ENABLED", "true")
	t.Setenv("PAYSTACK_SECRET_KEY", "sk_test_fiat")
	t.Setenv("EMBEDDED_WALLET_KEK", strings.Repeat("cd", 32))
	t.Setenv("APP_ENV", "development")
	t.Setenv("PAYSTACK_FEE_BUFFER_PCT", "0")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("fiat"), "buyer")
	kek, err := custody.DefaultKEK()
	if err != nil {
		t.Fatal(err)
	}
	ew, err := custody.CreateSolanaWallet(db.DB, kek, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.DB.Create(&models.LinkedWallet{
		ID: uuid.New(), UserID: user.ID, Chain: models.ChainSolana, Address: ew.Address, Verified: true, IsPrimary: true,
	}).Error; err != nil {
		t.Fatal(err)
	}

	env := &fiatTestEnv{
		userID:   user.ID,
		address:  sol.MustPublicKeyFromBase58(ew.Address),
		balances: map[string]uint64{},
		paystack: map[string]*paystack.Transaction{},
	}
	env.order = models.Order{
		ID: uuid.New(), BuyerID: user.ID, SellerID: uuid.New(), ListingID: uuid.New(),
		BandwidthGB: 2, PricePerGB: 1, TotalPrice: fiatTestOrderUSD, Status: models.OrderStatusPending,
	}
	if err := db.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL session_replication_role = 'replica'").Error; err != nil {
			return err
		}
		return tx.Create(&env.order).Error
	}); err != nil {
		t.Fatalf("order: %v", err)
	}

	prevInit, prevVerify, prevRefund := paystackInitialize, paystackVerify, paystackRefund
	prevFX, prevSOL, prevPrepare, prevConfirm := fiatUSDToGHS, fiatSOLPriceUSD, fiatPrepareEscrow, fiatConfirmEscrow
	prevBal, prevRent, prevSend, prevFetch, prevLegacy, prevSubmit := fiatWalletBalance, fiatEscrowRent, fiatTreasurySend, fiatFetchEscrow, fiatLegacyEscrow, fiatSubmitEscrow
	prevBuild, prevSendSigned, prevSigStatus := fiatBuildFundEscrowTx, fiatSendSigned, fiatSigStatus
	prevAsync := fiatProcessAsync
	t.Cleanup(func() {
		paystackInitialize, paystackVerify, paystackRefund = prevInit, prevVerify, prevRefund
		fiatUSDToGHS, fiatSOLPriceUSD, fiatPrepareEscrow, fiatConfirmEscrow = prevFX, prevSOL, prevPrepare, prevConfirm
		fiatWalletBalance, fiatEscrowRent, fiatTreasurySend, fiatFetchEscrow, fiatLegacyEscrow, fiatSubmitEscrow = prevBal, prevRent, prevSend, prevFetch, prevLegacy, prevSubmit
		fiatBuildFundEscrowTx, fiatSendSigned, fiatSigStatus = prevBuild, prevSendSigned, prevSigStatus
		fiatProcessAsync = prevAsync
	})
	fiatProcessAsync = func(ref string) {
		env.mu.Lock()
		env.async = append(env.async, ref)
		env.mu.Unlock()
	}
	env.pending = map[string]fiatPendingTx{}
	env.landed = map[string]bool{}

	paystackInitialize = func(_ context.Context, req paystack.InitializeRequest) (*paystack.InitializeResult, error) {
		if req.Currency != "GHS" || req.Amount <= 0 || req.Email == "" {
			t.Errorf("bad initialize request: %+v", req)
		}
		env.mu.Lock()
		env.inits++
		env.mu.Unlock()
		return &paystack.InitializeResult{AccessCode: "ac_" + req.Reference, Reference: req.Reference}, nil
	}
	paystackVerify = func(_ context.Context, ref string) (*paystack.Transaction, error) {
		env.mu.Lock()
		defer env.mu.Unlock()
		if tx, ok := env.paystack[ref]; ok {
			return tx, nil
		}
		return &paystack.Transaction{Status: "ongoing", Reference: ref}, nil
	}
	paystackRefund = func(_ context.Context, ref string) error {
		env.mu.Lock()
		env.refunds = append(env.refunds, ref)
		env.mu.Unlock()
		return nil
	}
	fiatUSDToGHS = func(context.Context) (float64, error) { return fiatTestUSDGHS, nil }
	fiatSOLPriceUSD = func(context.Context) (float64, error) { return fiatTestSOLUSD, nil }
	fiatPrepareEscrow = func(_ context.Context, o *models.Order, _ string, _ bool) (*orderEscrowIntent, *escrowConfirmProblem) {
		amountSOL := o.TotalPrice / fiatTestSOLUSD
		pda := sol.NewWallet().PublicKey()
		fields := map[string]any{
			"status": models.OrderStatusPendingPayment, "payment_method": "solana_escrow",
			"escrow_pda": pda.String(), "buyer_wallet": env.address.String(), "seller_wallet": fiatTestSellerKey,
			"amount_locked_sol": amountSOL, "escrow_seed_kind": "legacy",
		}
		if err := db.DB.Model(&models.Order{}).Where("id = ?", o.ID).Updates(fields).Error; err != nil {
			return nil, &escrowConfirmProblem{Status: 500, Body: gin.H{"error": err.Error()}}
		}
		o.Status, o.EscrowPDA, o.BuyerWallet, o.SellerWallet, o.AmountLockedSOL, o.EscrowSeedKind =
			models.OrderStatusPendingPayment, pda.String(), env.address.String(), fiatTestSellerKey, amountSOL, "legacy"
		return &orderEscrowIntent{Buyer: env.address, PDA: pda, AmountSOL: amountSOL, AmountLamports: models.SOLToLamports(amountSOL), AlreadyFunded: env.escrowSet}, nil
	}
	fiatConfirmEscrow = func(_ context.Context, o *models.Order, _ string, _ string, _ string) (*solana.Escrow, sol.PublicKey, *escrowConfirmProblem) {
		if err := db.DB.Model(&models.Order{}).Where("id = ?", o.ID).Update("status", models.OrderStatusActive).Error; err != nil {
			return nil, sol.PublicKey{}, &escrowConfirmProblem{Status: 500, Body: gin.H{"error": err.Error()}}
		}
		o.Status = models.OrderStatusActive
		return &solana.Escrow{}, sol.PublicKey{}, nil
	}
	fiatWalletBalance = func(_ context.Context, a sol.PublicKey) (uint64, error) {
		env.mu.Lock()
		defer env.mu.Unlock()
		return env.balances[a.String()], nil
	}
	fiatEscrowRent = func(context.Context) (uint64, error) { return fiatTestRent, nil }
	fiatTreasurySend = func(_ context.Context, to sol.PublicKey, lamports uint64) (string, error) {
		env.mu.Lock()
		defer env.mu.Unlock()
		env.sends = append(env.sends, lamports)
		env.balances[to.String()] += lamports
		return fmt.Sprintf("fundtx%d", len(env.sends)), nil
	}
	fiatFetchEscrow = func(context.Context, sol.PublicKey) *solana.Escrow { return nil }
	fiatLegacyEscrow = func(context.Context, sol.PublicKey, sol.PublicKey) *solana.Escrow { return nil }
	fiatSubmitEscrow = func(_ context.Context, signer *custody.Signer, p solana.InitializeEscrowParams) (string, error) {
		env.mu.Lock()
		defer env.mu.Unlock()
		if env.escrowErr != nil {
			return "", env.escrowErr
		}
		// The managed key must actually sign as the buyer.
		sig, err := signer.Sign([]byte("probe"))
		if err != nil || !ed25519.Verify(ed25519.PublicKey(p.Buyer.Bytes()), []byte("probe"), sig) {
			t.Errorf("escrow not signed by the managed wallet: %v", err)
		}
		env.escrows = append(env.escrows, p)
		return "escrowtx", nil
	}
	// One-transaction funding: the "treasury" signs slot 0 here, the managed wallet
	// signs its own slot in the code under test, and send applies both effects.
	floatKey := sol.NewWallet().PublicKey()
	fiatBuildFundEscrowTx = func(_ context.Context, fund uint64, p solana.InitializeEscrowParams) (*sol.Transaction, error) {
		env.mu.Lock()
		defer env.mu.Unlock()
		if env.escrowErr != nil {
			return nil, env.escrowErr
		}
		env.builds++
		var ixs []sol.Instruction
		if fund > 0 {
			ixs = append(ixs, mustTransferIx(t, floatKey, p.Buyer, fund))
		}
		initIx, err := solana.BuildInitializeEscrowIx(sol.MustPublicKeyFromBase58(solana.ProgramID), p)
		if err != nil {
			return nil, err
		}
		tx, err := sol.NewTransaction(append(ixs, initIx), sol.Hash{byte(env.builds)}, sol.TransactionPayer(floatKey))
		if err != nil {
			return nil, err
		}
		tx.Signatures = make([]sol.Signature, tx.Message.Header.NumRequiredSignatures)
		copy(tx.Signatures[0][:], sol.NewWallet().PrivateKey[:64]) // unique fake treasury signature
		env.pending[tx.Signatures[0].String()] = fiatPendingTx{fund: fund, params: p}
		return tx, nil
	}
	fiatSendSigned = func(_ context.Context, tx *sol.Transaction) error {
		env.mu.Lock()
		defer env.mu.Unlock()
		msg, _ := tx.Message.MarshalBinary()
		buyerSigned := false
		for i, k := range tx.Message.AccountKeys[:tx.Message.Header.NumRequiredSignatures] {
			if k.Equals(env.address) && ed25519.Verify(ed25519.PublicKey(k.Bytes()), msg, tx.Signatures[i][:]) {
				buyerSigned = true
			}
		}
		if !buyerSigned {
			t.Errorf("funding tx not signed by the managed wallet")
		}
		sig := tx.Signatures[0].String()
		pt := env.pending[sig]
		if pt.fund > 0 {
			env.sends = append(env.sends, pt.fund)
			env.balances[env.address.String()] += pt.fund
		}
		env.escrows = append(env.escrows, pt.params)
		env.landed[sig] = true
		return nil
	}
	fiatSigStatus = func(_ context.Context, sig string) (bool, bool, error) {
		env.mu.Lock()
		defer env.mu.Unlock()
		return env.landed[sig], env.landed[sig], nil
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) { c.Set("userID", env.userID.String()); c.Next() })
	r.POST("/orders/:id/pay/paystack", quotePaystackPayment)
	r.POST("/orders/:id/pay/paystack/verify", verifyPaystackPayment)
	r.POST("/orders/:id/pay/balance", payOrderFromManagedBalance)
	r.POST("/webhooks/paystack", handlePaystackWebhook)
	r.POST("/orders/:id/cancel", cancelOrder)
	r.GET("/listings/:id/paystack-preview", previewPaystackPrice)
	r.GET("/listings/:id/checkout-preview", previewManagedCheckout)
	env.router = r
	return env
}

func (e *fiatTestEnv) post(t *testing.T, path, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	e.router.ServeHTTP(w, req)
	out := map[string]any{}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w, out
}

func (e *fiatTestEnv) quote(t *testing.T) map[string]any {
	t.Helper()
	w, out := e.post(t, "/orders/"+e.order.ID.String()+"/pay/paystack", `{}`)
	if w.Code != http.StatusOK {
		t.Fatalf("quote: %d %s", w.Code, w.Body.String())
	}
	return out
}

func (e *fiatTestEnv) markPaid(ref string, amount int64, currency string) {
	e.mu.Lock()
	e.paystack[ref] = &paystack.Transaction{ID: 77, Status: "success", Reference: ref, Amount: amount, Currency: currency}
	e.mu.Unlock()
}

func (e *fiatTestEnv) payment(t *testing.T, ref string) models.FiatPayment {
	t.Helper()
	var p models.FiatPayment
	if err := db.DB.Where("reference = ?", ref).First(&p).Error; err != nil {
		t.Fatal(err)
	}
	return p
}

func TestFiatQuoteChargesShortfallInGHS(t *testing.T) {
	env := setupFiatTest(t)
	// Wallet already holds 0.005 SOL of leftover credit.
	env.balances[env.address.String()] = 5_000_000

	out := env.quote(t)
	// needed = 0.02 SOL escrow + 0.002 escrow rent + 0.00002 fees + 0.00089088 wallet
	// rent reserve = 22_910_880; shortfall = 17_910_880
	// GHS = 0.01791088 SOL * $100 * 12 = 21.493 -> 2150 pesewas (rounded up)
	if out["amount_minor"].(float64) != 2150 || out["currency"] != "GHS" {
		t.Fatalf("quote = %v", out)
	}
	p := env.payment(t, out["reference"].(string))
	if p.LamportsNeeded != 17_910_880 || p.Status != models.FiatPaymentQuoted || p.AccessCode == "" {
		t.Fatalf("row = %+v", p)
	}

	// Reopening the popup reuses the same quote.
	again := env.quote(t)
	if again["reference"] != out["reference"] {
		t.Fatalf("expected quote reuse, got %v then %v", out["reference"], again["reference"])
	}
}

func TestFiatPaymentRunsToActiveAndIsIdempotent(t *testing.T) {
	env := setupFiatTest(t)
	out := env.quote(t)
	ref := out["reference"].(string)
	amount := int64(out["amount_minor"].(float64))

	// Not paid yet: nothing moves.
	w, _ := env.post(t, "/orders/"+env.order.ID.String()+"/pay/paystack/verify", `{"reference":"`+ref+`"}`)
	if w.Code != http.StatusAccepted || len(env.sends) != 0 {
		t.Fatalf("unpaid verify: %d sends=%d", w.Code, len(env.sends))
	}

	env.markPaid(ref, amount, "GHS")
	w, resp := env.post(t, "/orders/"+env.order.ID.String()+"/pay/paystack/verify", `{"reference":"`+ref+`"}`)
	if w.Code != http.StatusOK || resp["status"] != string(models.FiatPaymentActive) {
		t.Fatalf("verify: %d %s", w.Code, w.Body.String())
	}
	p := env.payment(t, ref)
	// One transaction both funds the wallet and opens the escrow.
	if p.FundingTx == "" || p.EscrowTx != p.FundingTx || p.LamportsFunded != p.LamportsNeeded || env.builds != 1 {
		t.Fatalf("row = %+v", p)
	}
	if len(env.escrows) != 1 || !env.escrows[0].Buyer.Equals(env.address) ||
		env.escrows[0].AmountLamports != 20_000_000 || env.escrows[0].LimitUnits != solana.LimitUnitsFromGiB(2) {
		t.Fatalf("escrow params = %+v", env.escrows)
	}
	var order models.Order
	db.DB.First(&order, "id = ?", env.order.ID)
	if order.Status != models.OrderStatusActive {
		t.Fatalf("order status = %s", order.Status)
	}

	// Replays (webhook + browser + reconciler) do nothing more.
	for i := 0; i < 3; i++ {
		if _, err := processFiatPayment(context.Background(), ref); err != nil {
			t.Fatalf("replay %d: %v", i, err)
		}
	}
	if len(env.sends) != 1 || len(env.escrows) != 1 {
		t.Fatalf("replay moved money: sends=%d escrows=%d", len(env.sends), len(env.escrows))
	}
}

func TestFiatAmountMismatchIsRefundedNeverFunded(t *testing.T) {
	env := setupFiatTest(t)
	out := env.quote(t)
	ref := out["reference"].(string)
	env.markPaid(ref, int64(out["amount_minor"].(float64))-1, "GHS")

	if _, err := processFiatPayment(context.Background(), ref); err == nil {
		t.Fatal("expected mismatch error")
	}
	if p := env.payment(t, ref); p.Status != models.FiatPaymentRefunded {
		t.Fatalf("status = %s", p.Status)
	}
	if len(env.sends) != 0 || len(env.refunds) != 1 {
		t.Fatalf("sends=%d refunds=%d", len(env.sends), len(env.refunds))
	}
}

func TestFiatResumesAfterEscrowFailureWithoutResending(t *testing.T) {
	env := setupFiatTest(t)
	out := env.quote(t)
	ref := out["reference"].(string)
	env.markPaid(ref, int64(out["amount_minor"].(float64)), "GHS")
	env.escrowErr = errors.New("rpc blip")

	if _, err := processFiatPayment(context.Background(), ref); err == nil {
		t.Fatal("expected escrow failure")
	}
	if p := env.payment(t, ref); p.Status != models.FiatPaymentPaid || p.Attempts != 1 || p.FundingTx != "" {
		t.Fatalf("after failure: status=%s attempts=%d", p.Status, p.Attempts)
	}

	env.escrowErr = nil
	if p, err := processFiatPayment(context.Background(), ref); err != nil || p.Status != models.FiatPaymentActive {
		t.Fatalf("resume: %v %+v", err, p)
	}
	if len(env.sends) != 1 {
		t.Fatalf("treasury sent %d times, want 1", len(env.sends))
	}
}

func TestFiatPaidRowSkipsSendWhenWalletAlreadyFunded(t *testing.T) {
	env := setupFiatTest(t)
	out := env.quote(t)
	ref := out["reference"].(string)
	p := env.payment(t, ref)
	// Simulate: transfer landed on chain but the process died before recording it.
	db.DB.Model(&models.FiatPayment{}).Where("id = ?", p.ID).Update("status", models.FiatPaymentPaid)
	env.balances[env.address.String()] = 22_910_880

	if p, err := processFiatPayment(context.Background(), ref); err != nil || p.Status != models.FiatPaymentActive {
		t.Fatalf("process: %v", err)
	}
	if len(env.sends) != 0 {
		t.Fatalf("sent SOL again: %v", env.sends)
	}
}

// Crash after the funding tx was signed, recorded and landed: resume without a new tx.
func TestFiatResumesAfterCrashWithoutSecondFunding(t *testing.T) {
	env := setupFiatTest(t)
	out := env.quote(t)
	ref := out["reference"].(string)
	p := env.payment(t, ref)
	now := time.Now().UTC()
	db.DB.Model(&models.FiatPayment{}).Where("id = ?", p.ID).Updates(map[string]any{
		"status": models.FiatPaymentPaid, "funding_tx": "LandedFundingSig", "funding_sent_at": now,
	})
	env.landed["LandedFundingSig"] = true

	if got, err := processFiatPayment(context.Background(), ref); err != nil || got.Status != models.FiatPaymentActive {
		t.Fatalf("resume: %v", err)
	}
	if env.builds != 0 || len(env.sends) != 0 {
		t.Fatalf("funded again: builds=%d sends=%v", env.builds, env.sends)
	}
}

// A funding tx never seen after the blockhash expired is re-signed once.
func TestFiatDroppedFundingIsResigned(t *testing.T) {
	env := setupFiatTest(t)
	out := env.quote(t)
	ref := out["reference"].(string)
	p := env.payment(t, ref)
	old := time.Now().UTC().Add(-3 * time.Minute)
	db.DB.Model(&models.FiatPayment{}).Where("id = ?", p.ID).Updates(map[string]any{
		"status": models.FiatPaymentPaid, "funding_tx": "NeverLandedSig", "funding_sent_at": old,
	})

	if got, err := processFiatPayment(context.Background(), ref); err != nil || got.Status != models.FiatPaymentActive {
		t.Fatalf("resign: %v", err)
	}
	if env.builds != 1 || len(env.sends) != 1 {
		t.Fatalf("expected one new funding tx: builds=%d sends=%v", env.builds, env.sends)
	}
}

// A funded payment whose wallet is slightly short (rent/fees moved, or a payment made
// before the wallet rent reserve existed) is topped up from the float, then escrowed.
func TestFiatFundedSmallGapIsToppedUp(t *testing.T) {
	env := setupFiatTest(t)
	out := env.quote(t)
	ref := out["reference"].(string)
	p := env.payment(t, ref)
	db.DB.Model(&models.FiatPayment{}).Where("id = ?", p.ID).Update("status", models.FiatPaymentFunded)
	env.balances[env.address.String()] = 22_910_880 - 890_880

	if got, err := processFiatPayment(context.Background(), ref); err != nil || got.Status != models.FiatPaymentActive {
		t.Fatalf("process: %v", err)
	}
	if len(env.sends) != 1 || env.sends[0] != 890_880 || len(env.escrows) != 1 {
		t.Fatalf("sends=%v escrows=%d", env.sends, len(env.escrows))
	}
}

func TestFiatFundedLargeGapIsNotToppedUp(t *testing.T) {
	env := setupFiatTest(t)
	out := env.quote(t)
	ref := out["reference"].(string)
	p := env.payment(t, ref)
	db.DB.Model(&models.FiatPayment{}).Where("id = ?", p.ID).Update("status", models.FiatPaymentFunded)
	env.balances[env.address.String()] = 1_000_000

	if _, err := processFiatPayment(context.Background(), ref); err == nil {
		t.Fatal("expected a large gap to need review")
	}
	if len(env.sends) != 0 || len(env.escrows) != 0 {
		t.Fatalf("money moved: sends=%v escrows=%d", env.sends, len(env.escrows))
	}
}

func TestFiatSecondPaymentForSameOrderIsRefunded(t *testing.T) {
	env := setupFiatTest(t)
	first := env.quote(t)
	ref1 := first["reference"].(string)
	// A second quote row for the same order (e.g. after the reuse window).
	db.DB.Model(&models.FiatPayment{}).Where("reference = ?", ref1).Update("created_at", gorm.Expr("NOW() - INTERVAL '1 hour'"))
	second := env.quote(t)
	ref2 := second["reference"].(string)
	if ref1 == ref2 {
		t.Fatal("expected a fresh quote")
	}
	env.markPaid(ref1, int64(first["amount_minor"].(float64)), "GHS")
	env.markPaid(ref2, int64(second["amount_minor"].(float64)), "GHS")

	if _, err := processFiatPayment(context.Background(), ref1); err != nil {
		t.Fatalf("first: %v", err)
	}
	if _, err := processFiatPayment(context.Background(), ref2); !errors.Is(err, errFiatOrderSettled) {
		t.Fatalf("second: want errFiatOrderSettled, got %v", err)
	}
	if p := env.payment(t, ref2); p.Status != models.FiatPaymentRefunded {
		t.Fatalf("second status = %s", p.Status)
	}
	if len(env.sends) != 1 {
		t.Fatalf("sends = %d, want 1", len(env.sends))
	}
}

func TestFiatPayFromBalanceSkipsPaystack(t *testing.T) {
	env := setupFiatTest(t)
	env.balances[env.address.String()] = 50_000_000

	out := env.quote(t)
	if out["pay_from_balance"] != true {
		t.Fatalf("expected pay_from_balance, got %v", out)
	}
	w, _ := env.post(t, "/orders/"+env.order.ID.String()+"/pay/balance", `{}`)
	if w.Code != http.StatusOK || len(env.escrows) != 1 || len(env.sends) != 0 {
		t.Fatalf("pay/balance: %d %s escrows=%d sends=%d", w.Code, w.Body.String(), len(env.escrows), len(env.sends))
	}
}

func TestFiatRejectsWalletUsersAndDisabledFlag(t *testing.T) {
	env := setupFiatTest(t)
	// Primary wallet is now a Phantom wallet, not the managed one.
	db.DB.Model(&models.LinkedWallet{}).Where("user_id = ?", env.userID).Update("is_primary", false)
	db.DB.Create(&models.LinkedWallet{ID: uuid.New(), UserID: env.userID, Chain: models.ChainSolana,
		Address: sol.NewWallet().PublicKey().String(), Verified: true, IsPrimary: true})
	w, out := env.post(t, "/orders/"+env.order.ID.String()+"/pay/paystack", `{}`)
	if w.Code != http.StatusBadRequest || out["code"] != "not_managed_wallet" {
		t.Fatalf("phantom primary: %d %v", w.Code, out)
	}

	t.Setenv("FIAT_PAYMENTS_ENABLED", "false")
	w, out = env.post(t, "/orders/"+env.order.ID.String()+"/pay/paystack", `{}`)
	if w.Code != http.StatusServiceUnavailable || out["code"] != "fiat_disabled" {
		t.Fatalf("disabled: %d %v", w.Code, out)
	}
}

func TestFiatGivesUpWithRefundBeforeFunding(t *testing.T) {
	env := setupFiatTest(t)
	out := env.quote(t)
	ref := out["reference"].(string)
	p := env.payment(t, ref)
	db.DB.Model(&models.FiatPayment{}).Where("id = ?", p.ID).Updates(map[string]any{"status": models.FiatPaymentPaid, "attempts": fiatMaxAttempts})
	p = env.payment(t, ref)

	giveUpFiatPayment(context.Background(), &p)
	if got := env.payment(t, ref); got.Status != models.FiatPaymentRefunded || len(env.refunds) != 1 {
		t.Fatalf("status=%s refunds=%d", got.Status, len(env.refunds))
	}
}

func TestPaystackWebhookRejectsBadSignature(t *testing.T) {
	env := setupFiatTest(t)
	w, _ := env.post(t, "/webhooks/paystack", `{"event":"charge.success","data":{"reference":"x"}}`)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("unsigned webhook: %d", w.Code)
	}
}
