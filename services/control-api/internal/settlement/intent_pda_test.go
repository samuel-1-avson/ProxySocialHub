package settlement

import (
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/models"
)

func TestShouldSettleOnChainIntentPDA(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_SESSION_PDA", "true")
	rec := &models.SessionIntentRecord{
		ID:            uuid.New(),
		SessionPDA:    "SomePDA111111111111111111111111111111111111",
		PaymentMethod: paymentMethodSessionEscrow,
	}
	if !shouldSettleOnChainIntentPDA(rec) {
		t.Fatal("expected on-chain settle when PDA + payment method set")
	}

	t.Setenv("PROXYHUB_REQUIRE_SESSION_PDA", "false")
	rec2 := &models.SessionIntentRecord{ID: uuid.New()}
	if shouldSettleOnChainIntentPDA(rec2) {
		t.Fatal("expected custodial when no PDA")
	}

	// payment_method alone with PDA still settles on-chain even if flag off
	rec3 := &models.SessionIntentRecord{
		ID:            uuid.New(),
		SessionPDA:    "SomePDA111111111111111111111111111111111111",
		PaymentMethod: paymentMethodSessionEscrow,
	}
	if !shouldSettleOnChainIntentPDA(rec3) {
		t.Fatal("expected on-chain when payment_method=solana_session_escrow")
	}
	_ = os.Unsetenv("PROXYHUB_REQUIRE_SESSION_PDA")
}

func TestRequireSessionPDABlocksCustodialIntentSettle(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_SESSION_PDA", "true")
	rec := &models.SessionIntentRecord{ID: uuid.New()}
	if shouldSettleOnChainIntentPDA(rec) {
		t.Fatal("no PDA should not settle on-chain")
	}
	// Fail-closed gate used by SettleSessionIntent before custodial path.
	if !decentralization.RequireSessionPDAEnabled() {
		t.Fatal("flag should be on")
	}
}

