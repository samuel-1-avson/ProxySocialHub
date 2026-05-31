package billing

import (
	"context"
	"errors"
	"math"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/redis"
	"github.com/proxyhubb/control-api/internal/testutil"
	"gorm.io/gorm"
)

func resetSettlementCBForTest(t *testing.T) {
	t.Helper()
	settlementCB.mu.Lock()
	settlementCB.failures = nil
	settlementCB.pausedUntil = time.Time{}
	settlementCB.mu.Unlock()
	if redis.Client != nil {
		_ = redis.Client.Del(context.Background(), cbRedisKey).Err()
	}
}

func withMockSOLTransfer(t *testing.T, fn func(ctx context.Context, recipient string, amountSOL float64) error) {
	t.Helper()
	prev := globalSendSOL
	globalSendSOL = fn
	t.Cleanup(func() { globalSendSOL = prev })
}

func resetSOLPriceCacheForTest() {
	priceMu.Lock()
	cachedSOLPrice = 0
	cachedPriceTime = time.Time{}
	priceMu.Unlock()
}

func forceSOLPriceForTest(usdPerSOL float64) {
	priceMu.Lock()
	cachedSOLPrice = usdPerSOL
	cachedPriceTime = time.Now()
	priceMu.Unlock()
}

func TestMain(m *testing.M) {
	_ = os.Setenv("EMERGENCY_SOL_PRICE_USD", "200")
	resetSOLPriceCacheForTest()
	os.Exit(m.Run())
}

func TestMarkSettlementArtifactsSettledAdvancesSessionIntentLifecycle(t *testing.T) {
	testutil.SetupTestDB(t)

	if err := db.DB.AutoMigrate(&models.UsageReceipt{}, &models.SettlementManifest{}, &models.SessionIntentRecord{}); err != nil {
		t.Fatalf("auto migrate settlement models: %v", err)
	}

	userID := uuid.New()
	now := time.Now().UTC()
	session := models.Session{
		UserID:    userID,
		Type:      models.SessionRotating,
		Status:    models.SessionActive,
		Config:    "{}",
		StartTime: now.Add(-10 * time.Minute),
		EndTime:   now.Add(50 * time.Minute),
	}
	if err := db.DB.Create(&session).Error; err != nil {
		t.Fatalf("create session: %v", err)
	}
	sessionUsername := "settlement-session-user-" + session.ID.String()

	manifest := models.SettlementManifest{
		SessionID:       session.ID,
		SessionUsername: sessionUsername,
		UserRef:         userID.String(),
		WindowKey:       "window-" + session.ID.String(),
		WindowStartedAt: time.Now().Add(-5 * time.Minute).UTC(),
		WindowEndedAt:   time.Now().Add(-1 * time.Minute).UTC(),
		LastReceiptAt:   time.Now().Add(-1 * time.Minute).UTC(),
		Status:          models.SettlementManifestOpen,
	}
	if err := db.DB.Create(&manifest).Error; err != nil {
		t.Fatalf("create settlement manifest: %v", err)
	}

	receipt := models.UsageReceipt{
		ManifestID:      &manifest.ID,
		SessionID:       session.ID,
		SessionUsername: sessionUsername,
		UserRef:         userID.String(),
		BytesUp:         512,
		BytesDown:       1024,
		Nonce:           1,
		Signature:       "sig-1",
		Source:          "gateway_report",
		Status:          models.UsageReceiptPending,
		ReportedAt:      time.Now().Add(-2 * time.Minute).UTC(),
	}
	if err := db.DB.Create(&receipt).Error; err != nil {
		t.Fatalf("create usage receipt: %v", err)
	}

	intent := models.SessionIntentRecord{
		UserID:         userID,
		SessionType:    models.SessionRotating,
		LifecycleState: models.SessionIntentClosing,
		ExpiresAt:      time.Now().Add(30 * time.Minute).UTC(),
		ClosingAt:      pointerTime(time.Now().Add(-3 * time.Minute).UTC()),
		CreatedAt:      time.Now().Add(-10 * time.Minute).UTC(),
		UpdatedAt:      time.Now().Add(-2 * time.Minute).UTC(),
	}
	if err := db.DB.Create(&intent).Error; err != nil {
		t.Fatalf("create session intent: %v", err)
	}

	if err := markSettlementArtifactsSettled(session.ID); err != nil {
		t.Fatalf("mark settlement artifacts settled: %v", err)
	}

	var refreshedReceipt models.UsageReceipt
	if err := db.DB.First(&refreshedReceipt, "id = ?", receipt.ID).Error; err != nil {
		t.Fatalf("reload usage receipt: %v", err)
	}
	if refreshedReceipt.Status != models.UsageReceiptSettled || refreshedReceipt.SettledAt == nil {
		t.Fatalf("expected usage receipt to be settled, got status=%q settled_at=%v", refreshedReceipt.Status, refreshedReceipt.SettledAt)
	}

	var refreshedManifest models.SettlementManifest
	if err := db.DB.First(&refreshedManifest, "id = ?", manifest.ID).Error; err != nil {
		t.Fatalf("reload settlement manifest: %v", err)
	}
	if refreshedManifest.Status != models.SettlementManifestSettled || refreshedManifest.SettledAt == nil {
		t.Fatalf("expected settlement manifest to be settled, got status=%q settled_at=%v", refreshedManifest.Status, refreshedManifest.SettledAt)
	}

	var refreshedIntent models.SessionIntentRecord
	if err := db.DB.First(&refreshedIntent, "id = ?", intent.ID).Error; err != nil {
		t.Fatalf("reload session intent: %v", err)
	}
	if refreshedIntent.LifecycleState != models.SessionIntentArchived {
		t.Fatalf("expected session intent to be archived, got %q", refreshedIntent.LifecycleState)
	}
	if refreshedIntent.LedgerCommittedAt == nil || refreshedIntent.BatchedAt == nil || refreshedIntent.ChainCommittedAt == nil || refreshedIntent.ArchivedAt == nil {
		t.Fatalf(
			"expected settlement timestamps to be populated, got ledger=%v batched=%v chain=%v archived=%v",
			refreshedIntent.LedgerCommittedAt,
			refreshedIntent.BatchedAt,
			refreshedIntent.ChainCommittedAt,
			refreshedIntent.ArchivedAt,
		)
	}
}

