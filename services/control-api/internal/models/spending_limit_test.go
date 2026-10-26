package models_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
	"gorm.io/gorm"
)

func TestCheckSpendingLimit_WithinLimit(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "spending_records")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("spend-limit"), "buyer")
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatalf("wallet: %v", err)
	}
	wallet.LimitsEnabled = true
	wallet.DailyLimit = 10.0
	wallet.WeeklyLimit = 50.0
	wallet.MonthlyLimit = 100.0
	if err := db.DB.Save(&wallet).Error; err != nil {
		t.Fatalf("save wallet: %v", err)
	}

	if err := wallet.CheckSpendingLimit(db.DB, 2.0, models.SpendingTransfer); err != nil {
		t.Fatalf("expected within limit, got %v", err)
	}
}

func TestCheckSpendingLimit_ExceedsMonthly(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "spending_records")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("spend-monthly"), "buyer")
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatalf("wallet: %v", err)
	}
	wallet.LimitsEnabled = true
	// P0-5: every window must be configured; a 0 window now blocks (P2-17 design).
	wallet.DailyLimit = 10.0
	wallet.WeeklyLimit = 50.0
	wallet.MonthlyLimit = 5.0
	if err := db.DB.Save(&wallet).Error; err != nil {
		t.Fatalf("save wallet: %v", err)
	}

	record := models.SpendingRecord{
		UserID:   user.ID,
		WalletID: wallet.ID,
		Amount:   4.0,
		Type:     models.SpendingTransfer,
	}
	if err := db.DB.Create(&record).Error; err != nil {
		t.Fatalf("seed spending: %v", err)
	}

	err := wallet.CheckSpendingLimit(db.DB, 2.0, models.SpendingTransfer)
	if err == nil {
		t.Fatal("expected monthly limit error")
	}
	spendErr, ok := err.(*models.SpendingLimitError)
	if !ok || spendErr.LimitType != "monthly" {
		t.Fatalf("expected monthly SpendingLimitError, got %T %v", err, err)
	}
}

func TestCheckSpendingLimit_WindowReset(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "spending_records")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("spend-window"), "buyer")
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatalf("wallet: %v", err)
	}
	wallet.LimitsEnabled = true
	// P0-5: every window must be configured; a 0 window now blocks (P2-17 design).
	wallet.DailyLimit = 2.0
	wallet.WeeklyLimit = 50.0
	wallet.MonthlyLimit = 100.0
	if err := db.DB.Save(&wallet).Error; err != nil {
		t.Fatalf("save wallet: %v", err)
	}

	old := models.SpendingRecord{
		UserID:    user.ID,
		WalletID:  wallet.ID,
		Amount:    2.0,
		Type:      models.SpendingTransfer,
		CreatedAt: time.Now().UTC().Add(-48 * time.Hour),
	}
	if err := db.DB.Create(&old).Error; err != nil {
		t.Fatalf("seed old spending: %v", err)
	}

	if err := wallet.CheckSpendingLimit(db.DB, 1.5, models.SpendingTransfer); err != nil {
		t.Fatalf("expected spend allowed after daily window reset, got %v", err)
	}
}

func TestRecordSpending_Atomic(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "spending_records")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("spend-atomic"), "buyer")
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatalf("wallet: %v", err)
	}

	ref := uuid.New().String()
	err := db.DB.Transaction(func(tx *gorm.DB) error {
		if err := wallet.RecordSpending(tx, 1.25, models.SpendingWithdraw, ref); err != nil {
			return err
		}
		return gorm.ErrInvalidTransaction // force rollback
	})
	if err == nil {
		t.Fatal("expected forced rollback error")
	}

	var count int64
	db.DB.Model(&models.SpendingRecord{}).Where("user_id = ? AND reference = ?", user.ID, ref).Count(&count)
	if count != 0 {
		t.Fatalf("expected rolled-back spending record, found %d rows", count)
	}

	if err := db.DB.Transaction(func(tx *gorm.DB) error {
		return wallet.RecordSpending(tx, 1.25, models.SpendingWithdraw, ref)
	}); err != nil {
		t.Fatalf("commit spending: %v", err)
	}

	db.DB.Model(&models.SpendingRecord{}).Where("user_id = ? AND reference = ?", user.ID, ref).Count(&count)
	if count != 1 {
		t.Fatalf("expected one committed spending record, got %d", count)
	}
}
