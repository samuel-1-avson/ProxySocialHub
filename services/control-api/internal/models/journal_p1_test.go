package models_test

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// W-29: the same (external_ref, entry_type) must never post twice - an
// ambiguous-commit retry double-posted journals before the unique index.
func TestPostBalancedJournal_P1_DuplicateRefRejected(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "ledger_journals", "ledger_journal_lines")

	wid := uuid.New()
	lines := []models.JournalLineSpec{
		{AccountCode: models.AccountTreasuryCash, AmountLamports: 500},
		{AccountCode: models.AccountUserWalletLiability, WalletID: &wid, AmountLamports: -500},
	}
	ref := "p1-dup-" + uuid.NewString()
	if err := models.PostBalancedJournal(db.DB, "deposit", ref, "first", lines); err != nil {
		t.Fatalf("first post: %v", err)
	}
	err := models.PostBalancedJournal(db.DB, "deposit", ref, "retry", lines)
	if !errors.Is(err, models.ErrJournalDuplicate) {
		t.Fatalf("want ErrJournalDuplicate, got %v", err)
	}
	// Different entry type with same ref is a different leg - allowed.
	if err := models.PostBalancedJournal(db.DB, "deposit_fee", ref, "other leg", lines); err != nil {
		t.Fatalf("different entry type should post: %v", err)
	}
	var count int64
	db.DB.Model(&models.LedgerJournal{}).Where("external_ref = ?", ref).Count(&count)
	if count != 2 {
		t.Fatalf("expected 2 journals, got %d", count)
	}
}

// W-29: a usage-journal residual is an error, never plugged to revenue.
func TestPostUsageJournal_P1_ResidualErrors(t *testing.T) {
	err := models.PostUsageJournal(nil, uuid.New(), uuid.New(), 100, 60, 10, "ref", "desc")
	if err == nil {
		t.Fatal("residual of 30 lamports must error, not be absorbed into revenue")
	}
}

// W-19: drained wallet (lamports 0) with stale float shadow stays 0.
func TestEffectiveBalanceLamports_P1_DrainedNotResurrected(t *testing.T) {
	w := &models.Wallet{BalanceSOL: 7.5, BalanceLamports: 0}
	if got := w.EffectiveBalanceLamports(); got != 0 {
		t.Fatalf("drained wallet resurrected to %d lamports", got)
	}
	if w.BalanceDriftLamports() != -7_500_000_000 {
		t.Fatalf("drift should surface the stale shadow, got %d", w.BalanceDriftLamports())
	}
}
