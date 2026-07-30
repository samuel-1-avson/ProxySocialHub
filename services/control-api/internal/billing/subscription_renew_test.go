package billing

import (
	"context"
	"testing"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/prices"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestRenewDueSubscriptions_DebitsAndExtends(t *testing.T) {
	prices.SetTestSOLPrice(100)
	defer prices.SetTestSOLPrice(0)

	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "wallet_ledger_entries", "user_subscriptions", "subscription_plans", "wallets", "users")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("renew_buyer"), "buyer")
	db.DB.Model(&models.Wallet{}).Where("user_id = ?", user.ID).Update("balance_sol", 10.0)

	plan := models.SubscriptionPlan{
		Name:         "renew-pro",
		PriceMonthly: 10, // $10 → 0.1 SOL at $100/SOL
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

	renewed, pastDue, _ := RenewDueSubscriptions(context.Background(), 10)
	if renewed != 1 || pastDue != 0 {
		t.Fatalf("renewed=%d pastDue=%d want 1/0", renewed, pastDue)
	}

	var updated models.UserSubscription
	if err := db.DB.First(&updated, "id = ?", sub.ID).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if updated.Status != models.SubscriptionActive {
		t.Fatalf("status=%s", updated.Status)
	}
	if updated.CurrentPeriodEnd == nil || !updated.CurrentPeriodEnd.After(time.Now().UTC()) {
		t.Fatalf("period end not extended: %v", updated.CurrentPeriodEnd)
	}

	var wallet models.Wallet
	db.DB.First(&wallet, "user_id = ?", user.ID)
	if wallet.BalanceSOL >= 10.0 {
		t.Fatalf("expected debit, balance still %.6f", wallet.BalanceSOL)
	}
}

func TestRenewDueSubscriptions_InsufficientMarksPastDue(t *testing.T) {
	prices.SetTestSOLPrice(100)
	defer prices.SetTestSOLPrice(0)

	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "wallet_ledger_entries", "user_subscriptions", "subscription_plans", "wallets", "users")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("renew_broke"), "buyer")
	db.DB.Model(&models.Wallet{}).Where("user_id = ?", user.ID).Update("balance_sol", 0.001)

	plan := models.SubscriptionPlan{
		Name:         "renew-scale",
		PriceMonthly: 50,
		ListingLimit: 5,
		IsActive:     true,
	}
	if err := db.DB.Create(&plan).Error; err != nil {
		t.Fatalf("create plan: %v", err)
	}

	ended := time.Now().UTC().Add(-time.Hour)
	sub := models.UserSubscription{
		UserID:             user.ID,
		PlanID:             plan.ID,
		Status:             models.SubscriptionActive,
		BillingCycle:       models.BillingMonthly,
		CurrentPeriodStart: ended.AddDate(0, -1, 0),
		CurrentPeriodEnd:   &ended,
	}
	if err := db.DB.Create(&sub).Error; err != nil {
		t.Fatalf("create sub: %v", err)
	}

	renewed, pastDue, _ := RenewDueSubscriptions(context.Background(), 10)
	if renewed != 0 || pastDue != 1 {
		t.Fatalf("renewed=%d pastDue=%d want 0/1", renewed, pastDue)
	}

	var updated models.UserSubscription
	db.DB.First(&updated, "id = ?", sub.ID)
	if updated.Status != models.SubscriptionPastDue {
		t.Fatalf("status=%s want past_due", updated.Status)
	}
}
