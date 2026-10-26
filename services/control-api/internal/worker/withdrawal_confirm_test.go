package worker

import (
	"context"
	"errors"
	"testing"

	"github.com/gagliardetto/solana-go/rpc"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func withTxHook(t *testing.T, fn func(ctx context.Context, signature string) (*rpc.GetTransactionResult, error)) {
	t.Helper()
	prev := solana.GetTransactionTestHook
	solana.GetTransactionTestHook = fn
	t.Cleanup(func() { solana.GetTransactionTestHook = prev })
}

func seedPayoutRow(t *testing.T, userID uuid.UUID, status, txHash string, amount float64) models.WithdrawalPayout {
	t.Helper()
	row := models.WithdrawalPayout{
		UserID:      userID,
		Reference:   uuid.NewString(),
		Destination: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuGui4Q5G",
		AmountSOL:   amount,
		Status:      status,
		TxHash:      txHash,
	}
	if err := db.DB.Create(&row).Error; err != nil {
		t.Fatalf("seed payout row: %v", err)
	}
	return row
}

// P0-3: the sweep completes a submitted withdrawal once the chain confirms it.
func TestConfirmSubmittedWithdrawals_CompletesOnChainConfirmed(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "withdrawal_payout_queue", "wallet_ledger_entries")
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("worker-confirm"), "buyer")
	row := seedPayoutRow(t, user.ID, models.WithdrawalPayoutSubmitted, "confirmed_sig", 1.5)

	withTxHook(t, func(ctx context.Context, signature string) (*rpc.GetTransactionResult, error) {
		return &rpc.GetTransactionResult{}, nil
	})

	confirmSubmittedWithdrawals(context.Background(), &solana.OracleClient{}, nil)

	var got models.WithdrawalPayout
	if err := db.DB.First(&got, "id = ?", row.ID).Error; err != nil {
		t.Fatalf("reload row: %v", err)
	}
	if got.Status != models.WithdrawalPayoutCompleted {
		t.Fatalf("want completed, got %q", got.Status)
	}
}

// P0-3: a submitted withdrawal whose tx is NOT proven failed must never be
// auto-refunded (it may still land); it is parked for manual review instead.
func TestFailAndRefund_SubmittedUnproven_ParksWithoutRefund(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "withdrawal_payout_queue", "wallet_ledger_entries", "ledger_journals", "ledger_journal_lines", "spending_records")
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("worker-park"), "buyer")
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatalf("wallet: %v", err)
	}
	wallet.BalanceSOL = 5.0
	db.DB.Save(&wallet)

	row := seedPayoutRow(t, user.ID, models.WithdrawalPayoutSubmitted, "pending_sig", 2.0)
	withTxHook(t, func(ctx context.Context, signature string) (*rpc.GetTransactionResult, error) {
		return nil, errors.New("transaction not found")
	})

	failAndRefundWithdrawal(row, "test: must not refund")

	var got models.WithdrawalPayout
	db.DB.First(&got, "id = ?", row.ID)
	if got.Status != models.WithdrawalPayoutOpsRequired {
		t.Fatalf("want ops_required, got %q", got.Status)
	}
	db.DB.Where("user_id = ?", user.ID).First(&wallet)
	if wallet.BalanceSOL != 5.0 {
		t.Fatalf("balance must be unchanged (no refund), got %.6f", wallet.BalanceSOL)
	}
	var refunds int64
	db.DB.Model(&models.WalletLedgerEntry{}).Where("type = ?", "withdrawal_failed_refund").Count(&refunds)
	if refunds != 0 {
		t.Fatalf("no refund ledger entry expected, got %d", refunds)
	}
}

// P0-3: refunding the same reference twice credits exactly once.
func TestFailAndRefund_DoubleRefundGuard(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "withdrawal_payout_queue", "wallet_ledger_entries", "ledger_journals", "ledger_journal_lines", "spending_records")
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("worker-dblrefund"), "buyer")
	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", user.ID).First(&wallet).Error; err != nil {
		t.Fatalf("wallet: %v", err)
	}
	wallet.BalanceSOL = 3.0
	db.DB.Save(&wallet)

	row := seedPayoutRow(t, user.ID, models.WithdrawalPayoutFunding, "", 2.0)

	failAndRefundWithdrawal(row, "first failure")
	// Simulate a second driver acting on a stale copy of the row.
	failAndRefundWithdrawal(row, "second failure")

	db.DB.Where("user_id = ?", user.ID).First(&wallet)
	if wallet.BalanceSOL != 5.0 {
		t.Fatalf("want exactly one 2 SOL refund (balance 5.0), got %.6f", wallet.BalanceSOL)
	}
	var refunds int64
	db.DB.Model(&models.WalletLedgerEntry{}).
		Where("reference_id = ? AND type = ?", row.Reference, "withdrawal_failed_refund").Count(&refunds)
	if refunds != 1 {
		t.Fatalf("want exactly 1 refund ledger entry, got %d", refunds)
	}
}

// P0-3: stale "paying" rows (ambiguous send outcome) are parked, not re-sent.
func TestParkStalePayingWithdrawals_ParksStaleRows(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "withdrawal_payout_queue")
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("worker-stale"), "buyer")
	row := seedPayoutRow(t, user.ID, models.WithdrawalPayoutPaying, "", 1.0)
	if err := db.DB.Model(&models.WithdrawalPayout{}).Where("id = ?", row.ID).
		Update("updated_at", row.CreatedAt.Add(-2*withdrawalPayingStaleAfter)).Error; err != nil {
		t.Fatalf("age row: %v", err)
	}

	parkStalePayingWithdrawals()

	var got models.WithdrawalPayout
	db.DB.First(&got, "id = ?", row.ID)
	if got.Status != models.WithdrawalPayoutOpsRequired {
		t.Fatalf("want ops_required, got %q", got.Status)
	}
}