func TestDebitBuyerWallet_InsufficientBalance(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "sessions")

	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-buyer"), "buyer")
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", buyer.ID).First(&wallet).Error; err != nil {
		t.Fatalf("wallet: %v", err)
	}
	wallet.BalanceSOL = 0.001
	wallet.LimitsEnabled = false
	if err := db.DB.Save(&wallet).Error; err != nil {
		t.Fatalf("save wallet: %v", err)
	}

	session := models.Session{
		UserID:    buyer.ID,
		Type:      models.SessionRotating,
		Status:    models.SessionActive,
		Config:    "{}",
		StartTime: time.Now().Add(-5 * time.Minute),
	}
	if err := db.DB.Create(&session).Error; err != nil {
		t.Fatalf("session: %v", err)
	}

	err := db.DB.Transaction(func(tx *gorm.DB) error {
		return debitBuyerWallet(tx, &session, 1_000_000, 1.0, 150.0)
	})
	if err == nil {
		t.Fatal("expected insufficient balance error")
	}
	if err.Error() != "insufficient SOL balance" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func pointerTime(value time.Time) *time.Time {
	return &value
}

func TestCreditProviderWallet_Atomic(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "sessions", "proxy_listings", "provider_scores")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-provider"), "seller")
	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-buyer"), "buyer")

	listing := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "Test listing",
		PricePerGB:           1.0,
		AvailableBandwidthGB: 100,
		Status:               "active",
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("create listing: %v", err)
	}

	session := models.Session{
		UserID:    buyer.ID,
		ListingID: &listing.ID,
		Type:      models.SessionRotating,
		Status:    models.SessionActive,
		Config:    "{}",
		StartTime: time.Now().Add(-5 * time.Minute),
		Listing:   &listing,
	}
	if err := db.DB.Create(&session).Error; err != nil {
		t.Fatalf("create session: %v", err)
	}

	var providerWallet models.Wallet
	if err := db.DB.Where("user_id = ?", provider.ID).First(&providerWallet).Error; err != nil {
		t.Fatalf("provider wallet: %v", err)
	}
	startBalance := providerWallet.BalanceSOL

	credited, err := func() (bool, error) {
		var ok bool
		txErr := db.DB.Transaction(func(tx *gorm.DB) error {
			var txErr error
			ok, txErr = creditProviderWallet(tx, &session, 1_000_000, 0.5)
			return txErr
		})
		return ok, txErr
	}()
	if err != nil {
		t.Fatalf("creditProviderWallet: %v", err)
	}
	if !credited {
		t.Fatal("expected credit to succeed")
	}

	if err := db.DB.Where("user_id = ?", provider.ID).First(&providerWallet).Error; err != nil {
		t.Fatalf("reload provider wallet: %v", err)
	}
	if providerWallet.BalanceSOL != startBalance+0.5 {
		t.Fatalf("expected balance %.6f, got %.6f", startBalance+0.5, providerWallet.BalanceSOL)
	}

	var ledger models.WalletLedgerEntry
	if err := db.DB.Where("wallet_id = ? AND type = ?", providerWallet.ID, "provider_earning").First(&ledger).Error; err != nil {
		t.Fatalf("provider ledger entry: %v", err)
	}
	if ledger.Amount != 0.5 {
		t.Fatalf("expected ledger amount 0.5, got %.6f", ledger.Amount)
	}
}

