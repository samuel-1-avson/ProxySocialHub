package treasury

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
	"gorm.io/gorm"
)

// P2-G: incremental verification only checks wallets changed since the
// watermark, and catches a corrupted balance among them.
func TestVerifyChangedWallets_P2G(t *testing.T) {
	testutil.SetupTestDB(t)
	good := testutil.CreateTestUser(t, testutil.UniqueEmail("p2g-good"), "buyer")
	bad := testutil.CreateTestUser(t, testutil.UniqueEmail("p2g-bad"), "buyer")
	stale := testutil.CreateTestUser(t, testutil.UniqueEmail("p2g-stale"), "buyer")
	// Test users are seeded with unledgered balance; start from a
	// ledger-consistent zero so only real drift is measured.
	for _, u := range []*models.User{good, bad, stale} {
		if err := db.DB.Exec(`UPDATE wallets SET balance_lamports = 0, balance_sol = 0, earnings_payable_lamports = 0 WHERE user_id = ?`, u.ID).Error; err != nil {
			t.Fatal(err)
		}
	}

	credit := func(userID uuid.UUID, sol float64) {
		t.Helper()
		err := db.DB.Transaction(func(tx *gorm.DB) error {
			w, err := models.LockWalletForUpdate(tx, userID)
			if err != nil {
				return err
			}
			return models.CreditWalletLocked(tx, w, sol, models.LedgerKindDeposit, "p2g-"+uuid.NewString(), "p2g seed")
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	credit(good.ID, 1)
	credit(bad.ID, 2)
	credit(stale.ID, 3)

	// Watermark AFTER stale's credit, then corrupt `bad` directly
	// (balance without ledger = the drift class this check exists for).
	wm := time.Now().UTC()
	// touch good+bad ledgers after watermark via tiny credits
	credit(good.ID, 0.5)
	credit(bad.ID, 0.5)
	if err := db.DB.Exec(`UPDATE wallets SET balance_lamports = balance_lamports + 777 WHERE user_id = ?`, bad.ID).Error; err != nil {
		t.Fatal(err)
	}
	// stale also corrupted but NOT changed since watermark: out of scope.
	if err := db.DB.Exec(`UPDATE wallets SET balance_lamports = balance_lamports + 999 WHERE user_id = ?`, stale.ID).Error; err != nil {
		t.Fatal(err)
	}
	// Leave global state as found: sibling tests compute global sums.
	t.Cleanup(func() {
		db.DB.Exec(`UPDATE wallets SET balance_lamports = balance_lamports - 777 WHERE user_id = ?`, bad.ID)
		db.DB.Exec(`UPDATE wallets SET balance_lamports = balance_lamports - 999 WHERE user_id = ?`, stale.ID)
		db.DB.Exec(`DELETE FROM wallet_ledger_entries WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id IN (?,?,?))`, good.ID, bad.ID, stale.ID)
		db.DB.Exec(`UPDATE wallets SET balance_lamports = 0, balance_sol = 0 WHERE user_id IN (?,?,?)`, good.ID, bad.ID, stale.ID)
	})

	inc, err := VerifyChangedWallets(wm)
	if err != nil {
		t.Fatal(err)
	}
	if len(inc.Mismatches) != 1 {
		t.Fatalf("want exactly 1 mismatch (bad wallet), got %+v", inc.Mismatches)
	}
	if inc.Mismatches[0].DiffLamports != 777 {
		t.Fatalf("diff want 777 lamports, got %d", inc.Mismatches[0].DiffLamports)
	}
}

// P2-G: watermark persists and queue stats report seeded rows.
func TestReconWatermarkAndQueueStats_P2G(t *testing.T) {
	testutil.SetupTestDB(t)
	at := time.Now().UTC().Truncate(time.Second)
	if err := SaveReconWatermark(at); err != nil {
		t.Fatal(err)
	}
	got, err := LoadReconWatermark()
	if err != nil {
		t.Fatal(err)
	}
	if !got.Equal(at) {
		t.Fatalf("watermark: got %v want %v", got, at)
	}

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("p2g-queue"), "buyer")
	// Remove only our own rows afterwards: sibling tests sum this queue.
	t.Cleanup(func() {
		db.DB.Exec(`DELETE FROM withdrawal_payout_queue WHERE reference LIKE 'p2g-%'`)
		db.DB.Exec(`UPDATE wallets SET balance_lamports = 0, balance_sol = 0 WHERE user_id = ?`, user.ID)
	})
	for _, st := range []string{models.WithdrawalPayoutRequested, models.WithdrawalPayoutOpsRequired} {
		if err := db.DB.Create(&models.WithdrawalPayout{
			UserID: user.ID, Reference: "p2g-" + st, Destination: "Dest", AmountSOL: 1,
			Status: st, CreatedAt: time.Now().UTC().Add(-2 * time.Hour),
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	stats := ComputeQueueSLOStats()
	var wd *QueueSLOStat
	for i := range stats {
		if stats[i].Queue == "withdrawal_payouts" {
			wd = &stats[i]
		}
	}
	if wd == nil || wd.Skipped {
		t.Fatalf("withdrawal queue stats missing: %+v", stats)
	}
	if wd.Depth < 1 || wd.DeadLetter < 1 {
		t.Fatalf("want depth>=1 dead>=1, got %+v", *wd)
	}
	if wd.OldestAgeSeconds < 3600 {
		t.Fatalf("oldest age should be ~2h, got %ds", wd.OldestAgeSeconds)
	}
}
