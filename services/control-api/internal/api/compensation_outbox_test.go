package api

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestEnqueueAndApplyWithdrawalCompensation(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "compensation_outbox", "wallet_ledger_entries", "spending_records", "users", "wallets")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("comp-wd"), "buyer")
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatalf("wallet: %v", err)
	}
	// Simulate post-debit, pre-refund state (underpaid).
	wallet.BalanceSOL = 0.5
	if err := db.DB.Save(&wallet).Error; err != nil {
		t.Fatalf("save wallet: %v", err)
	}
	ref := "wd-comp-" + uuid.New().String()
	if err := db.DB.Create(&models.SpendingRecord{
		UserID:    user.ID,
		WalletID:  wallet.ID,
		Amount:    1.0,
		Type:      models.SpendingWithdraw,
		Reference: ref,
	}).Error; err != nil {
		t.Fatalf("spending: %v", err)
	}

	EnqueueCompensation(models.CompensationKindWithdrawalRefund, user.ID, nil, 1.0, ref, "simulated inline refund failure")

	var entry models.CompensationOutbox
	if err := db.DB.Where("kind = ? AND reference_id = ?", models.CompensationKindWithdrawalRefund, ref).First(&entry).Error; err != nil {
		t.Fatalf("outbox entry: %v", err)
	}
	if entry.Status != models.CompensationStatusPending {
		t.Fatalf("status: want pending got %q", entry.Status)
	}

	ok, failed, permanent := ProcessCompensationOutboxOnce(10)
	if ok != 1 || failed != 0 || permanent != 0 {
		t.Fatalf("process: ok=%d failed=%d permanent=%d", ok, failed, permanent)
	}

	if err := db.DB.First(&entry, entry.ID).Error; err != nil {
		t.Fatalf("reload entry: %v", err)
	}
	if entry.Status != models.CompensationStatusSucceeded {
		t.Fatalf("status: want succeeded got %q (err=%v)", entry.Status, entry.LastError)
	}

	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatalf("reload wallet: %v", err)
	}
	if wallet.BalanceSOL < 1.499 || wallet.BalanceSOL > 1.501 {
		t.Fatalf("balance: want ~1.5 got %.9f", wallet.BalanceSOL)
	}

	var ledger models.WalletLedgerEntry
	if err := db.DB.Where("reference_id = ? AND type = ?", ref, "withdrawal_failed_refund").First(&ledger).Error; err != nil {
		t.Fatalf("ledger: %v", err)
	}

	// W-33: spending history is never deleted - the original spend is
	// retained and a compensating reversal nets it to zero.
	var spendCount int64
	db.DB.Model(&models.SpendingRecord{}).Where("reference = ?", ref).Count(&spendCount)
	if spendCount != 1 {
		t.Fatalf("original spending record must be retained, count=%d", spendCount)
	}
	var netSpend float64
	db.DB.Model(&models.SpendingRecord{}).
		Where("reference IN ?", []string{ref, ref + ":reversal"}).
		Select("COALESCE(SUM(amount),0)").Scan(&netSpend)
	if netSpend != 0 {
		t.Fatalf("spending must net to zero after reversal, got %v", netSpend)
	}

	// Idempotent second pass.
	ok, _, _ = ProcessCompensationOutboxOnce(10)
	if ok != 0 {
		t.Fatalf("second pass should skip succeeded rows, ok=%d", ok)
	}
}