func TestCircuitBreaker_OpensAfterThreeFailures(t *testing.T) {
	testutil.SetupTestRedis(t)
	resetSettlementCBForTest(t)

	for i := 0; i < cbMaxFailures; i++ {
		settlementCB.recordFailure()
	}
	if !settlementCB.isOpen() {
		t.Fatal("expected circuit breaker to be open after consecutive failures")
	}
}

func TestCircuitBreaker_SuccessClearsFailureWindow(t *testing.T) {
	testutil.SetupTestRedis(t)
	resetSettlementCBForTest(t)

	settlementCB.recordFailure()
	settlementCB.recordFailure()
	settlementCB.recordSuccess()
	if settlementCB.isOpen() {
		t.Fatal("expected circuit breaker to be closed after success")
	}

	settlementCB.recordFailure()
	settlementCB.recordFailure()
	if settlementCB.isOpen() {
		t.Fatal("expected circuit breaker to stay closed below failure threshold")
	}
}

func TestDebitBuyerWallet_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "sessions")

	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-buyer-ok"), "buyer")
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", buyer.ID).First(&wallet).Error; err != nil {
		t.Fatalf("wallet: %v", err)
	}
	wallet.BalanceSOL = 5.0
	wallet.LimitsEnabled = false
	if err := db.DB.Save(&wallet).Error; err != nil {
		t.Fatalf("save wallet: %v", err)
	}

	session := models.Session{
		UserID:    buyer.ID,
		Type:      models.SessionRotating,
		Status:    models.SessionActive,
		Config:    "{}",
		StartTime: time.Now().Add(-5 * time.Minute),
	}
	if err := db.DB.Create(&session).Error; err != nil {
		t.Fatalf("session: %v", err)
	}

	costSOL := 1.25
	if err := db.DB.Transaction(func(tx *gorm.DB) error {
		return debitBuyerWallet(tx, &session, 1_000_000, costSOL, 250.0)
	}); err != nil {
		t.Fatalf("debitBuyerWallet: %v", err)
	}

	if err := db.DB.First(&wallet, wallet.ID).Error; err != nil {
		t.Fatalf("reload wallet: %v", err)
	}
	if wallet.BalanceSOL != 5.0-costSOL {
		t.Fatalf("expected balance %.6f, got %.6f", 5.0-costSOL, wallet.BalanceSOL)
	}

	var ledger models.WalletLedgerEntry
	if err := db.DB.Where("wallet_id = ? AND type = ?", wallet.ID, models.TransactionUsage).First(&ledger).Error; err != nil {
		t.Fatalf("usage ledger: %v", err)
	}
	if ledger.Amount != -costSOL {
		t.Fatalf("expected ledger debit %.6f, got %.6f", -costSOL, ledger.Amount)
	}
}

