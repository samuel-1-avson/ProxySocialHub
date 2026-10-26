package models_test

import (
	"errors"
	"testing"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func seedLimitWallet(t *testing.T, daily, weekly, monthly float64) models.Wallet {
	t.Helper()
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("spend-limit-p0"), "buyer")
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatalf("wallet: %v", err)
	}
	wallet.LimitsEnabled = true
	wallet.DailyLimit = daily
	wallet.WeeklyLimit = weekly
	wallet.MonthlyLimit = monthly
	if err := db.DB.Save(&wallet).Error; err != nil {
		t.Fatalf("save wallet: %v", err)
	}
	return wallet
}

// W-06 regression: with limits enabled, a stored 0 limit must BLOCK
// spending (old code treated 0 as unlimited via the `> 0` guard).
func TestCheckSpendingLimit_P0_ZeroLimitBlocksAll(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "spending_records")

	wallet := seedLimitWallet(t, 0, 50, 100)
	err := wallet.CheckSpendingLimit(db.DB, 0.5, models.SpendingTransfer)
	var limitErr *models.SpendingLimitError
	if !errors.As(err, &limitErr) {
		t.Fatalf("zero daily limit must block: got %v", err)
	}
	if limitErr.LimitType != "daily" || limitErr.Limit != 0 {
		t.Fatalf("want daily/0 limit error, got %+v", limitErr)
	}
}

// W-06 regression: zero on any window blocks, even when others are generous.
func TestCheckSpendingLimit_P0_ZeroWeeklyBlocks(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "spending_records")

	wallet := seedLimitWallet(t, 10, 0, 100)
	err := wallet.CheckSpendingLimit(db.DB, 0.5, models.SpendingWithdraw)
	var limitErr *models.SpendingLimitError
	if !errors.As(err, &limitErr) || limitErr.LimitType != "weekly" {
		t.Fatalf("zero weekly limit must block with weekly error: got %v", err)
	}
}

// P0-5: stored limits above the trust-tier ceiling are clamped at spend
// time (a tampered/legacy row cannot exceed the tier maximum).
func TestCheckSpendingLimit_P0_TierCeilingClampsStored(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "spending_records")

	// CreateTestUser defaults to TrustTierNew (ceilings 10/50/100).
	wallet := seedLimitWallet(t, 500, 500, 500)

	if err := wallet.CheckSpendingLimit(db.DB, 9.0, models.SpendingTransfer); err != nil {
		t.Fatalf("spend within tier ceiling should pass, got %v", err)
	}
	err := wallet.CheckSpendingLimit(db.DB, 11.0, models.SpendingTransfer)
	var limitErr *models.SpendingLimitError
	if !errors.As(err, &limitErr) {
		t.Fatalf("spend above tier ceiling must block despite stored 500: got %v", err)
	}
	if limitErr.Limit != 10.0 {
		t.Fatalf("effective limit must be clamped to tier max 10, got %.2f", limitErr.Limit)
	}
}
