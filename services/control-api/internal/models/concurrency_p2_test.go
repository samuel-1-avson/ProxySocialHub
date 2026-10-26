package models_test

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
	"gorm.io/gorm"
)

// P2-F (audit §14): concurrency conservation + crash-injection.
// Run under -race (see gate notes).

func seedConcurrencyWallet(t *testing.T, user *models.User, sol float64) models.Wallet {
	t.Helper()
	var w models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&w).Error; err != nil {
		t.Fatal(err)
	}
	lamports := int64(models.SOLToLamports(sol))
	if err := db.DB.Model(&w).Updates(map[string]interface{}{
		"balance_sol": sol, "balance_lamports": lamports, "earnings_payable_lamports": 0,
	}).Error; err != nil {
		t.Fatal(err)
	}
	w.BalanceSOL, w.BalanceLamports = sol, lamports
	return w
}

// Parallel debits against one wallet: exactly floor(balance/amount)
// succeed, balance never goes negative, lamports stay exact.
func TestConcurrency_ParallelDebitsNeverOverdraw_P2F(t *testing.T) {
	testutil.SetupTestDB(t)
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("conc-debit"), "buyer")
	w := seedConcurrencyWallet(t, user, 10)

	const goroutines = 20
	var succeeded, failed atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := db.DB.Transaction(func(tx *gorm.DB) error {
				locked, err := models.LockWalletForUpdate(tx, user.ID)
				if err != nil {
					return err
				}
				return models.DebitWalletLocked(tx, locked, 1.0, models.TransactionPayout, uuid.NewString(), "concurrency debit")
			})
			if err == nil {
				succeeded.Add(1)
			} else {
				failed.Add(1)
			}
		}()
	}
	wg.Wait()

	if succeeded.Load() != 10 || failed.Load() != 10 {
		t.Fatalf("want 10 succeed/10 fail, got %d/%d", succeeded.Load(), failed.Load())
	}
	var after models.Wallet
	if err := db.DB.Where("id = ?", w.ID).First(&after).Error; err != nil {
		t.Fatal(err)
	}
	if after.BalanceLamports != 0 {
		t.Fatalf("final balance must be exactly 0 lamports, got %d (sol %v)", after.BalanceLamports, after.BalanceSOL)
	}
}

// Bidirectional parallel P2P: total lamports conserved, per-wallet
// ledger deltas net to the observed balance movement.
func TestConcurrency_ParallelP2PConservation_P2F(t *testing.T) {
	testutil.SetupTestDB(t)
	userA := testutil.CreateTestUser(t, testutil.UniqueEmail("conc-a"), "buyer")
	userB := testutil.CreateTestUser(t, testutil.UniqueEmail("conc-b"), "buyer")
	wa := seedConcurrencyWallet(t, userA, 5)
	wb := seedConcurrencyWallet(t, userB, 5)

	transfer := func(from, to *models.User) error {
		return db.DB.Transaction(func(tx *gorm.DB) error {
			first, second := from, to
			if second.ID.String() < first.ID.String() {
				first, second = second, first
			}
			w1, err := models.LockWalletForUpdate(tx, first.ID)
			if err != nil {
				return err
			}
			w2, err := models.LockWalletForUpdate(tx, second.ID)
			if err != nil {
				return err
			}
			sender, recipient := w1, w2
			if from.ID != first.ID {
				sender, recipient = w2, w1
			}
			return models.TransferP2PLocked(tx, sender, recipient, 0.01, uuid.NewString(), "conc out", "conc in")
		})
	}

	const rounds = 40
	var wg sync.WaitGroup
	errs := make(chan error, rounds*2)
	for i := 0; i < rounds; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); errs <- transfer(userA, userB) }()
		go func() { defer wg.Done(); errs <- transfer(userB, userA) }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("parallel P2P failed: %v", err)
		}
	}

	var aAfter, bAfter models.Wallet
	if err := db.DB.Where("id = ?", wa.ID).First(&aAfter).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.DB.Where("id = ?", wb.ID).First(&bAfter).Error; err != nil {
		t.Fatal(err)
	}
	if aAfter.BalanceLamports != int64(5*1e9) || bAfter.BalanceLamports != int64(5*1e9) {
		t.Fatalf("conservation broken: A=%d B=%d want 5e9 each", aAfter.BalanceLamports, bAfter.BalanceLamports)
	}
	for _, w := range []models.Wallet{aAfter, bAfter} {
		var sum int64
		if err := db.DB.Model(&models.WalletLedgerEntry{}).
			Where("wallet_id = ? AND type IN ?", w.ID, []string{models.LedgerKindP2PSent, models.LedgerKindP2PReceived}).
			Select("COALESCE(SUM(amount_lamports),0)").Scan(&sum).Error; err != nil {
			t.Fatal(err)
		}
		if sum != 0 {
			t.Fatalf("wallet %s ledger net %d, want 0", w.ID, sum)
		}
	}
}

// Crash-injection: the journal unique constraint is the last-line
// double-credit guard. Concurrent posts of the same (ref, type):
// exactly one commits, the rest get ErrJournalDuplicate.
func TestCrashInjection_ConcurrentJournalPostCreditsOnce_P2F(t *testing.T) {
	testutil.SetupTestDB(t)
	if !db.DB.Migrator().HasTable(&models.LedgerJournal{}) {
		t.Skip("journal tables not migrated in this test DB")
	}
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("conc-journal"), "buyer")
	w := seedConcurrencyWallet(t, user, 0)
	ref := "p2f-deposit-" + uuid.NewString()
	wid := w.ID

	const goroutines = 8
	var succeeded, duplicated atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := db.DB.Transaction(func(tx *gorm.DB) error {
				return models.PostBalancedJournal(tx, models.LedgerKindDeposit, ref, "p2f crash-injection", []models.JournalLineSpec{
					{AccountCode: models.AccountTreasuryCash, AmountLamports: 1000},
					{AccountCode: models.AccountUserWalletLiability, WalletID: &wid, AmountLamports: -1000},
				})
			})
			switch {
			case err == nil:
				succeeded.Add(1)
			case errors.Is(err, models.ErrJournalDuplicate):
				duplicated.Add(1)
			default:
				t.Errorf("unexpected error: %v", err)
			}
		}()
	}
	wg.Wait()
	if succeeded.Load() != 1 || duplicated.Load() != goroutines-1 {
		t.Fatalf("want 1 success + %d duplicates, got %d/%d", goroutines-1, succeeded.Load(), duplicated.Load())
	}
	var count int64
	db.DB.Model(&models.LedgerJournal{}).Where("external_ref = ?", ref).Count(&count)
	if count != 1 {
		t.Fatalf("exactly one journal must exist, got %d", count)
	}
}
