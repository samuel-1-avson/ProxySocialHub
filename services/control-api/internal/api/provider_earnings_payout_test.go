package api

import (
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

type recordingPayouts struct{ calls atomic.Int32 }

func (r *recordingPayouts) QueuePayout(uuid.UUID, string, float64, []string) error {
	r.calls.Add(1)
	return nil
}

type earningFixture struct {
	provider models.User
	session  models.Session
}

// newEarningFixture creates a provider with a payable wallet address and a finished
// non-escrow session served by its node.
func newEarningFixture(t *testing.T) earningFixture {
	t.Helper()
	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("earn-provider"), "provider")
	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("earn-buyer"), "buyer")

	node := models.ProviderNode{
		ID:            uuid.New(),
		UserID:        provider.ID,
		Name:          "earnings-node",
		Status:        models.NodeOnline,
		IsHealthy:     true,
		IPAddress:     "10.0.0.9",
		Port:          1080,
		WalletAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuGui4Q5G",
	}
	if err := db.DB.Create(&node).Error; err != nil {
		t.Fatalf("create node: %v", err)
	}
	mirrorID := testutil.CreateTestNodeMirror(t, &node)
	session := models.Session{
		UserID:          buyer.ID,
		NodeID:          &mirrorID,
		Type:            models.SessionRotating,
		Status:          models.SessionTerminated,
		CredentialsUser: strings.ReplaceAll(uuid.NewString(), "-", "")[:16],
		CredentialsPass: "pass",
		Config:          "{}",
		BytesUsed:       2 * 1024 * 1024 * 1024,
	}
	if err := db.DB.Create(&session).Error; err != nil {
		t.Fatalf("create session: %v", err)
	}
	return earningFixture{provider: *provider, session: session}
}

func loadEarning(t *testing.T, sessionID uuid.UUID) models.ProviderEarning {
	t.Helper()
	var e models.ProviderEarning
	if err := db.DB.Where("session_id = ?", sessionID).First(&e).Error; err != nil {
		t.Fatalf("expected a provider_earnings row for the session: %v", err)
	}
	return e
}

// BE-CRIT-02: recordProviderEarning used to queue a direct on-chain payout for every
// non-escrow session, on top of the billing worker crediting the same session to the
// provider's wallet (and paying that balance out). It is bookkeeping only now.
func TestRecordProviderEarning_DoesNotQueueADirectPayout(t *testing.T) {
	testutil.SetupTestDB(t)
	fx := newEarningFixture(t)

	payouts := &recordingPayouts{}
	prev := GetBatchPayoutProcessor()
	SetBatchPayoutProcessor(payouts)
	t.Cleanup(func() { SetBatchPayoutProcessor(prev) })

	recordProviderEarning(fx.session, fx.session.BytesUsed, 0.5, 0.1)

	if n := payouts.calls.Load(); n != 0 {
		t.Fatalf("recordProviderEarning queued %d direct payout(s); the billing worker already pays this session", n)
	}
	e := loadEarning(t, fx.session.ID)
	if e.Status != "pending" || e.PaidAt != nil {
		t.Fatalf("earning should start pending, got status %q paid_at %v", e.Status, e.PaidAt)
	}
}

// If the billing worker credited the provider before the row was created, the row must
// not start as pending: a pending row is what a claim would pay a second time.
func TestRecordProviderEarning_RowIsPaidWhenAlreadyCredited(t *testing.T) {
	testutil.SetupTestDB(t)
	fx := newEarningFixture(t)

	var wallet models.Wallet
	if err := db.DB.Where("user_id = ?", fx.provider.ID).First(&wallet).Error; err != nil {
		t.Fatalf("provider wallet: %v", err)
	}
	credit := models.WalletLedgerEntry{
		ID:           uuid.New(),
		WalletID:     wallet.ID,
		Amount:       0.5,
		BalanceAfter: wallet.BalanceSOL + 0.5,
		Type:         "provider_earning",
		ReferenceID:  fx.session.ID.String() + ":provider",
		Description:  "test credit",
	}
	if err := db.DB.Create(&credit).Error; err != nil {
		t.Fatalf("seed ledger credit: %v", err)
	}

	recordProviderEarning(fx.session, fx.session.BytesUsed, 0.5, 0.1)

	e := loadEarning(t, fx.session.ID)
	if e.Status != "paid" || e.PaidAt == nil {
		t.Fatalf("earning for an already-credited session should be paid, got status %q paid_at %v", e.Status, e.PaidAt)
	}
}
