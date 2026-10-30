package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
)

func (e *fiatTestEnv) orderStatus(t *testing.T) models.OrderStatus {
	t.Helper()
	var o models.Order
	if err := db.DB.First(&o, "id = ?", e.order.ID).Error; err != nil {
		t.Fatal(err)
	}
	return o.Status
}

func TestFiatQuoteBlockedWhenEscrowAlreadyOpen(t *testing.T) {
	env := setupFiatTest(t)
	env.escrowSet = true

	w, out := env.post(t, "/orders/"+env.order.ID.String()+"/pay/paystack", `{}`)
	if w.Code != http.StatusConflict || out["code"] != "active_plan_exists" {
		t.Fatalf("quote: %d %s", w.Code, w.Body.String())
	}
	if env.inits != 0 {
		t.Fatalf("Paystack was initialized %d times; no charge may start", env.inits)
	}
	if s := env.orderStatus(t); s != models.OrderStatusCancelled {
		t.Fatalf("order status = %s, want cancelled", s)
	}
}

func TestFiatEarlierPlansEscrowIsRefundedNotReused(t *testing.T) {
	env := setupFiatTest(t)
	out := env.quote(t)
	ref := out["reference"].(string)
	env.markPaid(ref, int64(out["amount_minor"].(float64)), "GHS")
	// The escrow address already holds an earlier plan, opened before this payment.
	fiatFetchEscrow = func(context.Context, sol.PublicKey) *solana.Escrow {
		return &solana.Escrow{Amount: 1_000_000, Status: solana.EscrowActive, CreatedAt: time.Now().Add(-2 * time.Hour).Unix()}
	}

	if _, err := processFiatPayment(context.Background(), ref); !errors.Is(err, errFiatOrderSettled) {
		t.Fatalf("want errFiatOrderSettled, got %v", err)
	}
	if p := env.payment(t, ref); p.Status != models.FiatPaymentRefunded {
		t.Fatalf("payment status = %s, want refunded", p.Status)
	}
	if len(env.refunds) != 1 || len(env.sends) != 0 || env.builds != 0 {
		t.Fatalf("refunds=%v sends=%v builds=%d", env.refunds, env.sends, env.builds)
	}
	if s := env.orderStatus(t); s != models.OrderStatusCancelled {
		t.Fatalf("order status = %s, want cancelled", s)
	}

	w, body := env.post(t, "/orders/"+env.order.ID.String()+"/pay/paystack/verify", `{"reference":"`+ref+`"}`)
	if w.Code != http.StatusOK || body["status"] != string(models.FiatPaymentRefunded) || body["message"] == nil {
		t.Fatalf("verify after refund: %d %s", w.Code, w.Body.String())
	}
}

func TestFiatEscrowOpenedByThisPaymentIsUsed(t *testing.T) {
	env := setupFiatTest(t)
	out := env.quote(t)
	ref := out["reference"].(string)
	env.markPaid(ref, int64(out["amount_minor"].(float64)), "GHS")
	fiatFetchEscrow = func(context.Context, sol.PublicKey) *solana.Escrow {
		return &solana.Escrow{Amount: 1_000_000, Status: solana.EscrowPending, CreatedAt: time.Now().Unix()}
	}

	p, err := processFiatPayment(context.Background(), ref)
	if err != nil || p.Status != models.FiatPaymentActive || len(env.refunds) != 0 {
		t.Fatalf("status=%v err=%v refunds=%v", p.Status, err, env.refunds)
	}
}

func TestFiatAbandonedCheckoutExpires(t *testing.T) {
	env := setupFiatTest(t)
	ref := env.quote(t)["reference"].(string)
	db.DB.Model(&models.FiatPayment{}).Where("reference = ?", ref).Update("created_at", gorm.Expr("NOW() - INTERVAL '1 hour'"))

	reconcileFiatPayments(context.Background())

	if p := env.payment(t, ref); p.Status != models.FiatPaymentFailed {
		t.Fatalf("payment status = %s, want failed", p.Status)
	}
	if s := env.orderStatus(t); s != models.OrderStatusCancelled {
		t.Fatalf("order status = %s, want cancelled", s)
	}
}

func TestFiatLatePaidCheckoutIsFinishedNotExpired(t *testing.T) {
	env := setupFiatTest(t)
	out := env.quote(t)
	ref := out["reference"].(string)
	db.DB.Model(&models.FiatPayment{}).Where("reference = ?", ref).Update("created_at", gorm.Expr("NOW() - INTERVAL '1 hour'"))
	env.markPaid(ref, int64(out["amount_minor"].(float64)), "GHS")

	reconcileFiatPayments(context.Background())

	if len(env.async) != 1 || env.async[0] != ref {
		t.Fatalf("expected the paid checkout to be processed, got %v", env.async)
	}
	if s := env.orderStatus(t); s == models.OrderStatusCancelled {
		t.Fatal("a paid order must not be cancelled")
	}
}

