package api

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
	"gorm.io/datatypes"
)

func TestPlanBandwidthRemainingGB_IgnoresPendingAndRefunded(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "orders", "user_subscriptions", "subscription_plans", "proxy_listings", "wallets", "users")

	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("quota_buyer"), "buyer")
	seller := testutil.CreateTestUser(t, testutil.UniqueEmail("quota_seller"), "provider")

	limit := 10
	plan := models.SubscriptionPlan{
		Name:             "quota-test-plan",
		PriceMonthly:     0,
		ListingLimit:     10,
		BandwidthLimitGB: &limit,
		IsActive:         true,
	}
	if err := db.DB.Create(&plan).Error; err != nil {
		t.Fatalf("create plan: %v", err)
	}
	now := time.Now().UTC()
	sub := models.UserSubscription{
		UserID:             buyer.ID,
		PlanID:             plan.ID,
		Status:             models.SubscriptionActive,
		BillingCycle:       models.BillingMonthly,
		CurrentPeriodStart: now.AddDate(0, 0, -1),
		CurrentPeriodEnd:   ptrTime(now.AddDate(0, 1, 0)),
	}
	if err := db.DB.Create(&sub).Error; err != nil {
		t.Fatalf("create sub: %v", err)
	}

	listing := models.ProxyListing{
		SellerID:             seller.ID,
		Title:                "Quota Listing",
		PricePerGB:           1,
		AvailableBandwidthGB: 100,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("create listing: %v", err)
	}

	seed := func(status models.OrderStatus, gb float64) {
		o := models.Order{
			BuyerID:     buyer.ID,
			SellerID:    seller.ID,
			ListingID:   listing.ID,
			BandwidthGB: gb,
			PricePerGB:  1,
			TotalPrice:  gb,
			Status:      status,
		}
		if err := db.DB.Create(&o).Error; err != nil {
			t.Fatalf("create order %s: %v", status, err)
		}
	}

	seed(models.OrderStatusPending, 4)
	seed(models.OrderStatusPendingPayment, 3)
	seed(models.OrderStatusRefunded, 2)
	seed(models.OrderStatusActive, 1)
	seed(models.OrderStatusCompleted, 2)

	remaining, unlimited, limitGB, err := PlanBandwidthRemainingGB(buyer.ID)
	if err != nil {
		t.Fatalf("PlanBandwidthRemainingGB: %v", err)
	}
	if unlimited {
		t.Fatal("expected limited plan")
	}
	if limitGB != 10 {
		t.Fatalf("limitGB=%v want 10", limitGB)
	}
	// Only active(1)+completed(2) should count → remaining 7
	if remaining < 6.999 || remaining > 7.001 {
		t.Fatalf("remaining=%v want 7 (pending/refunded must not burn quota)", remaining)
	}
}

func TestCalculatePriceWithDiscounts_AppliesBestTier(t *testing.T) {
	discounts, _ := json.Marshal([]models.BulkDiscount{
		{MinGB: 5, PricePerGB: 8},
		{MinGB: 10, PricePerGB: 6},
	})
	listing := &models.ProxyListing{
		PricePerGB:    10,
		BulkDiscounts: datatypes.JSON(discounts),
	}
	if got := calculatePriceWithDiscounts(listing, 3); got != 30 {
		t.Fatalf("3GB got %v want 30", got)
	}
	if got := calculatePriceWithDiscounts(listing, 5); got != 40 {
		t.Fatalf("5GB got %v want 40", got)
	}
	if got := calculatePriceWithDiscounts(listing, 10); got != 60 {
		t.Fatalf("10GB got %v want 60", got)
	}
}

func ptrTime(t time.Time) *time.Time { return &t }
