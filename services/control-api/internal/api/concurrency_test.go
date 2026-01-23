package api

import (
	"sync"
	"testing"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
	"gorm.io/gorm/clause"
)

// TestDBLockingConcurrency confirms that GORM locking works as expected on the model.
// This simulates the critical section used in verifyDeposit.
func TestDBLockingConcurrency(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	_, wallet := createWalletTestUser(t)
	initialBalance := wallet.BalanceGHS

	// Number of concurrent updates
	concurrency := 10
	amountPerTx := 10.0

	var wg sync.WaitGroup
	wg.Add(concurrency)

	for i := 0; i < concurrency; i++ {
		go func() {
			defer wg.Done()

			// Simulate "verifyDeposit" logic in a transaction
			tx := db.DB.Begin()
			defer tx.Rollback()

			var w models.Wallet
			// Critical Section with Lock
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", wallet.ID).First(&w).Error; err != nil {
				t.Errorf("Failed to lock wallet: %v", err)
				return
			}

			// Update
			w.BalanceGHS += amountPerTx
			if err := tx.Save(&w).Error; err != nil {
				t.Errorf("Failed to save wallet: %v", err)
				return
			}

			tx.Commit()
		}()
	}

	wg.Wait()

	// Verify Final Balance
	var finalWallet models.Wallet
	db.DB.First(&finalWallet, "id = ?", wallet.ID)

	expected := initialBalance + (float64(concurrency) * amountPerTx)
	if finalWallet.BalanceGHS != expected {
		t.Errorf("Race condition detected! Expected %.2f, got %.2f", expected, finalWallet.BalanceGHS)
	} else {
		t.Logf("Success! Final Balance: %.2f", finalWallet.BalanceGHS)
	}
}
