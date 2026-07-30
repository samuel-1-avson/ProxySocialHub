package fsm

import (
	"strings"
	"testing"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestAssertCreatableStatus(t *testing.T) {
	ok := []models.OrderStatus{
		models.OrderStatusPending,
		models.OrderStatusPendingPayment,
		models.OrderStatusActive,
	}
	for _, s := range ok {
		if err := AssertCreatableStatus(s, "test.assert"); err != nil {
			t.Fatalf("AssertCreatableStatus(%q): %v", s, err)
		}
	}
	blocked := []models.OrderStatus{
		models.OrderStatusCompleted,
		models.OrderStatusDisputed,
		models.OrderStatusRefunded,
		models.OrderStatusCancelled,
	}
	for _, s := range blocked {
		if err := AssertCreatableStatus(s, "test.assert"); err == nil {
			t.Fatalf("AssertCreatableStatus(%q) expected error", s)
		}
	}
}

func TestTransitionOrderRejectsIllegal(t *testing.T) {
	order := &models.Order{Status: models.OrderStatusCompleted}
	err := TransitionOrder(nil, order, models.OrderStatusActive, "test.reject", nil)
	if err == nil {
		t.Fatal("expected illegal transition error")
	}
	if !strings.Contains(err.Error(), "invalid order status transition") {
		t.Fatalf("unexpected error: %v", err)
	}
	if order.Status != models.OrderStatusCompleted {
		t.Fatalf("status mutated on failed transition: %s", order.Status)
	}
}

func TestTransitionOrderNilOrder(t *testing.T) {
	if err := TransitionOrder(nil, nil, models.OrderStatusActive, "test.nil", nil); err == nil {
		t.Fatal("expected nil order error")
	}
}

func TestTransitionOrderFullMatrix(t *testing.T) {
	statuses := []models.OrderStatus{
		models.OrderStatusPending,
		models.OrderStatusPendingPayment,
		models.OrderStatusActive,
		models.OrderStatusCompleted,
		models.OrderStatusDisputed,
		models.OrderStatusRefunded,
		models.OrderStatusCancelled,
	}
	for _, from := range statuses {
		for _, to := range statuses {
			want := models.CanTransitionOrderStatus(from, to)
			order := &models.Order{Status: from}
			err := TransitionOrder(nil, order, to, "test.matrix", nil)
			if want {
				if err == nil || !strings.Contains(err.Error(), "tx is nil") {
					t.Fatalf("%s -> %s: want tx is nil, got %v", from, to, err)
				}
			} else if err == nil {
				t.Fatalf("%s -> %s: expected invalid transition", from, to)
			} else if !strings.Contains(err.Error(), "invalid order status transition") {
				t.Fatalf("%s -> %s: unexpected err %v", from, to, err)
			}
		}
	}
}

func TestTransitionOrderPersists(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "proxy_listings", "orders", "wallets")

	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("fsm-buyer"), "buyer")
	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("fsm-seller"), "provider")

	listing := models.ProxyListing{
		SellerID:   seller.ID,
		Title:      "fsm-transition-listing",
		Status:     models.ListingStatusActive,
		PricePerGB: 1.0,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("create listing: %v", err)
	}

	order := models.Order{
		BuyerID:     buyer.ID,
		SellerID:    seller.ID,
		ListingID:   listing.ID,
		BandwidthGB: 1,
		PricePerGB:  1,
		TotalPrice:  1,
		Status:      models.OrderStatusPending,
	}
	if err := db.DB.Create(&order).Error; err != nil {
		t.Fatalf("create order: %v", err)
	}

	sig := "fsm-test-sig"
	if err := TransitionOrder(db.DB, &order, models.OrderStatusPendingPayment, "test.persist", map[string]interface{}{
		"tx_signature": sig,
	}); err != nil {
		t.Fatalf("transition: %v", err)
	}
	if order.Status != models.OrderStatusPendingPayment {
		t.Fatalf("in-memory status=%s", order.Status)
	}

	var reloaded models.Order
	if err := db.DB.First(&reloaded, "id = ?", order.ID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if reloaded.Status != models.OrderStatusPendingPayment {
		t.Fatalf("db status=%s", reloaded.Status)
	}
	if reloaded.TxSignature != sig {
		t.Fatalf("tx_signature=%q", reloaded.TxSignature)
	}

	if err := TransitionOrder(db.DB, &reloaded, models.OrderStatusActive, "test.persist", nil); err != nil {
		t.Fatalf("activate: %v", err)
	}
	if err := TransitionOrder(db.DB, &reloaded, models.OrderStatusCompleted, "test.persist", nil); err != nil {
		t.Fatalf("complete: %v", err)
	}
	if err := TransitionOrder(db.DB, &reloaded, models.OrderStatusActive, "test.persist", nil); err == nil {
		t.Fatal("expected completed -> active to fail")
	}
}

func TestValidateMetersIllegal(t *testing.T) {
	err := Validate(models.OrderStatusCompleted, models.OrderStatusActive, "test.validate")
	if err == nil {
		t.Fatal("expected error")
	}
}
