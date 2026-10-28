package billing

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func withSOLPriceNow(t *testing.T, price float64) {
	t.Helper()
	prev := solPriceNow
	solPriceNow = func() float64 { return price }
	t.Cleanup(func() { solPriceNow = prev })
}

// P0-7 contract: at price 0 the lamports cost is 0 while USD cost stays
// positive — the exact combination settleSession must reject.
func TestCostFromBytesUSDAtSOLPrice_P0_ZeroPrice(t *testing.T) {
	lamports, usd, sol := CostFromBytesUSDAtSOLPrice(1024*1024*1024, 0.50, 0)
	if lamports != 0 || sol != 0 {
		t.Fatalf("zero price must yield zero lamports/SOL, got %d / %.6f", lamports, sol)
	}
	if usd <= 0 {
		t.Fatalf("USD cost must stay positive (that's how outage is detected), got %.6f", usd)
	}
}

// P0-7: the consumption-time snapshot wins over the live feed.
func TestSessionSOLPrice_P0_SnapshotWins(t *testing.T) {
	testutil.SetupTestRedis(t)
	withSOLPriceNow(t, 200)

	sessionID := "11111111-2222-3333-4444-555555555555"
	if err := redis.Client.Set(context.Background(), SessionPriceSnapshotKey(sessionID), 150.0, 0).Err(); err != nil {
		t.Fatalf("seed snapshot: %v", err)
	}
	if got := sessionSOLPrice(sessionID); got != 150.0 {
		t.Fatalf("want snapshot price 150, got %.2f", got)
	}
}

// W-08 regression: with no snapshot and no live price, settlement fails and
// NOTHING is consumed — pending key kept, balances untouched (old code
// charged 0, deleted the metering key and marked everything settled).
func TestSettleSession_P0_PriceUnavailableRetainsUsage(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	resetSettlementCBForTest(t)
	withSOLPriceNow(t, 0)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "sessions", "proxy_listings", "provider_scores", "spending_records")

	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-p0-buyer"), "buyer")
	var buyerWallet models.Wallet
	if err := db.DB.Where("user_id = ?", buyer.ID).First(&buyerWallet).Error; err != nil {
		t.Fatalf("buyer wallet: %v", err)
	}
	buyerWallet.BalanceSOL = 10.0
	buyerWallet.LimitsEnabled = false
	if err := db.DB.Save(&buyerWallet).Error; err != nil {
		t.Fatalf("save buyer wallet: %v", err)
	}

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-p0-provider"), "provider")
	listing := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "P0 price listing",
		PricePerGB:           0.50,
		AvailableBandwidthGB: 100,
		Status:               "active",
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("listing: %v", err)
	}
	session := models.Session{
		UserID:    buyer.ID,
		ListingID: &listing.ID,
		Type:      models.SessionRotating,
		Status:    models.SessionActive,
		Config:    "{}",
		StartTime: time.Now().Add(-5 * time.Minute),
	}
	if err := db.DB.Create(&session).Error; err != nil {
		t.Fatalf("session: %v", err)
	}

	ctx := context.Background()
	redisKey := "billing:session:" + session.ID.String() + ":pending"
	if err := redis.Client.Set(ctx, redisKey, "1073741824", 0).Err(); err != nil {
		t.Fatalf("redis set: %v", err)
	}

	err := settleSession(session.ID.String(), 1024*1024*1024, redisKey)
	if !errors.Is(err, ErrSOLPriceUnavailable) {
		t.Fatalf("want ErrSOLPriceUnavailable, got %v", err)
	}

	// Metering evidence retained for a later retry.
	if _, err := redis.Client.Get(ctx, redisKey).Result(); err != nil {
		t.Fatalf("pending redis key must be retained on price outage: %v", err)
	}
	// No debit, no credit.
	if err := db.DB.Where("user_id = ?", buyer.ID).First(&buyerWallet).Error; err != nil {
		t.Fatalf("reload buyer: %v", err)
	}
	if buyerWallet.BalanceSOL != 10.0 {
		t.Fatalf("buyer must not be charged on price outage, balance %.6f", buyerWallet.BalanceSOL)
	}
	var ledgerCount int64
	db.DB.Model(&models.WalletLedgerEntry{}).Where("wallet_id = ?", buyerWallet.ID).Count(&ledgerCount)
	if ledgerCount != 0 {
		t.Fatalf("no ledger entries expected on price outage, got %d", ledgerCount)
	}

	// And the same usage settles once a snapshot exists (feed still down).
	if err := redis.Client.Set(ctx, SessionPriceSnapshotKey(session.ID.String()), 200.0, 0).Err(); err != nil {
		t.Fatalf("seed snapshot: %v", err)
	}
	if err := settleSession(session.ID.String(), 1024*1024*1024, redisKey); err != nil {
		t.Fatalf("settle with snapshot should succeed while feed is down: %v", err)
	}
	if _, err := redis.Client.Get(ctx, redisKey).Result(); err == nil {
		t.Fatal("pending key should be deleted after successful settle")
	}
	if _, err := redis.Client.Get(ctx, SessionPriceSnapshotKey(session.ID.String())).Result(); err == nil {
		t.Fatal("snapshot key should be deleted after successful settle")
	}
	if err := db.DB.Where("user_id = ?", buyer.ID).First(&buyerWallet).Error; err != nil {
		t.Fatalf("reload buyer after settle: %v", err)
	}
	if buyerWallet.BalanceSOL <= 9.9 || buyerWallet.BalanceSOL >= 10.0 {
		t.Fatalf("buyer should be charged ~0.0025 SOL at $200 snapshot, balance %.6f", buyerWallet.BalanceSOL)
	}
}