func TestCreditProviderWallet_ReturnsQueueWhenAtOrAboveThreshold(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "sessions", "proxy_listings", "provider_scores")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-provider-threshold"), "seller")
	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-buyer-threshold"), "buyer")

	listing := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "Threshold listing",
		PricePerGB:           1.0,
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
		Listing:   &listing,
	}
	if err := db.DB.Create(&session).Error; err != nil {
		t.Fatalf("session: %v", err)
	}

	var providerWallet models.Wallet
	if err := db.DB.Where("user_id = ?", provider.ID).First(&providerWallet).Error; err != nil {
		t.Fatalf("provider wallet: %v", err)
	}
	providerWallet.BalanceSOL = providerPayoutThresholdSOL - 0.01
	if err := db.DB.Save(&providerWallet).Error; err != nil {
		t.Fatalf("save provider wallet: %v", err)
	}

	creditSOL := 0.02
	var shouldQueue bool
	if err := db.DB.Transaction(func(tx *gorm.DB) error {
		var err error
		shouldQueue, err = creditProviderWallet(tx, &session, 1_000_000, creditSOL)
		return err
	}); err != nil {
		t.Fatalf("creditProviderWallet: %v", err)
	}
	if !shouldQueue {
		t.Fatal("expected payout queue signal when balance crosses threshold")
	}

	if err := db.DB.Where("user_id = ?", provider.ID).First(&providerWallet).Error; err != nil {
		t.Fatalf("reload provider wallet: %v", err)
	}
	if providerWallet.BalanceSOL < providerPayoutThresholdSOL {
		t.Fatalf("expected balance >= %.6f, got %.6f", providerPayoutThresholdSOL, providerWallet.BalanceSOL)
	}
}

func TestComputeSessionCost_UsesListingPrice(t *testing.T) {
	forceSOLPriceForTest(200)

	listing := models.ProxyListing{PricePerGB: 0.50}
	session := models.Session{Listing: &listing}

	costSOL, costUSD := computeSessionCost(&session, 1024*1024*1024)
	if costUSD != 0.50 {
		t.Fatalf("expected costUSD 0.50, got %.6f", costUSD)
	}
	if math.Abs(costSOL-0.50/200) > 1e-9 {
		t.Fatalf("expected costSOL %.9f, got %.9f", 0.50/200, costSOL)
	}
}

func TestSettleSession_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	resetSettlementCBForTest(t)
	forceSOLPriceForTest(200)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "sessions", "proxy_listings", "provider_scores")

	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-settle-buyer"), "buyer")
	var buyerWallet models.Wallet
	if err := db.DB.Where("user_id = ?", buyer.ID).First(&buyerWallet).Error; err != nil {
		t.Fatalf("buyer wallet: %v", err)
	}
	buyerWallet.BalanceSOL = 10.0
	buyerWallet.LimitsEnabled = false
	if err := db.DB.Save(&buyerWallet).Error; err != nil {
		t.Fatalf("save buyer wallet: %v", err)
	}

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-settle-provider"), "seller")
	var providerWallet models.Wallet
	if err := db.DB.Where("user_id = ?", provider.ID).First(&providerWallet).Error; err != nil {
		t.Fatalf("provider wallet: %v", err)
	}
	providerWallet.BalanceSOL = 0
	if err := db.DB.Save(&providerWallet).Error; err != nil {
		t.Fatalf("zero provider wallet: %v", err)
	}

	listing := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "Settle listing",
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

	if err := settleSession(session.ID.String(), 1024*1024*1024, redisKey); err != nil {
		t.Fatalf("settleSession: %v", err)
	}

	if _, err := redis.Client.Get(ctx, redisKey).Result(); err == nil {
		t.Fatal("expected settled session to delete redis pending key")
	}

	var settledSession models.Session
	if err := db.DB.Preload("Listing").First(&settledSession, session.ID).Error; err != nil {
		t.Fatalf("reload session: %v", err)
	}
	expectedCost, _ := computeSessionCost(&settledSession, 1024*1024*1024)

	if err := db.DB.Where("user_id = ?", buyer.ID).First(&buyerWallet).Error; err != nil {
		t.Fatalf("reload buyer wallet: %v", err)
	}
	if math.Abs(buyerWallet.BalanceSOL-(10.0-expectedCost)) > 1e-6 {
		t.Fatalf("buyer balance: want %.6f got %.6f", 10.0-expectedCost, buyerWallet.BalanceSOL)
	}

	if err := db.DB.Where("user_id = ?", provider.ID).First(&providerWallet).Error; err != nil {
		t.Fatalf("reload provider wallet: %v", err)
	}
	if math.Abs(providerWallet.BalanceSOL-expectedCost) > 1e-6 {
		t.Fatalf("provider balance: want %.6f got %.6f", expectedCost, providerWallet.BalanceSOL)
	}
}

