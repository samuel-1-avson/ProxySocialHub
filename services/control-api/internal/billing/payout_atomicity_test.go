package billing

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
	"gorm.io/gorm"
)

// --- Pure unit tests (no DB required) ---

func TestPayoutIdempotencyKey_NeverConstantWithoutSessionsOrRef(t *testing.T) {
	provider := uuid.New()
	k1 := payoutIdempotencyKey(provider, "Wallet111111111111111111111111111111111111", nil, "")
	k2 := payoutIdempotencyKey(provider, "Wallet111111111111111111111111111111111", nil, "")
	if k1 == k2 {
		t.Fatalf("keys without sessions/reference must differ per payout (W-01 constant key): both %q", k1)
	}
	if len(k1) > 64 || len(k2) > 64 {
		t.Fatalf("keys must fit VARCHAR(64): %d, %d", len(k1), len(k2))
	}
}

func TestPayoutIdempotencyKey_StableForSameReference(t *testing.T) {
	provider := uuid.New()
	ref := "payout-queue:" + provider.String() + ":" + uuid.NewString()
	k1 := payoutIdempotencyKey(provider, "Wallet111111111111111111111111111111111111", nil, ref)
	k2 := payoutIdempotencyKey(provider, "Wallet111111111111111111111111111111111111", nil, ref)
	if k1 != k2 {
		t.Fatalf("same reference must derive the same key: %q vs %q", k1, k2)
	}
	if len(k1) > 64 {
		t.Fatalf("reference-derived key must fit VARCHAR(64), got %d", len(k1))
	}
}

func TestPayoutIdempotencyKey_SessionDerivedStableAndOrderInsensitive(t *testing.T) {
	provider := uuid.New()
	a := payoutIdempotencyKey(provider, "Wallet111111111111111111111111111111111111", []string{"s2", "s1"}, "")
	b := payoutIdempotencyKey(provider, "Wallet111111111111111111111111111111111111", []string{"s1", "s2"}, "")
	if a != b {
		t.Fatalf("session-derived key must be order-insensitive: %q vs %q", a, b)
	}
}

// --- DB-backed regression tests (skip without TEST_DATABASE_URL) ---

func migratePayoutTables(t *testing.T) {
	t.Helper()
	if err := db.DB.AutoMigrate(&models.PendingPayout{}, &models.BatchPayout{}, &models.BatchPayoutItem{}, &models.PayoutRetryQueue{}); err != nil {
		t.Fatalf("migrate payout tables: %v", err)
	}
}

func withTestBatchProcessor(t *testing.T, batchFn func(ctx context.Context, items []models.BatchPayoutItem) (string, error)) *BatchPayoutProcessor {
	t.Helper()
	cfg := models.DefaultBatchConfig()
	bp := NewBatchPayoutProcessor(cfg,
		func(ctx context.Context, recipient string, amountSOL float64) error { return nil },
		batchFn)
	prev := globalBatchProcessor
	globalBatchProcessor = bp
	t.Cleanup(func() { globalBatchProcessor = prev })
	return bp
}

// W-01 regression: a duplicate QueuePayout must return an error, never
// silently succeed while dropping the payout.
func TestQueuePayout_DuplicateSessionsReturnsError(t *testing.T) {
	testutil.SetupTestDB(t)
	migratePayoutTables(t)
	testutil.CleanupTestData(t, "pending_payouts")

	bp := withTestBatchProcessor(t, func(ctx context.Context, items []models.BatchPayoutItem) (string, error) {
		return "unused", nil
	})

	providerID := uuid.New()
	sessions := []string{"session-a", "session-b"}
	if err := bp.QueuePayout(providerID, "Wallet111111111111111111111111111111111111", 1.0, sessions); err != nil {
		t.Fatalf("first QueuePayout: %v", err)
	}
	err := bp.QueuePayout(providerID, "Wallet111111111111111111111111111111111111", 1.0, sessions)
	if !errors.Is(err, ErrPayoutAlreadyQueued) {
		t.Fatalf("second QueuePayout: want ErrPayoutAlreadyQueued, got %v", err)
	}
}

