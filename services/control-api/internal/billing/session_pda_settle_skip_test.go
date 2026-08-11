package billing

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestShouldSettleOnChainSessionPDA_FlagOffNoPDA(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_SESSION_PDA", "false")
	session := &models.Session{ID: uuid.New()}
	skip, _ := shouldSettleOnChainSessionPDA(session)
	if skip {
		t.Fatal("expected no skip when flag off and no PDA")
	}
}

func TestShouldSettleOnChainSessionPDA_WithPDA(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_SESSION_PDA", "false")
	session := &models.Session{
		ID:            uuid.New(),
		SessionPDA:    "SomePDA1111111111111111111111111111111111111",
		PaymentMethod: "solana_session_escrow",
	}
	skip, reason := shouldSettleOnChainSessionPDA(session)
	if !skip {
		t.Fatal("expected skip when session has PDA")
	}
	if reason != "session_escrow_pda" {
		t.Fatalf("reason=%q", reason)
	}
}

func TestShouldSettleOnChainSessionPDA_FlagOnRequiresPDA(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_SESSION_PDA", "true")
	session := &models.Session{ID: uuid.New()}
	skip, _ := shouldSettleOnChainSessionPDA(session)
	if skip {
		t.Fatal("expected no on-chain settle without PDA even when flag on")
	}
}

func TestRequireSessionPDABlocksCustodialBillingSettle(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_SESSION_PDA", "true")
	session := &models.Session{ID: uuid.New()}
	skip, _ := shouldSettleOnChainSessionPDA(session)
	if skip {
		t.Fatal("should not on-chain without PDA")
	}
	if !decentralization.RequireSessionPDAEnabled() {
		t.Fatal("flag should be on — settleSession must refuse custodial")
	}
}

func TestSettleSessionRefusesCustodialWhenRequireSessionPDA(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_SESSION_PDA", "true")
	t.Setenv("PROXYHUB_REQUIRE_ESCROW_PDA", "false")
	testutil.SetupTestDB(t)
	resetSettlementCBForTest(t)

	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("j1_buyer"), "buyer")
	session := models.Session{
		ID:             uuid.New(),
		UserID:         buyer.ID,
		Type:           models.SessionUniversal,
		Status:         models.SessionActive,
		Config:         "{}",
		BandwidthLimit: 1 << 30,
	}
	if err := db.DB.Create(&session).Error; err != nil {
		t.Fatalf("create session: %v", err)
	}
	redisKey := "billing:session:" + session.ID.String() + ":pending"
	err := settleSession(session.ID.String(), 1024*1024, redisKey)
	if err == nil {
		t.Fatal("expected refuse custodial settle")
	}
	if !strings.Contains(err.Error(), "PROXYHUB_REQUIRE_SESSION_PDA") {
		t.Fatalf("err=%v", err)
	}
}