func TestApplyP2PCompensation(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "compensation_outbox", "wallet_ledger_entries", "users", "wallets")

	sender := testutil.CreateTestUser(t, testutil.UniqueEmail("comp-p2p-s"), "buyer")
	recipient := testutil.CreateTestUser(t, testutil.UniqueEmail("comp-p2p-r"), "buyer")

	var senderWallet, recipientWallet models.Wallet
	if err := db.DB.Where("user_id = ?", sender.ID).First(&senderWallet).Error; err != nil {
		t.Fatalf("sender wallet: %v", err)
	}
	if err := db.DB.Where("user_id = ?", recipient.ID).First(&recipientWallet).Error; err != nil {
		t.Fatalf("recipient wallet: %v", err)
	}
	// After failed chain send: sender already debited, recipient already credited in DB.
	senderWallet.BalanceSOL = 0.0
	recipientWallet.BalanceSOL = 2.0
	if err := db.DB.Save(&senderWallet).Error; err != nil {
		t.Fatalf("save sender: %v", err)
	}
	if err := db.DB.Save(&recipientWallet).Error; err != nil {
		t.Fatalf("save recipient: %v", err)
	}

	ref := "p2p-comp-" + uuid.New().String()
	cp := recipient.ID
	EnqueueCompensation(models.CompensationKindP2PRefund, sender.ID, &cp, 1.0, ref, "simulated")

	ok, failed, permanent := ProcessCompensationOutboxOnce(10)
	if ok != 1 || failed != 0 || permanent != 0 {
		t.Fatalf("process: ok=%d failed=%d permanent=%d", ok, failed, permanent)
	}

	if err := db.DB.Where("user_id = ?", sender.ID).First(&senderWallet).Error; err != nil {
		t.Fatalf("reload sender: %v", err)
	}
	if err := db.DB.Where("user_id = ?", recipient.ID).First(&recipientWallet).Error; err != nil {
		t.Fatalf("reload recipient: %v", err)
	}
	if senderWallet.BalanceSOL < 0.999 || senderWallet.BalanceSOL > 1.001 {
		t.Fatalf("sender balance: want ~1.0 got %.9f", senderWallet.BalanceSOL)
	}
	if recipientWallet.BalanceSOL < 0.999 || recipientWallet.BalanceSOL > 1.001 {
		t.Fatalf("recipient balance: want ~1.0 got %.9f", recipientWallet.BalanceSOL)
	}

	// Already-applied ledger makes re-apply a no-op success path via status=succeeded.
	entry := models.CompensationOutbox{
		Kind:               models.CompensationKindP2PRefund,
		UserID:             sender.ID,
		CounterpartyUserID: &cp,
		AmountSOL:          1.0,
		ReferenceID:        ref + "-dup",
		Status:             models.CompensationStatusPending,
		NextRetryAt:        time.Now().UTC().Add(-time.Minute),
	}
	// Seed ledger as already applied for the dup ref, then run apply directly.
	if err := db.DB.Create(&models.WalletLedgerEntry{
		WalletID:     senderWallet.ID,
		Amount:       1.0,
		BalanceAfter: senderWallet.BalanceSOL,
		Type:         "p2p_failed_refund",
		ReferenceID:  entry.ReferenceID,
		Description:  "pre-seeded",
	}).Error; err != nil {
		t.Fatalf("seed ledger: %v", err)
	}
	if err := ApplyCompensationOutboxEntry(&entry); err != nil {
		t.Fatalf("idempotent apply: %v", err)
	}
}

// BE-CRIT-01: p2p_settle rows queued before the fix used to send SOL from the
// treasury. They must now be drained without moving any funds.
func TestLegacyP2PSettleRowSendsNothing(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "compensation_outbox", "users", "wallets")

	sender := testutil.CreateTestUser(t, testutil.UniqueEmail("settle-s"), "buyer")
	recipient := testutil.CreateTestUser(t, testutil.UniqueEmail("settle-r"), "buyer")
	var sw, rw models.Wallet
	if err := db.DB.Where("user_id = ?", sender.ID).First(&sw).Error; err != nil {
		t.Fatalf("sender wallet: %v", err)
	}
	if err := db.DB.Where("user_id = ?", recipient.ID).First(&rw).Error; err != nil {
		t.Fatalf("recipient wallet: %v", err)
	}

	meta := `{"sender_wallet":"7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuGui4Q5G","recipient_wallet":"9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9wYt5WGy",` +
		`"sender_user_id":"` + sender.ID.String() + `","recipient_user_id":"` + recipient.ID.String() + `",` +
		`"sender_wallet_id":"` + sw.ID.String() + `","recipient_wallet_id":"` + rw.ID.String() + `"}`
	cp := recipient.ID
	legacy := models.CompensationOutbox{
		Kind:               models.CompensationKindP2PSettle,
		UserID:             sender.ID,
		CounterpartyUserID: &cp,
		AmountSOL:          0.05,
		ReferenceID:        "p2p-settle-" + uuid.New().String(),
		Metadata:           meta,
		Status:             models.CompensationStatusPending,
		NextRetryAt:        time.Now().UTC().Add(-time.Minute),
	}
	if err := db.DB.Create(&legacy).Error; err != nil {
		t.Fatalf("seed legacy row: %v", err)
	}

	sends := withSendSOLRecorder(t)
	ok, failed, permanent := ProcessCompensationOutboxOnce(10)
	if ok != 1 || failed != 0 || permanent != 0 {
		t.Fatalf("process: ok=%d failed=%d permanent=%d", ok, failed, permanent)
	}
	if n := sends.Load(); n != 0 {
		t.Fatalf("legacy p2p_settle row sent SOL %d time(s); expected none", n)
	}
}
