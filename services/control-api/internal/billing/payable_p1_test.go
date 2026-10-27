package billing

import (
	"context"
	"testing"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func seedPayableProvider(t *testing.T, balanceLamports, payableLamports int64, auto bool) *models.User {
	t.Helper()
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("p1-payable"), "provider")
	addr := "PayableWallet1111111111111111111111111111"
	user.WalletAddress = &addr
	if err := db.DB.Save(&user).Error; err != nil {
		t.Fatal(err)
	}
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatal(err)
	}
	wallet.BalanceLamports = balanceLamports
	wallet.BalanceSOL = models.LamportsToSOL(uint64(balanceLamports))
	wallet.EarningsPayableLamports = payableLamports
	wallet.AutoPayoutEnabled = auto
	wallet.AutoPayoutThresholdLamports = 50_000_000
	if err := db.DB.Save(&wallet).Error; err != nil {
		t.Fatal(err)
	}
	return user
}

// W-10 regression: a payout sweeps ONLY payable earnings. The old code
// debited wallet.BalanceSOL - the provider's entire balance including
// buyer funds they had deposited to spend.
func TestQueueProviderPayout_P1_SweepsPayableOnly(t *testing.T) {
	testutil.SetupTestDB(t)
	migratePayoutTables(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "pending_payouts", "ledger_journals", "ledger_journal_lines")
	withTestBatchProcessor(t, func(ctx context.Context, items []models.BatchPayoutItem) (string, error) {
		return "unused", nil
	})

	user := seedPayableProvider(t, 5_000_000_000, 200_000_000, false)

	payoutID, paid, err := QueueProviderPayoutAmount(user.ID, 0)
	if err != nil {
		t.Fatalf("claim all payable: %v", err)
	}
	if paid != 200_000_000 {
		t.Fatalf("paid = %d, want payable only 200_000_000", paid)
	}
	var wallet models.Wallet
	db.DB.Where("user_id = ?", user.ID).First(&wallet)
	if wallet.BalanceLamports != 4_800_000_000 {
		t.Fatalf("buyer funds swept: balance %d, want 4_800_000_000", wallet.BalanceLamports)
	}
	if wallet.EarningsPayableLamports != 0 {
		t.Fatalf("payable must be zero after full claim, got %d", wallet.EarningsPayableLamports)
	}
	var pending models.PendingPayout
	if err := db.DB.Where("idempotency_key = ?", payoutID.String()).First(&pending).Error; err != nil {
		t.Fatalf("pending payout row: %v", err)
	}
	if pending.AmountSOL != 0.2 {
		t.Fatalf("pending amount = %v, want 0.2", pending.AmountSOL)
	}

	// Partial claim respects the requested amount.
	user2 := seedPayableProvider(t, 1_000_000_000, 300_000_000, false)
	if _, paid2, err := QueueProviderPayoutAmount(user2.ID, 100_000_000); err != nil || paid2 != 100_000_000 {
		t.Fatalf("partial claim: %d %v", paid2, err)
	}
	var wallet2 models.Wallet
	db.DB.Where("user_id = ?", user2.ID).First(&wallet2)
	if wallet2.BalanceLamports != 900_000_000 || wallet2.EarningsPayableLamports != 200_000_000 {
		t.Fatalf("after partial: balance=%d payable=%d", wallet2.BalanceLamports, wallet2.EarningsPayableLamports)
	}

	// Claiming more than payable is refused - buyer funds are untouchable.
	if _, _, err := QueueProviderPayoutAmount(user2.ID, 900_000_000); err == nil {
		t.Fatal("claim above payable must fail even though balance covers it")
	}
}

// W-10: with auto-payout disabled (the default), earning credits never
// signal a sweep; opt-in providers sweep once payable crosses threshold.
func TestCreditProviderWallet_P1_AutoPayoutOptIn(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "sessions", "proxy_listings", "provider_scores", "ledger_journals", "ledger_journal_lines")

	for _, tc := range []struct {
		name string
		auto bool
		want bool
	}{
		{"manual_default_never_sweeps", false, false},
		{"opted_in_sweeps_at_threshold", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			user := seedPayableProvider(t, 0, 40_000_000, tc.auto) // 0.04 payable
			// Balance must cover payable invariant for seeding realism.
			db.DB.Model(&models.Wallet{}).Where("user_id = ?", user.ID).
				Update("balance_lamports", 40_000_000)
			listing := models.ProxyListing{SellerID: user.ID, Title: "P1 auto", PricePerGB: 0.5, AvailableBandwidthGB: 100, Status: "active"}
			if err := db.DB.Create(&listing).Error; err != nil {
				t.Fatal(err)
			}
			session := models.Session{Listing: &listing}
			var shouldQueue bool
			tx := db.DB.Begin()
			defer tx.Rollback()
			// +0.02 SOL earning -> payable 0.06 >= 0.05 threshold.
			var err error
			shouldQueue, _, err = creditProviderWallet(tx, &session, 1_000_000, 20_000_000, 0.02, session.ID.String()+":provider:test")
			if err != nil {
				t.Fatalf("creditProviderWallet: %v", err)
			}
			if shouldQueue != tc.want {
				t.Fatalf("shouldQueue=%v want %v", shouldQueue, tc.want)
			}
			var wallet models.Wallet
			tx.Where("user_id = ?", user.ID).First(&wallet)
			if wallet.EarningsPayableLamports != 60_000_000 {
				t.Fatalf("earning credit must raise payable: %d", wallet.EarningsPayableLamports)
			}
		})
	}
}