// W-01 regression: a second provider payout queued while the first is still
// pending must also be enqueued with its own debit preserved.
func TestQueueProviderPayout_SecondPayoutNotSwallowed(t *testing.T) {
	testutil.SetupTestDB(t)
	migratePayoutTables(t)
	testutil.CleanupTestData(t, "pending_payouts", "batch_payouts", "batch_payout_items", "users", "wallets", "wallet_ledger_entries", "ledger_journals", "ledger_journal_lines")

	_ = withTestBatchProcessor(t, func(ctx context.Context, items []models.BatchPayoutItem) (string, error) {
		return "unused", nil
	})

	addr := "DevPayout11111111111111111111111111111111"
	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("billing-atomic-payout"), "seller")
	if err := db.DB.Model(&models.User{}).Where("id = ?", provider.ID).Update("wallet_address", addr).Error; err != nil {
		t.Fatalf("wallet_address: %v", err)
	}
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", provider.ID).First(&wallet).Error; err != nil {
		t.Fatalf("wallet: %v", err)
	}
	wallet.BalanceSOL = 0.10
	wallet.BalanceLamports = 100_000_000
	wallet.EarningsPayableLamports = 100_000_000 // W-10: payouts sweep payable
	if err := db.DB.Save(&wallet).Error; err != nil {
		t.Fatalf("save wallet: %v", err)
	}

	queueProviderPayout(provider.ID)

	var pendings []models.PendingPayout
	if err := db.DB.Where("provider_id = ?", provider.ID).Find(&pendings).Error; err != nil {
		t.Fatalf("pendings: %v", err)
	}
	if len(pendings) != 1 {
		t.Fatalf("after first payout: want 1 pending, got %d", len(pendings))
	}
	if pendings[0].Status != models.PendingPayoutQueued {
		t.Fatalf("first pending status: want queued, got %q", pendings[0].Status)
	}

	// Provider earns again while the first payout is still queued.
	if err := db.DB.Where("user_id = ?", provider.ID).First(&wallet).Error; err != nil {
		t.Fatalf("reload wallet: %v", err)
	}
	if wallet.BalanceSOL != 0 {
		t.Fatalf("wallet should be debited to 0 after first queue, got %.6f", wallet.BalanceSOL)
	}
	wallet.BalanceSOL = 0.10
	wallet.BalanceLamports = 100_000_000
	wallet.EarningsPayableLamports = 100_000_000
	if err := db.DB.Save(&wallet).Error; err != nil {
		t.Fatalf("re-credit wallet: %v", err)
	}

	queueProviderPayout(provider.ID)

	pendings = nil
	if err := db.DB.Where("provider_id = ?", provider.ID).Order("queued_at ASC").Find(&pendings).Error; err != nil {
		t.Fatalf("pendings after second: %v", err)
	}
	if len(pendings) != 2 {
		t.Fatalf("W-01 regression: want 2 pending payouts, got %d (second debit swallowed)", len(pendings))
	}
	if pendings[0].IdempotencyKey == pendings[1].IdempotencyKey {
		t.Fatalf("payouts must have distinct idempotency keys, both %q", pendings[0].IdempotencyKey)
	}
	if err := db.DB.Where("user_id = ?", provider.ID).First(&wallet).Error; err != nil {
		t.Fatalf("final wallet: %v", err)
	}
	if wallet.BalanceSOL != 0 {
		t.Fatalf("wallet should be 0 after second queue, got %.6f", wallet.BalanceSOL)
	}
}

// EnqueuePayoutTx: a duplicate key inside the caller's transaction aborts it,
// so an accompanying debit can never commit without its payout intent.
func TestEnqueuePayoutTx_DuplicateAbortsTransaction(t *testing.T) {
	testutil.SetupTestDB(t)
	migratePayoutTables(t)
	testutil.CleanupTestData(t, "pending_payouts")

	bp := withTestBatchProcessor(t, func(ctx context.Context, items []models.BatchPayoutItem) (string, error) {
		return "unused", nil
	})
	providerID := uuid.New()
	key := uuid.NewString()

	err := db.DB.Transaction(func(tx *gorm.DB) error {
		if err := bp.EnqueuePayoutTx(tx, providerID, "Wallet111111111111111111111111111111111111", 1.0, key); err != nil {
			return err
		}
		return bp.EnqueuePayoutTx(tx, providerID, "Wallet111111111111111111111111111111111111", 1.0, key)
	})
	if !errors.Is(err, ErrPayoutAlreadyQueued) {
		t.Fatalf("want ErrPayoutAlreadyQueued, got %v", err)
	}
	var count int64
	db.DB.Model(&models.PendingPayout{}).Where("provider_id = ?", providerID).Count(&count)
	if count != 0 {
		t.Fatalf("rolled-back transaction must leave no rows, got %d", count)
	}
}

// W-02 regression: a failed batch send must not delete the queued payouts.
func TestProcessPendingBatches_FailedSendKeepsRows(t *testing.T) {
	testutil.SetupTestDB(t)
	migratePayoutTables(t)
	testutil.CleanupTestData(t, "pending_payouts", "batch_payouts", "batch_payout_items", "payout_retry_queue")

	bp := withTestBatchProcessor(t, func(ctx context.Context, items []models.BatchPayoutItem) (string, error) {
		return "", errors.New("simulated batch send failure")
	})

	for i := 0; i < 5; i++ {
		row := models.PendingPayout{
			ProviderID:     uuid.New(),
			WalletAddress:  "Wallet111111111111111111111111111111111111",
			AmountSOL:      0.5,
			IdempotencyKey: uuid.NewString(),
			Status:         models.PendingPayoutQueued,
			QueuedAt:       time.Now().Add(-time.Hour),
		}
		if err := db.DB.Create(&row).Error; err != nil {
			t.Fatalf("seed pending: %v", err)
		}
	}

	if err := bp.ProcessPendingBatches(context.Background()); err != nil {
		t.Fatalf("ProcessPendingBatches: %v", err)
	}

	var total int64
	db.DB.Model(&models.PendingPayout{}).Count(&total)
	if total != 5 {
		t.Fatalf("W-02 regression: pending rows must survive a failed batch, got %d of 5", total)
	}
	var failed int64
	db.DB.Model(&models.PendingPayout{}).Where("status = ?", models.PendingPayoutFailed).Count(&failed)
	if failed != 5 {
		t.Fatalf("want 5 failed pendings after send failure, got %d", failed)
	}
	var retries int64
	db.DB.Model(&models.PayoutRetryQueue{}).Count(&retries)
	if retries == 0 {
		t.Fatal("failed batch items should be handed to the retry queue")
	}
}
