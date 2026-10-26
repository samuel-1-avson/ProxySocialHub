package api

import (
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// P2-F crash-injection (audit §14): applying the same withdrawal-refund
// compensation concurrently (worker crash/restart, two pods) must
// credit exactly once, return nil for every caller (clean no-op), and
// reverse - not delete - the original spending record (W-33).
// Pre-fix this double-credited: the existence check ran before the
// wallet lock, so every goroutine saw "not applied".
func TestCompensation_ConcurrentApplyCreditsOnce_P2F(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "wallet_ledger_entries", "spending_records", "compensation_outbox", "profiles", "auth.users")

	user, wallet := createWalletTestUser(t)
	const refundSOL = 2.5
	// Unique per run: the journal table is not cleaned between runs and
	// (ref, type) is unique there by design.
	ref := "p2f-wd-refund-" + uuid.NewString()[:8]

	// Original withdraw spend that the compensation must reverse.
	if err := db.DB.Create(&models.SpendingRecord{
		UserID: user.ID, WalletID: wallet.ID, Amount: refundSOL,
		Type: models.SpendingWithdraw, Reference: ref,
	}).Error; err != nil {
		t.Fatal(err)
	}
	startLamports := wallet.BalanceLamports

	entry := &models.CompensationOutbox{
		Kind: models.CompensationKindWithdrawalRefund,
		UserID: user.ID, AmountSOL: refundSOL, ReferenceID: ref,
	}
	if err := db.DB.Create(entry).Error; err != nil {
		t.Fatal(err)
	}

	const goroutines = 8
	var wg sync.WaitGroup
	errs := make(chan error, goroutines)
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			e := *entry
			errs <- ApplyCompensationOutboxEntry(&e)
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent apply must be a clean no-op, got %v", err)
		}
	}

	var credits int64
	db.DB.Model(&models.WalletLedgerEntry{}).
		Where("reference_id = ? AND type = ?", ref, models.LedgerKindWithdrawalFailedRefund).Count(&credits)
	if credits != 1 {
		t.Fatalf("want exactly 1 refund credit, got %d", credits)
	}

	var after models.Wallet
	if err := db.DB.Where("id = ?", wallet.ID).First(&after).Error; err != nil {
		t.Fatal(err)
	}
	want := startLamports + int64(models.SOLToLamports(refundSOL))
	if after.BalanceLamports != want {
		t.Fatalf("balance: got %d want %d (credited once)", after.BalanceLamports, want)
	}

	// W-33: original spending record intact + one reversal; net zero.
	var records []models.SpendingRecord
	if err := db.DB.Where("wallet_id = ?", wallet.ID).Order("created_at").Find(&records).Error; err != nil {
		t.Fatal(err)
	}
	if len(records) != 2 {
		t.Fatalf("want original + reversal spending records, got %d: %+v", len(records), records)
	}
	if records[0].Amount != refundSOL || records[1].Amount != -refundSOL || records[1].Reference != ref+":reversal" {
		t.Fatalf("bad reversal pair: %+v", records)
	}
}