func TestTriggerProviderPayout_EnqueuesRetryOnOnChainFailure(t *testing.T) {
	testutil.SetupTestDB(t)
	if err := db.DB.AutoMigrate(&models.PayoutRetryQueue{}); err != nil {
		t.Fatalf("migrate payout_retry_queue: %v", err)
	}
	testutil.CleanupTestData(t, "payout_retry_queue", "users", "wallets", "wallet_ledger_entries")

	withMockSOLTransfer(t, func(ctx context.Context, recipient string, amountSOL float64) error {
		return errors.New("simulated rpc failure")
	})

	addr := "DevPayout11111111111111111111111111111111"
	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-payout-retry"), "seller")
	if err := db.DB.Model(&models.User{}).Where("id = ?", provider.ID).
		Update("wallet_address", addr).Error; err != nil {
		t.Fatalf("wallet_address: %v", err)
	}

	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", provider.ID).First(&wallet).Error; err != nil {
		t.Fatalf("wallet: %v", err)
	}
	wallet.BalanceSOL = 0.10
	if err := db.DB.Save(&wallet).Error; err != nil {
		t.Fatalf("save wallet: %v", err)
	}

	triggerProviderPayout(provider.ID)

	var entry models.PayoutRetryQueue
	if err := db.DB.Where("provider_id = ? AND status = ?", provider.ID, "pending").First(&entry).Error; err != nil {
		t.Fatalf("retry queue entry: %v", err)
	}
	if entry.WalletAddress != addr {
		t.Fatalf("wallet address: got %q", entry.WalletAddress)
	}
	if entry.AmountSOL != 0.10 {
		t.Fatalf("amount: want 0.10 got %.6f", entry.AmountSOL)
	}
	if entry.AttemptCount != 1 {
		t.Fatalf("attempt count: want 1 got %d", entry.AttemptCount)
	}
	if entry.ErrorMessage == nil || !strings.Contains(*entry.ErrorMessage, "simulated rpc failure") {
		t.Fatalf("expected error message on retry entry, got %v", entry.ErrorMessage)
	}

	if err := db.DB.Where("user_id = ?", provider.ID).First(&wallet).Error; err != nil {
		t.Fatalf("reload wallet: %v", err)
	}
	if wallet.BalanceSOL != 0 {
		t.Fatalf("expected zeroed wallet after payout lock, got %.6f", wallet.BalanceSOL)
	}
}

func TestProcessPayoutRetries_AppliesExponentialBackoff(t *testing.T) {
	testutil.SetupTestDB(t)
	if err := db.DB.AutoMigrate(&models.PayoutRetryQueue{}); err != nil {
		t.Fatalf("migrate payout_retry_queue: %v", err)
	}
	testutil.CleanupTestData(t, "payout_retry_queue")

	withMockSOLTransfer(t, func(ctx context.Context, recipient string, amountSOL float64) error {
		return errors.New("still failing")
	})

	entry := models.PayoutRetryQueue{
		ID:            uuid.New(),
		ProviderID:    uuid.New(),
		WalletAddress: "RetryWallet1111111111111111111111111111",
		AmountSOL:     0.05,
		AttemptCount:  1,
		NextRetryAt:   time.Now().Add(-time.Minute),
		Status:        "pending",
	}
	if err := db.DB.Create(&entry).Error; err != nil {
		t.Fatalf("create retry entry: %v", err)
	}

	before := time.Now()
	processPayoutRetries()

	var updated models.PayoutRetryQueue
	if err := db.DB.First(&updated, entry.ID).Error; err != nil {
		t.Fatalf("reload entry: %v", err)
	}
	if updated.Status != "pending" {
		t.Fatalf("status: want pending got %q", updated.Status)
	}
	if updated.AttemptCount != 2 {
		t.Fatalf("attempt count: want 2 got %d", updated.AttemptCount)
	}

	expectedBackoff := time.Duration(math.Pow(2, float64(2))) * time.Minute
	expectedNext := before.Add(expectedBackoff)
	if math.Abs(updated.NextRetryAt.Sub(expectedNext).Seconds()) > 15 {
		t.Fatalf("next_retry_at outside expected window: got %v want ~%v", updated.NextRetryAt, expectedNext)
	}
}

