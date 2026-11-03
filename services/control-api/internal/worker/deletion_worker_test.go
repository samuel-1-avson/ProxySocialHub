package worker

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestPurgeUserAccount_RemovesWalletAndLedger(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "profiles", "auth.users", "user_flags")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("gdpr"), "buyer")
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatalf("wallet: %v", err)
	}
	entry := models.WalletLedgerEntry{
		WalletID:     wallet.ID,
		Amount:       -1,
		BalanceAfter: wallet.BalanceSOL - 1,
		Type:         models.TransactionUsage,
		Description:  "test",
	}
	if err := db.DB.Create(&entry).Error; err != nil {
		t.Fatalf("ledger: %v", err)
	}

	past := time.Now().Add(-time.Hour)
	user.ScheduledDeletionAt = &past
	if err := db.DB.Save(user).Error; err != nil {
		t.Fatalf("schedule delete: %v", err)
	}

	if err := purgeUserAccount(user.ID, user.Email); err == nil {
		t.Fatal("funded account was purged")
	}
	if err := db.DB.Model(&wallet).Updates(map[string]interface{}{"balance_sol": 0, "balance_lamports": 0, "earnings_payable_lamports": 0}).Error; err != nil {
		t.Fatal(err)
	}
	if err := purgeUserAccount(user.ID, user.Email); err != nil {
		t.Fatalf("purge: %v", err)
	}

	var walletCount int64
	db.DB.Model(&models.Wallet{}).Where("user_id = ?", user.ID).Count(&walletCount)
	if walletCount != 0 {
		t.Fatalf("expected wallet removed, count=%d", walletCount)
	}

	var ledgerCount int64
	db.DB.Model(&models.WalletLedgerEntry{}).Where("wallet_id = ?", wallet.ID).Count(&ledgerCount)
	if ledgerCount != 0 {
		t.Fatalf("expected ledger removed, count=%d", ledgerCount)
	}

	var profileCount int64
	db.DB.Model(&models.User{}).Where("id = ?", user.ID).Count(&profileCount)
	if profileCount != 0 {
		t.Fatalf("expected profile removed")
	}
}

func TestPurgeExpiredAccounts_NoOpWhenNoneDue(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "profiles")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("gdpr-future"), "buyer")
	future := time.Now().Add(24 * time.Hour)
	user.ScheduledDeletionAt = &future
	db.DB.Save(user)

	purgeExpiredAccounts()

	var count int64
	db.DB.Model(&models.User{}).Where("id = ?", user.ID).Count(&count)
	if count != 1 {
		t.Fatalf("user should still exist")
	}
}

// Ensure purgeUserAccount is callable with a random UUID without panicking (no rows).
func TestPurgeUserAccount_UnknownUser(t *testing.T) {
	testutil.SetupTestDB(t)
	id := uuid.New()
	if err := purgeUserAccount(id, "gone@test.com"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