func TestCancelUnpaidFiatOrder(t *testing.T) {
	env := setupFiatTest(t)
	ref := env.quote(t)["reference"].(string)
	prev := pendingEscrowFunded
	pendingEscrowFunded = func(context.Context, sol.PublicKey) (bool, bool) { return false, true }
	t.Cleanup(func() { pendingEscrowFunded = prev })

	w, _ := env.post(t, "/orders/"+env.order.ID.String()+"/cancel", `{}`)
	if w.Code != http.StatusOK {
		t.Fatalf("cancel: %d %s", w.Code, w.Body.String())
	}
	if p := env.payment(t, ref); p.Status != models.FiatPaymentFailed {
		t.Fatalf("payment status = %s, want failed", p.Status)
	}
	if s := env.orderStatus(t); s != models.OrderStatusCancelled {
		t.Fatalf("order status = %s, want cancelled", s)
	}
}

func TestCancelRefusedWhenPaystackSaysPaid(t *testing.T) {
	env := setupFiatTest(t)
	out := env.quote(t)
	ref := out["reference"].(string)
	env.markPaid(ref, int64(out["amount_minor"].(float64)), "GHS")

	w, body := env.post(t, "/orders/"+env.order.ID.String()+"/cancel", `{}`)
	if w.Code != http.StatusConflict || body["code"] != "payment_in_progress" {
		t.Fatalf("cancel: %d %s", w.Code, w.Body.String())
	}
	if len(env.async) != 1 {
		t.Fatalf("expected the payment to be finished, got %v", env.async)
	}
	if s := env.orderStatus(t); s == models.OrderStatusCancelled {
		t.Fatal("a paid order must not be cancelled")
	}
}

func TestPaystackPreviewMatchesQuote(t *testing.T) {
	env := setupFiatTest(t)
	listing := models.ProxyListing{
		ID: env.order.ListingID, SellerID: env.order.SellerID, Title: "Preview listing",
		PricePerGB: 1, AvailableBandwidthGB: 100, Status: models.ListingStatusActive,
	}
	if err := db.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL session_replication_role = 'replica'").Error; err != nil {
			return err
		}
		return tx.Create(&listing).Error
	}); err != nil {
		t.Fatalf("listing: %v", err)
	}

	preview := env.get(t, "/listings/"+listing.ID.String()+"/paystack-preview?gb=2")
	quote := env.quote(t)
	if preview["active_plan"] != false || preview["amount_ghs"] != quote["amount_ghs"] {
		t.Fatalf("preview %v != quote %v", preview, quote)
	}
}

func TestPaystackPreviewReportsActivePlan(t *testing.T) {
	env := setupFiatTest(t)
	listing := models.ProxyListing{
		ID: uuid.New(), SellerID: env.order.SellerID, Title: "Preview listing",
		PricePerGB: 1, AvailableBandwidthGB: 100, Status: models.ListingStatusActive,
	}
	if err := db.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL session_replication_role = 'replica'").Error; err != nil {
			return err
		}
		if err := tx.Create(&listing).Error; err != nil {
			return err
		}
		return tx.Model(&models.Order{}).Where("id = ?", env.order.ID).
			Updates(map[string]any{"status": models.OrderStatusActive, "escrow_seed_kind": "legacy"}).Error
	}); err != nil {
		t.Fatalf("setup: %v", err)
	}

	preview := env.get(t, "/listings/"+listing.ID.String()+"/paystack-preview?gb=2")
	if preview["active_plan"] != true || preview["active_plan_order_id"] != env.order.ID.String() {
		t.Fatalf("preview = %v", preview)
	}
}

func TestActivePlanWithSeller(t *testing.T) {
	env := setupFiatTest(t)
	if o, err := activePlanWithSeller(db.DB, env.userID, env.order.SellerID); err != nil || o != nil {
		t.Fatalf("pending order counted as a plan: %v %v", o, err)
	}
	db.DB.Model(&models.Order{}).Where("id = ?", env.order.ID).Update("status", models.OrderStatusActive)
	if o, err := activePlanWithSeller(db.DB, env.userID, env.order.SellerID); err != nil || o == nil || o.ID != env.order.ID {
		t.Fatalf("active order not found: %v %v", o, err)
	}
	if o, _ := activePlanWithSeller(db.DB, env.userID, uuid.New()); o != nil {
		t.Fatal("plan reported for another seller")
	}
}

func (e *fiatTestEnv) get(t *testing.T, path string) map[string]any {
	t.Helper()
	w := httptest.NewRecorder()
	e.router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("GET %s: %d %s", path, w.Code, w.Body.String())
	}
	out := map[string]any{}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}
