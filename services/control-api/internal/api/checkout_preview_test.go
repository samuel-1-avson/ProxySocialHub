package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// SOL-first checkout for managed-wallet (Google sign-in) buyers. SOL in the
// ProxyHubb wallet is the main way to pay; card and mobile money only top up
// what is missing, and must never block the SOL path.

// previewListing stores an active listing for the test order's seller.
func previewListing(t *testing.T, env *fiatTestEnv) models.ProxyListing {
	t.Helper()
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
	return listing
}

// requiredLamports is what the managed wallet must hold for `usd` of bandwidth.
func requiredLamports(usd float64) uint64 {
	return models.SOLToLamports(usd/fiatTestSOLUSD) + fiatTestRent + fiatFeeBufferLamports + rentExemptMinLamports
}

func TestCheckoutPreviewWorksWithCardPaymentsOff(t *testing.T) {
	env := setupFiatTest(t)
	t.Setenv("FIAT_PAYMENTS_ENABLED", "false")
	listing := previewListing(t, env)

	out := env.get(t, "/listings/"+listing.ID.String()+"/checkout-preview?gb=2")
	if out["active_plan"] != false || out["fiat_enabled"] != false {
		t.Fatalf("preview = %v", out)
	}
	if out["pay_from_balance"] != false {
		t.Fatalf("an empty wallet cannot pay from balance: %v", out)
	}
	// 2 GB at $1/GB = $2 = 0.02 SOL at $100.
	if out["amount_sol"] != 0.02 {
		t.Fatalf("amount_sol = %v, want 0.02", out["amount_sol"])
	}
	if want := models.LamportsToSOL(requiredLamports(2)); out["required_sol"] != want || out["shortfall_sol"] != want {
		t.Fatalf("required/shortfall = %v/%v, want %v", out["required_sol"], out["shortfall_sol"], want)
	}
	if out["wallet_address"] != env.address.String() {
		t.Fatalf("wallet_address = %v, want %s", out["wallet_address"], env.address)
	}
	if _, ok := out["amount_ghs"]; ok {
		t.Fatalf("no GHS price while card payments are off: %v", out)
	}

	// The card-only preview older web builds call keeps its old answer.
	w := httptest.NewRecorder()
	env.router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/listings/"+listing.ID.String()+"/paystack-preview?gb=2", nil))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("paystack-preview with fiat off: %d %s", w.Code, w.Body.String())
	}
}

func TestCheckoutPreviewPaysFromSOLBalance(t *testing.T) {
	env := setupFiatTest(t)
	t.Setenv("FIAT_PAYMENTS_ENABLED", "false")
	listing := previewListing(t, env)
	env.balances[env.address.String()] = requiredLamports(2)

	out := env.get(t, "/listings/"+listing.ID.String()+"/checkout-preview?gb=2")
	if out["pay_from_balance"] != true || out["shortfall_sol"] != 0.0 {
		t.Fatalf("a wallet holding exactly the required SOL must pay from balance: %v", out)
	}
	env.balances[env.address.String()] = requiredLamports(2) - 1
	out = env.get(t, "/listings/"+listing.ID.String()+"/checkout-preview?gb=2")
	if out["pay_from_balance"] != false || out["shortfall_sol"] != models.LamportsToSOL(1) {
		t.Fatalf("one lamport short: %v", out)
	}
}

// The SOL path (pay/balance) must not depend on card payments being enabled.
func TestPayFromSOLBalanceWithCardPaymentsOff(t *testing.T) {
	env := setupFiatTest(t)
	t.Setenv("FIAT_PAYMENTS_ENABLED", "false")
	env.balances[env.address.String()] = 50_000_000

	w, _ := env.post(t, "/orders/"+env.order.ID.String()+"/pay/balance", `{}`)
	if w.Code != http.StatusOK || len(env.escrows) != 1 || len(env.sends) != 0 || env.inits != 0 {
		t.Fatalf("pay/balance: %d %s escrows=%d sends=%d paystack=%d", w.Code, w.Body.String(), len(env.escrows), len(env.sends), env.inits)
	}
	if s := env.orderStatus(t); s != models.OrderStatusActive {
		t.Fatalf("order status = %s, want active", s)
	}
}

func TestPayFromSOLBalanceRefusesShortWallet(t *testing.T) {
	env := setupFiatTest(t)
	t.Setenv("FIAT_PAYMENTS_ENABLED", "false")
	env.balances[env.address.String()] = 1_000_000

	w, out := env.post(t, "/orders/"+env.order.ID.String()+"/pay/balance", `{}`)
	if w.Code != http.StatusPaymentRequired || out["code"] != "insufficient_balance" || len(env.escrows) != 0 {
		t.Fatalf("short wallet: %d %v escrows=%d", w.Code, out, len(env.escrows))
	}
}

func TestCheckoutPreviewPricesOnlyTheShortfallInGHS(t *testing.T) {
	env := setupFiatTest(t)
	listing := previewListing(t, env)
	// Half of the escrow is already in the wallet, so card pays only for the rest.
	env.balances[env.address.String()] = rentExemptMinLamports + 10_000_000

	out := env.get(t, "/listings/"+listing.ID.String()+"/checkout-preview?gb=2")
	legacy := env.get(t, "/listings/"+listing.ID.String()+"/paystack-preview?gb=2")
	if out["fiat_enabled"] != true || out["pay_from_balance"] != false {
		t.Fatalf("preview = %v", out)
	}
	if out["amount_ghs"] == nil || out["amount_ghs"] != legacy["amount_ghs"] || out["credit_ghs"] != legacy["credit_ghs"] {
		t.Fatalf("GHS price must match the card quote: new %v, old %v", out, legacy)
	}
	quote := env.quote(t)
	if quote["amount_ghs"] != out["amount_ghs"] {
		t.Fatalf("preview %v != quote %v", out["amount_ghs"], quote["amount_ghs"])
	}
}

func TestCheckoutPreviewReportsActivePlan(t *testing.T) {
	env := setupFiatTest(t)
	t.Setenv("FIAT_PAYMENTS_ENABLED", "false")
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

	out := env.get(t, "/listings/"+listing.ID.String()+"/checkout-preview?gb=2")
	if out["active_plan"] != true || out["active_plan_order_id"] != env.order.ID.String() || out["fiat_enabled"] != false {
		t.Fatalf("preview = %v", out)
	}
}
