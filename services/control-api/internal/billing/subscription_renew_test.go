package billing

import (
	"context"
	"testing"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestRenewDueSubscriptions_ExpiresEndedPeriodsWithoutDebit(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "wallet_ledger_entries", "user_subscriptions", "subscription_plans", "wallets", "users")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("renew_buyer"), "buyer")
	db.DB.Model(&models.Wallet{}).Where("user_id = ?", user.ID).Update("balance_sol", 10.0)

	plan := models.SubscriptionPlan{
		Name:         "renew-pro",
		PriceMonthly: 10,
		ListingLimit: 5,
		IsActive:     true,
	}
	if err := db.DB.Create(&plan).Error; err != nil {
		t.Fatalf("create plan: %v", err)
	}

	ended := time.Now().UTC().Add(-time.Hour)
	started := ended.AddDate(0, -1, 0)
	sub := models.UserSubscription{
		UserID:             user.ID,
		PlanID:             plan.ID,
		Status:             models.SubscriptionActive,
		BillingCycle:       models.BillingMonthly,
		CurrentPeriodStart: started,
		CurrentPeriodEnd:   &ended,
	}
	if err := db.DB.Create(&sub).Error; err != nil {
		t.Fatalf("create sub: %v", err)
	}

	renewed, pastDue, closed := RenewDueSubscriptions(context.Background(), 10)
	if renewed != 0 || pastDue != 0 || closed < 1 {
		t.Fatalf("renewed=%d pastDue=%d closed=%d want 0/0/>=1", renewed, pastDue, closed)
	}

	var updated models.UserSubscription
	if err := db.DB.First(&updated, "id = ?", sub.ID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if updated.Status != models.SubscriptionExpired {
		t.Fatalf("status=%s want expired (no custodial renew)", updated.Status)
	}

	var wallet models.Wallet
	db.DB.First(&wallet, "user_id = ?", user.ID)
	if wallet.BalanceSOL < 9.999 {
		t.Fatalf("expected no debit, balance=%.6f", wallet.BalanceSOL)
	}
}

func TestRenewDueSubscriptions_NoDebitOnActiveFuturePeriod(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "wallet_ledger_entries", "user_subscriptions", "subscription_plans", "wallets", "users")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("renew_future"), "buyer")
	db.DB.Model(&models.Wallet{}).Where("user_id = ?", user.ID).Update("balance_sol", 5.0)

	plan := models.SubscriptionPlan{
		Name:         "renew-scale",
		PriceMonthly: 50,
		ListingLimit: 5,
		IsActive:     true,
	}
	if err := db.DB.Create(&plan).Error; err != nil {
		t.Fatalf("create plan: %v", err)
	}

	end := time.Now().UTC().AddDate(0, 1, 0)
	sub := models.UserSubscription{
		UserID:             user.ID,
		PlanID:             plan.ID,
		Status:             models.SubscriptionActive,
		BillingCycle:       models.BillingMonthly,
		CurrentPeriodStart: time.Now().UTC().AddDate(0, -1, 0),
		CurrentPeriodEnd:   &end,
	}
	if err := db.DB.Create(&sub).Error; err != nil {
		t.Fatalf("create sub: %v", err)
	}

	renewed, pastDue, closed := RenewDueSubscriptions(context.Background(), 10)
	if renewed != 0 || pastDue != 0 || closed != 0 {
		t.Fatalf("renewed=%d pastDue=%d closed=%d want 0/0/0", renewed, pastDue, closed)
	}

	var wallet models.Wallet
	db.DB.First(&wallet, "user_id = ?", user.ID)
	if wallet.BalanceSOL < 4.999 {
		t.Fatalf("unexpected debit, balance=%.6f", wallet.BalanceSOL)
	}
}
