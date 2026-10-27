package billing

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// W-16: claiming is atomic (second claim sees nothing) and requeue
// restores the exact bytes once.
func TestClaimSessionUsage_P1_AtomicAndRequeue(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "usage_metering_claims")

	sessionID := uuid.New()
	key := pendingKeyForSession(sessionID.String())
	ctx := context.Background()
	if err := redis.Client.Set(ctx, key, "5000", 0).Err(); err != nil {
		t.Fatal(err)
	}
	if err := redis.Client.Set(ctx, PriceSnapshotKeyForPendingKey(key), 200.0, 0).Err(); err != nil {
		t.Fatal(err)
	}

	claim, err := claimSessionUsage(sessionID.String(), key, 0, 0)
	if err != nil || claim == nil {
		t.Fatalf("claim: %v %v", claim, err)
	}
	if claim.Bytes != 5000 || claim.SOLPriceUSD == nil || *claim.SOLPriceUSD != 200 {
		t.Fatalf("claim content: %+v", claim)
	}
	if _, err := redis.Client.Get(ctx, key).Result(); err == nil {
		t.Fatal("pending key must be consumed by claim")
	}

	again, err := claimSessionUsage(sessionID.String(), key, 0, 0)
	if err != nil || again != nil {
		t.Fatalf("second claim must be empty, got %v %v", again, err)
	}

	requeueClaim(claim, errors.New("simulated settle failure"))
	v, err := redis.Client.Get(ctx, key).Result()
	if err != nil || v != "5000" {
		t.Fatalf("requeue must restore bytes, got %q %v", v, err)
	}
	var stored models.UsageMeteringClaim
	if err := db.DB.First(&stored, claim.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != models.MeteringClaimRequeued {
		t.Fatalf("want requeued, got %s", stored.Status)
	}
	// Requeue twice must not double-restore.
	requeueClaim(claim, errors.New("again"))
	if v, _ := redis.Client.Get(ctx, key).Result(); v != "5000" {
		t.Fatalf("double requeue restored twice: %q", v)
	}
}

// W-16/W-17: an insolvent buyer requeues bytes and does NOT trip the
// RPC circuit breaker (old code counted every failure toward it).
func TestSettleSession_P1_InsufficientFundsNotBreaker(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	resetSettlementCBForTest(t)
	forceSOLPriceForTest(200)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "sessions", "proxy_listings", "provider_scores", "spending_records", "usage_metering_claims")

	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-p1-broke"), "buyer")
	var buyerWallet models.Wallet
	if err := db.DB.Where("user_id = ?", buyer.ID).First(&buyerWallet).Error; err != nil {
		t.Fatal(err)
	}
	buyerWallet.BalanceSOL = 0
	buyerWallet.BalanceLamports = 0
	buyerWallet.LimitsEnabled = false
	if err := db.DB.Save(&buyerWallet).Error; err != nil {
		t.Fatal(err)
	}
	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-p1-provider"), "provider")
	listing := models.ProxyListing{SellerID: provider.ID, Title: "P1", PricePerGB: 0.50, AvailableBandwidthGB: 100, Status: "active"}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatal(err)
	}
	session := models.Session{UserID: buyer.ID, ListingID: &listing.ID, Type: models.SessionRotating, Status: models.SessionActive, Config: "{}", StartTime: time.Now().Add(-5 * time.Minute)}
	if err := db.DB.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	key := pendingKeyForSession(session.ID.String())
	if err := redis.Client.Set(context.Background(), key, "1073741824", 0).Err(); err != nil {
		t.Fatal(err)
	}

	err := settleSession(session.ID.String(), 0, key)
	if !errors.Is(err, models.ErrInsufficientBalance) {
		t.Fatalf("want ErrInsufficientBalance, got %v", err)
	}
	if v, gerr := redis.Client.Get(context.Background(), key).Result(); gerr != nil || v != "1073741824" {
		t.Fatalf("bytes must be requeued intact, got %q %v", v, gerr)
	}
	settlementCB.mu.Lock()
	failures := len(settlementCB.failures)
	settlementCB.mu.Unlock()
	if failures != 0 {
		t.Fatalf("business failure must not count toward breaker, got %d failures", failures)
	}
	var claims []models.UsageMeteringClaim
	db.DB.Where("session_id = ?", session.ID).Find(&claims)
	if len(claims) != 1 || claims[0].Status != models.MeteringClaimRequeued {
		t.Fatalf("want one requeued claim, got %+v", claims)
	}
}

// W-29+W-16: settling the same session twice posts two usage journals
// with distinct per-claim refs (the old session-id ref would now collide
// with the unique index and break the second settle).
func TestSettleSession_P1_TwiceSettlesWithUniqueJournalRefs(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	resetSettlementCBForTest(t)
	forceSOLPriceForTest(200)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "sessions", "proxy_listings", "provider_scores", "spending_records", "usage_metering_claims", "ledger_journals", "ledger_journal_lines")

	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-p1-twice-buyer"), "buyer")
	var buyerWallet models.Wallet
	if err := db.DB.Where("user_id = ?", buyer.ID).First(&buyerWallet).Error; err != nil {
		t.Fatal(err)
	}
	buyerWallet.BalanceSOL = 10
	buyerWallet.BalanceLamports = 10_000_000_000
	buyerWallet.LimitsEnabled = false
	if err := db.DB.Save(&buyerWallet).Error; err != nil {
		t.Fatal(err)
	}
	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-p1-twice-provider"), "provider")
	listing := models.ProxyListing{SellerID: provider.ID, Title: "P1 twice", PricePerGB: 0.50, AvailableBandwidthGB: 100, Status: "active"}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatal(err)
	}
	session := models.Session{UserID: buyer.ID, ListingID: &listing.ID, Type: models.SessionRotating, Status: models.SessionActive, Config: "{}", StartTime: time.Now().Add(-5 * time.Minute)}
	if err := db.DB.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	key := pendingKeyForSession(session.ID.String())

	for i := 0; i < 2; i++ {
		if err := redis.Client.Set(context.Background(), key, "1073741824", 0).Err(); err != nil {
			t.Fatal(err)
		}
		if err := settleSession(session.ID.String(), 0, key); err != nil {
			t.Fatalf("settle %d: %v", i+1, err)
		}
	}
	var settled int64
	db.DB.Model(&models.UsageMeteringClaim{}).Where("session_id = ? AND status = ?", session.ID, models.MeteringClaimSettled).Count(&settled)
	if settled != 2 {
		t.Fatalf("want 2 settled claims, got %d", settled)
	}
	var sessionClaims []models.UsageMeteringClaim
	db.DB.Where("session_id = ? AND status = ?", session.ID, models.MeteringClaimSettled).Find(&sessionClaims)
	refs := make([]string, 0, len(sessionClaims))
	for _, cl := range sessionClaims {
		refs = append(refs, "usage-settle:"+cl.ID.String())
	}
	var journals int64
	db.DB.Model(&models.LedgerJournal{}).Where("external_ref IN ?", refs).Count(&journals)
	if journals != 2 {
		t.Fatalf("want 2 usage-settle journals for this session's claims, got %d (refs=%v)", journals, refs)
	}
}