func TestProcessPayoutRetries_MarksSucceededOnSuccess(t *testing.T) {
	testutil.SetupTestDB(t)
	if err := db.DB.AutoMigrate(&models.PayoutRetryQueue{}); err != nil {
		t.Fatalf("migrate payout_retry_queue: %v", err)
	}
	testutil.CleanupTestData(t, "payout_retry_queue")

	withMockSOLTransfer(t, func(ctx context.Context, recipient string, amountSOL float64) error {
		return nil
	})

	entry := models.PayoutRetryQueue{
		ID:            uuid.New(),
		ProviderID:    uuid.New(),
		WalletAddress: "SuccessWallet111111111111111111111111111",
		AmountSOL:     0.05,
		AttemptCount:  0,
		NextRetryAt:   time.Now().Add(-time.Minute),
		Status:        "pending",
	}
	if err := db.DB.Create(&entry).Error; err != nil {
		t.Fatalf("create retry entry: %v", err)
	}

	processPayoutRetries()

	var updated models.PayoutRetryQueue
	if err := db.DB.First(&updated, entry.ID).Error; err != nil {
		t.Fatalf("reload entry: %v", err)
	}
	if updated.Status != "succeeded" {
		t.Fatalf("status: want succeeded got %q", updated.Status)
	}
	if updated.AttemptCount != 1 {
		t.Fatalf("attempt count: want 1 got %d", updated.AttemptCount)
	}
}

func TestSettleUsage_SkipsWhenCircuitBreakerOpen(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	resetSettlementCBForTest(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "sessions", "proxy_listings")

	settlementCB.mu.Lock()
	settlementCB.pausedUntil = time.Now().Add(10 * time.Minute)
	settlementCB.mu.Unlock()

	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-cb-buyer"), "buyer")
	var buyerWallet models.Wallet
	if err := db.DB.Where("user_id = ?", buyer.ID).First(&buyerWallet).Error; err != nil {
		t.Fatalf("buyer wallet: %v", err)
	}
	buyerWallet.BalanceSOL = 10.0
	buyerWallet.LimitsEnabled = false
	if err := db.DB.Save(&buyerWallet).Error; err != nil {
		t.Fatalf("save buyer wallet: %v", err)
	}

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-cb-provider"), "seller")
	listing := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "CB listing",
		PricePerGB:           1.0,
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
	pendingKey := "billing:session:" + session.ID.String() + ":pending"
	if err := redis.Client.Set(ctx, pendingKey, "1073741824", 0).Err(); err != nil {
		t.Fatalf("redis set: %v", err)
	}

	SettleUsage()

	val, err := redis.Client.Get(ctx, pendingKey).Result()
	if err != nil {
		t.Fatalf("expected pending key to remain while breaker is open: %v", err)
	}
	if val != "1073741824" {
		t.Fatalf("pending bytes: want 1073741824 got %q", val)
	}

	if err := db.DB.Where("user_id = ?", buyer.ID).First(&buyerWallet).Error; err != nil {
		t.Fatalf("reload buyer wallet: %v", err)
	}
	if buyerWallet.BalanceSOL != 10.0 {
		t.Fatalf("buyer balance should be unchanged, got %.6f", buyerWallet.BalanceSOL)
	}
}
