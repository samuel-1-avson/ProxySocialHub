package incentives

import (
	"context"
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

func TestModeDefaultOff(t *testing.T) {
	t.Setenv("PROXYHUB_PROTOCOL_INCENTIVES", "")
	if Mode() != "off" || Enabled() {
		t.Fatal("default off")
	}
	t.Setenv("PROXYHUB_PROTOCOL_INCENTIVES", "observe")
	if Mode() != "observe" || !Enabled() {
		t.Fatal("observe expected")
	}
	t.Setenv("PROXYHUB_PROTOCOL_INCENTIVES", "settle")
	if Mode() != "settle" || !SettleModeEnabled() {
		t.Fatal("settle expected")
	}
}

func TestSolSettleArmedRequiresDualGate(t *testing.T) {
	t.Setenv("PROXYHUB_PROTOCOL_INCENTIVES", "settle")
	t.Setenv("PROXYHUB_INCENTIVE_SETTLE_CONFIRM", "")
	if SolSettleArmed() {
		t.Fatal("settle without confirm must not arm")
	}
	t.Setenv("PROXYHUB_INCENTIVE_SETTLE_CONFIRM", "1")
	if !SolSettleArmed() {
		t.Fatal("settle+confirm=1 must arm")
	}
	t.Setenv("PROXYHUB_PROTOCOL_INCENTIVES", "observe")
	if SolSettleArmed() {
		t.Fatal("observe+confirm must not arm")
	}
}

func TestComputeSplit(t *testing.T) {
	t.Setenv("PROXYHUB_PROTOCOL_FEE_BPS", "1000")             // 10%
	t.Setenv("PROXYHUB_INCENTIVE_PROVIDER_SHARE_BPS", "5000") // 50% of fee
	t.Setenv("PROXYHUB_INCENTIVE_GATEWAY_SHARE_BPS", "2500")  // 25% of fee
	s := ComputeSplit(10.0)
	if s.ProtocolFeeSOL != 1.0 {
		t.Fatalf("fee=%v want 1.0", s.ProtocolFeeSOL)
	}
	if s.ProviderIncentiveSOL != 0.5 {
		t.Fatalf("provider=%v want 0.5", s.ProviderIncentiveSOL)
	}
	if s.GatewayIncentiveSOL != 0.25 {
		t.Fatalf("gateway=%v want 0.25", s.GatewayIncentiveSOL)
	}
	if s.TreasuryRetainSOL != 0.25 {
		t.Fatalf("treasury=%v want 0.25", s.TreasuryRetainSOL)
	}
}

func TestStatusMetaNoMint(t *testing.T) {
	t.Setenv("PROXYHUB_PROTOCOL_INCENTIVES", "observe")
	t.Setenv("PROXYHUB_INCENTIVE_SETTLE_CONFIRM", "")
	m := StatusMeta()
	if m["mint_enabled"] != false {
		t.Fatal("must never claim mint")
	}
	if m["sol_transfer_enabled"] != false {
		t.Fatal("observe must not enable sol transfer")
	}
}

func ensureIncentiveTable(t *testing.T) {
	t.Helper()
	testutil.SetupTestDB(t)
	if err := db.DB.AutoMigrate(&models.ProtocolIncentiveEvent{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	testutil.CleanupTestData(t, "protocol_incentive_events")
}

func TestObserveSettlement_observeOnly(t *testing.T) {
	ensureIncentiveTable(t)
	t.Setenv("PROXYHUB_PROTOCOL_INCENTIVES", "observe")
	t.Setenv("PROXYHUB_INCENTIVE_SETTLE_CONFIRM", "")

	sid := uuid.New()
	err := ObserveSettlement(SettlementInput{
		SessionID:       sid,
		ProviderUserID:  uuid.New(),
		NodeID:          uuid.New(),
		GrossSOL:        1.0,
		RecipientWallet: sol.SystemProgramID.String(),
	})
	if err != nil {
		t.Fatalf("observe: %v", err)
	}
	var row models.ProtocolIncentiveEvent
	if err := db.DB.Where("session_id = ?", sid).First(&row).Error; err != nil {
		t.Fatalf("row: %v", err)
	}
	if row.Status != "observed" || row.Mode != "observe" {
		t.Fatalf("status=%s mode=%s", row.Status, row.Mode)
	}
}

func TestObserveSettlement_settleWithoutConfirmQueuesCustody(t *testing.T) {
	ensureIncentiveTable(t)
	t.Setenv("PROXYHUB_PROTOCOL_INCENTIVES", "settle")
	t.Setenv("PROXYHUB_INCENTIVE_SETTLE_CONFIRM", "")

	sid := uuid.New()
	err := ObserveSettlement(SettlementInput{
		SessionID:       sid,
		ProviderUserID:  uuid.New(),
		NodeID:          uuid.New(),
		GrossSOL:        2.0,
		RecipientWallet: sol.SystemProgramID.String(),
	})
	if !errors.Is(err, ErrIncentiveAwaitingCustody) {
		t.Fatalf("expected custody err, got %v", err)
	}
	var row models.ProtocolIncentiveEvent
	if err := db.DB.Where("session_id = ?", sid).First(&row).Error; err != nil {
		t.Fatalf("row: %v", err)
	}
	if row.Status != "pending_custody" {
		t.Fatalf("status=%s", row.Status)
	}
}

func TestObserveSettlement_dualGatedHotWalletSettle(t *testing.T) {
	ensureIncentiveTable(t)
	t.Setenv("PROXYHUB_PROTOCOL_INCENTIVES", "settle")
	t.Setenv("PROXYHUB_INCENTIVE_SETTLE_CONFIRM", "1")
	t.Setenv("PROXYHUB_PROTOCOL_FEE_BPS", "1000")
	t.Setenv("PROXYHUB_INCENTIVE_PROVIDER_SHARE_BPS", "10000")
	t.Setenv("PROXYHUB_INCENTIVE_GATEWAY_SHARE_BPS", "0")

	prevOracle := solanaClient.GetOracleClient()
	solanaClient.SetOracleClientForTest(&solanaClient.OracleClient{})
	prevHook := solanaClient.SendSOLTestHook
	solanaClient.SendSOLTestHook = func(ctx context.Context, c *solanaClient.OracleClient, recipient sol.PublicKey, lamports uint64) (string, error) {
		if lamports == 0 {
			t.Fatal("lamports must be non-zero")
		}
		return "w5c4IncentiveSig1111111111111111111111111111111111111111", nil
	}
	t.Cleanup(func() {
		solanaClient.SendSOLTestHook = prevHook
		solanaClient.SetOracleClientForTest(prevOracle)
	})

	sid := uuid.New()
	recipient := sol.SystemProgramID.String()
	err := ObserveSettlement(SettlementInput{
		SessionID:       sid,
		ProviderUserID:  uuid.New(),
		NodeID:          uuid.New(),
		GrossSOL:        1.0, // fee=0.1, provider=0.1
		RecipientWallet: recipient,
	})
	if err != nil {
		t.Fatalf("dual-gated settle: %v", err)
	}
	var row models.ProtocolIncentiveEvent
	if err := db.DB.Where("session_id = ?", sid).First(&row).Error; err != nil {
		t.Fatalf("row: %v", err)
	}
	if row.Status != "settled" || row.TxHash == "" {
		t.Fatalf("expected settled with tx_hash, got status=%s hash=%q", row.Status, row.TxHash)
	}
	if row.SettledAt == nil || time.Since(*row.SettledAt) > time.Minute {
		t.Fatalf("settled_at unset/odd: %v", row.SettledAt)
	}
}

func TestSettlePendingCustody_fromObserved(t *testing.T) {
	ensureIncentiveTable(t)
	t.Setenv("PROXYHUB_PROTOCOL_INCENTIVES", "observe")
	t.Setenv("PROXYHUB_INCENTIVE_SETTLE_CONFIRM", "")

	sid := uuid.New()
	_ = ObserveSettlement(SettlementInput{
		SessionID:       sid,
		ProviderUserID:  uuid.New(),
		NodeID:          uuid.New(),
		GrossSOL:        1.0,
		RecipientWallet: sol.SystemProgramID.String(),
	})
	var row models.ProtocolIncentiveEvent
	if err := db.DB.Where("session_id = ?", sid).First(&row).Error; err != nil {
		t.Fatalf("row: %v", err)
	}

	// Arm settle and claim the observed accrual.
	t.Setenv("PROXYHUB_PROTOCOL_INCENTIVES", "settle")
	t.Setenv("PROXYHUB_INCENTIVE_SETTLE_CONFIRM", "1")
	prevOracle := solanaClient.GetOracleClient()
	solanaClient.SetOracleClientForTest(&solanaClient.OracleClient{})
	prevHook := solanaClient.SendSOLTestHook
	solanaClient.SendSOLTestHook = func(ctx context.Context, c *solanaClient.OracleClient, recipient sol.PublicKey, lamports uint64) (string, error) {
		return "w5c4ClaimSig1111111111111111111111111111111111111111111", nil
	}
	t.Cleanup(func() {
		solanaClient.SendSOLTestHook = prevHook
		solanaClient.SetOracleClientForTest(prevOracle)
	})

	if err := SettlePendingCustody(context.Background(), row.ID); err != nil {
		t.Fatalf("claim settle: %v", err)
	}
	if err := db.DB.Where("id = ?", row.ID).First(&row).Error; err != nil {
		t.Fatalf("reload: %v", err)
	}
	if row.Status != "settled" || row.TxHash == "" {
		t.Fatalf("expected settled, got %s %q", row.Status, row.TxHash)
	}
}
