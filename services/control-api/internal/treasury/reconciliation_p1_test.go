package treasury

import (
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// W-18 regression: liabilities must include every in-flight queue/hold
// in integer lamports. The old code summed float wallet balances and a
// pending_transactions query for types nothing writes anymore.
func TestComputeLiabilitiesLamports_P1_IncludesAllQueues(t *testing.T) {
	testutil.SetupTestDB(t)
	if err := db.DB.AutoMigrate(&models.PendingPayout{}, &models.BatchPayout{}, &models.PayoutRetryQueue{},
		&models.WithdrawalPayout{}, &models.CompensationOutbox{}, &models.EscrowTransaction{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	testutil.CleanupTestData(t, "escrow_transactions", "orders", "users", "wallets", "pending_payouts", "batch_payouts", "payout_retry_queue",
		"withdrawal_payout_queue", "compensation_outbox")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("recon-p1"), "buyer")
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatal(err)
	}
	wallet.BalanceLamports = 3_000_000_000
	wallet.BalanceSOL = 3
	if err := db.DB.Save(&wallet).Error; err != nil {
		t.Fatal(err)
	}

	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	// in-flight withdrawal 0.5 SOL (paying) + a completed one (excluded)
	must(db.DB.Create(&models.WithdrawalPayout{UserID: user.ID, Reference: "r1", Destination: "Dest1111111111111111111111111111111111111", AmountSOL: 0.5, Status: models.WithdrawalPayoutPaying}).Error)
	must(db.DB.Create(&models.WithdrawalPayout{UserID: user.ID, Reference: "r2", Destination: "Dest1111111111111111111111111111111111111", AmountSOL: 9, Status: models.WithdrawalPayoutCompleted}).Error)
	// queued provider payout 0.25 SOL
	must(db.DB.Create(&models.PendingPayout{ProviderID: user.ID, WalletAddress: "W111111111111111111111111111111111111111", AmountSOL: 0.25, IdempotencyKey: "k-" + uuid.NewString(), Status: models.PendingPayoutQueued}).Error)
	// retry queue 0.1 SOL pending
	must(db.DB.Create(&models.PayoutRetryQueue{ProviderID: user.ID, WalletAddress: "W111111111111111111111111111111111111111", AmountSOL: 0.1, Status: "pending"}).Error)
	// compensation 0.05 SOL pending
	must(db.DB.Create(&models.CompensationOutbox{UserID: user.ID, AmountSOL: 0.05, Status: models.CompensationStatusPending, ReferenceID: "c1", Kind: models.CompensationKindWithdrawalRefund}).Error)
	// escrow held 1.2 SOL (real FKs: seller + listing + order)
	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("recon-p1-seller"), "seller")
	must(db.DB.Model(&models.Wallet{}).Where("user_id = ?", seller.ID).
		Updates(map[string]interface{}{"balance_lamports": 0, "balance_sol": 0}).Error)
	listing := models.ProxyListing{SellerID: seller.ID, Title: "recon", PricePerGB: 1, AvailableBandwidthGB: 10, Status: "active"}
	must(db.DB.Create(&listing).Error)
	order := models.Order{ID: uuid.New(), BuyerID: user.ID, SellerID: seller.ID, ListingID: listing.ID, BandwidthGB: 1, PricePerGB: 1, TotalPrice: 1.2, Status: models.OrderStatusActive}
	must(db.DB.Create(&order).Error)
	must(db.DB.Create(&models.EscrowTransaction{OrderID: order.ID, BuyerID: user.ID, SellerID: seller.ID, Amount: 1.2, Status: models.EscrowHeld}).Error)

	b, err := ComputeLiabilitiesLamports()
	if err != nil {
		t.Fatalf("compute: %v", err)
	}
	want := int64(3_000_000_000 + 500_000_000 + 250_000_000 + 100_000_000 + 50_000_000 + 1_200_000_000)
	if b.TotalLamports != want {
		t.Fatalf("total = %d, want %d (breakdown %+v)", b.TotalLamports, want, b)
	}
	if b.WithdrawalsInFlight != 500_000_000 || b.EscrowHeldLamports != 1_200_000_000 {
		t.Fatalf("breakdown wrong: %+v", b)
	}
}
