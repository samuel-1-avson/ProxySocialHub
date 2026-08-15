package governance

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	solanaClient "github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestExecuteTreasuryTransfer_queuesPendingCustodyWhenUnarmed(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "treasury_transactions")
	t.Setenv("PROXYHUB_GOV_TREASURY_AUTO_SPEND", "")
	t.Setenv("PROXYHUB_GOV_TREASURY_EXECUTE_CONFIRM", "")

	proposalID := uuid.New()
	payload, _ := json.Marshal(TreasuryTransfer{
		Recipient:   "11111111111111111111111111111111",
		Amount:      0.01,
		Currency:    "SOL",
		Description: "w5c3-custody",
	})
	e := NewProposalExecutor()
	err := e.executeTreasuryTransfer(models.Proposal{
		ID:            proposalID,
		Type:          models.ProposalTypeTreasury,
		Status:        models.ProposalPassed,
		ExecutionData: string(payload),
	})
	if !errors.Is(err, ErrTreasuryAwaitingCustody) {
		t.Fatalf("expected ErrTreasuryAwaitingCustody, got %v", err)
	}
	var row models.TreasuryTransaction
	if err := db.DB.Where("proposal_id = ?", proposalID).First(&row).Error; err != nil {
		t.Fatalf("treasury row: %v", err)
	}
	if row.Status != "pending_custody" {
		t.Fatalf("status=%s", row.Status)
	}
}

func TestExecuteTreasuryTransfer_autoSpendWithoutConfirmStillCustody(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "treasury_transactions")
	t.Setenv("PROXYHUB_GOV_TREASURY_AUTO_SPEND", "true")
	t.Setenv("PROXYHUB_GOV_TREASURY_EXECUTE_CONFIRM", "")

	proposalID := uuid.New()
	payload, _ := json.Marshal(TreasuryTransfer{
		Recipient: "11111111111111111111111111111111",
		Amount:    0.02,
		Currency:  "SOL",
	})
	e := NewProposalExecutor()
	err := e.executeTreasuryTransfer(models.Proposal{
		ID:            proposalID,
		Status:        models.ProposalPassed,
		ExecutionData: string(payload),
	})
	if !errors.Is(err, ErrTreasuryAwaitingCustody) {
		t.Fatalf("expected custody without confirm, got %v", err)
	}
}

func TestExecuteTreasuryTransfer_dualGatedHotWalletSend(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "treasury_transactions")
	t.Setenv("PROXYHUB_GOV_TREASURY_AUTO_SPEND", "true")
	t.Setenv("PROXYHUB_GOV_TREASURY_EXECUTE_CONFIRM", "1")

	prevOracle := solanaClient.GetOracleClient()
	solanaClient.SetOracleClientForTest(&solanaClient.OracleClient{})
	prevHook := solanaClient.SendSOLTestHook
	solanaClient.SendSOLTestHook = func(ctx context.Context, c *solanaClient.OracleClient, recipient sol.PublicKey, lamports uint64) (string, error) {
		if lamports == 0 {
			t.Fatal("lamports must be non-zero")
		}
		return "w5c3TestSig1111111111111111111111111111111111111111111111", nil
	}
	t.Cleanup(func() {
		solanaClient.SendSOLTestHook = prevHook
		solanaClient.SetOracleClientForTest(prevOracle)
	})

	// Valid base58 pubkey (System Program)
	recipient := sol.SystemProgramID.String()
	proposalID := uuid.New()
	payload, _ := json.Marshal(TreasuryTransfer{
		Recipient:   recipient,
		Amount:      0.001,
		Currency:    "SOL",
		Description: "w5c3-dual-gate",
	})
	e := NewProposalExecutor()
	err := e.executeTreasuryTransfer(models.Proposal{
		ID:            proposalID,
		Status:        models.ProposalPassed,
		ExecutionData: string(payload),
	})
	if err != nil {
		t.Fatalf("dual-gated execute: %v", err)
	}
	var row models.TreasuryTransaction
	if err := db.DB.Where("proposal_id = ?", proposalID).First(&row).Error; err != nil {
		t.Fatalf("treasury row: %v", err)
	}
	if row.Status != "executed" || row.TxHash == "" {
		t.Fatalf("expected executed with tx_hash, got status=%s hash=%q", row.Status, row.TxHash)
	}
	if row.ExecutedAt.IsZero() || time.Since(row.ExecutedAt) > time.Minute {
		t.Fatalf("executed_at unset/odd: %v", row.ExecutedAt)
	}
}
