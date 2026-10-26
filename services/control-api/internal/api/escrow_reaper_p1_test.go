package api

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func seedStaleReleasing(t *testing.T, withPDA bool) (models.EscrowTransaction, models.Order) {
	t.Helper()
	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("reaper-buyer"), "buyer")
	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("reaper-seller"), "seller")
	listing := models.ProxyListing{SellerID: seller.ID, Title: "reaper", PricePerGB: 1, AvailableBandwidthGB: 10, Status: "active"}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatal(err)
	}
	order := models.Order{ID: uuid.New(), BuyerID: buyer.ID, SellerID: seller.ID, ListingID: listing.ID, BandwidthGB: 1, PricePerGB: 1, TotalPrice: 1, Status: models.OrderStatusActive}
	if withPDA {
		order.EscrowPDA = "EscrowPDA111111111111111111111111111111111"
		order.SellerWallet = "SellerWal111111111111111111111111111111111"
		order.BuyerWallet = "BuyerWall111111111111111111111111111111111"
	}
	if err := db.DB.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	escrow := models.EscrowTransaction{OrderID: order.ID, BuyerID: buyer.ID, SellerID: seller.ID, Amount: 1, Status: models.EscrowReleasing}
	if err := db.DB.Create(&escrow).Error; err != nil {
		t.Fatal(err)
	}
	// Backdate updated_at past the stale threshold.
	if err := db.DB.Model(&escrow).Update("updated_at", time.Now().Add(-time.Hour)).Error; err != nil {
		t.Fatal(err)
	}
	return escrow, order
}

func escrowStatus(t *testing.T, id uuid.UUID) models.EscrowStatus {
	t.Helper()
	var e models.EscrowTransaction
	if err := db.DB.First(&e, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	return e.Status
}

// W-24: escrows orphaned in `releasing` by a crash used to be stuck
// forever. Custodial ones safely return to held; PDA ones finalize only
// on proven settle, otherwise stay for ops.
func TestReapStaleReleasing_P1(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "escrow_transactions", "orders", "users", "compensation_outbox")

	custodial, _ := seedStaleReleasing(t, false)
	pdaSettled, orderSettled := seedStaleReleasing(t, true)
	pdaUnknown, _ := seedStaleReleasing(t, true)

	if err := db.DB.Create(&models.CompensationOutbox{
		Kind: models.CompensationKindEscrowSettle, UserID: orderSettled.BuyerID,
		AmountSOL: 1, ReferenceID: "escrow_settle:" + orderSettled.ID.String(),
		Status: models.CompensationStatusSucceeded, NextRetryAt: time.Now(),
	}).Error; err != nil {
		t.Fatal(err)
	}

	res := ReapStaleReleasingEscrows()

	if got := escrowStatus(t, custodial.ID); got != models.EscrowHeld {
		t.Fatalf("custodial stale releasing: got %s, want held", got)
	}
	if got := escrowStatus(t, pdaSettled.ID); got != models.EscrowReleased {
		t.Fatalf("pda settled: got %s, want released", got)
	}
	var ord models.Order
	db.DB.First(&ord, "id = ?", orderSettled.ID)
	if ord.Status != models.OrderStatusCompleted {
		t.Fatalf("finalized order status = %s, want completed", ord.Status)
	}
	if got := escrowStatus(t, pdaUnknown.ID); got != models.EscrowReleasing {
		t.Fatalf("pda unknown must stay releasing for ops, got %s", got)
	}
	if res.ReclaimedHeld != 1 || res.Finalized != 1 || res.NeedsOps != 1 {
		t.Fatalf("reap result: %+v", res)
	}
}

// W-24 precedence: the conditional dispute claim can never overwrite a
// released escrow (the old unconditional Update could).
func TestMarkEscrowDisputedTx_P1_NeverOverwritesReleased(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "escrow_transactions", "orders", "users")

	released, _ := seedStaleReleasing(t, false)
	if err := db.DB.Model(&models.EscrowTransaction{}).Where("id = ?", released.ID).
		Update("status", models.EscrowReleased).Error; err != nil {
		t.Fatal(err)
	}
	held, _ := seedStaleReleasing(t, false)
	if err := db.DB.Model(&models.EscrowTransaction{}).Where("id = ?", held.ID).
		Update("status", models.EscrowHeld).Error; err != nil {
		t.Fatal(err)
	}

	tx := db.DB.Begin()
	defer tx.Rollback()
	claimed, err := markEscrowDisputedTx(tx, released.ID)
	if err != nil || claimed {
		t.Fatalf("released escrow claim: claimed=%v err=%v", claimed, err)
	}
	claimed, err = markEscrowDisputedTx(tx, held.ID)
	if err != nil || !claimed {
		t.Fatalf("held escrow claim: claimed=%v err=%v", claimed, err)
	}
}
