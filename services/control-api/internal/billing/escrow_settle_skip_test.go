package billing

import (
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
)

func TestEvaluateEscrowCustodialGate_FlagOff(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_ESCROW_PDA", "false")
	session := &models.Session{ID: uuid.New()}
	skip, refuse, _ := evaluateEscrowCustodialGate(session)
	if skip || refuse {
		t.Fatal("expected no skip/refuse when flag off")
	}
}

func TestShouldSkipCustodialSettleForEscrow_FlagOff(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_ESCROW_PDA", "false")
	session := &models.Session{ID: uuid.New()}
	skip, _ := shouldSkipCustodialSettleForEscrow(session)
	if skip {
		t.Fatal("expected no skip when flag off")
	}
}

func TestEvaluateEscrowCustodialGate_NilSessionRefusesWhenFlagOn(t *testing.T) {
	t.Setenv("PROXYHUB_REQUIRE_ESCROW_PDA", "true")
	skip, refuse, reason := evaluateEscrowCustodialGate(nil)
	if skip || !refuse || reason != "nil_session" {
		t.Fatalf("expected refuse nil_session, got skip=%v refuse=%v reason=%q", skip, refuse, reason)
	}
}
