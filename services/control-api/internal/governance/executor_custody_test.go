package governance

import (
	"testing"

	"github.com/proxyhubb/control-api/internal/models"
)

func TestCheckProposalOutcomeQuorum(t *testing.T) {
	e := NewProposalExecutor()
	p := models.Proposal{YesVotes: 60, NoVotes: 40, Quorum: 100}
	if !e.checkProposalOutcome(p) {
		t.Fatal("expected pass with majority + quorum")
	}
	p.Quorum = 101
	if e.checkProposalOutcome(p) {
		t.Fatal("expected fail when total below quorum")
	}
	p = models.Proposal{YesVotes: 40, NoVotes: 60, Quorum: 10}
	if e.checkProposalOutcome(p) {
		t.Fatal("expected fail when no >= yes")
	}
}

func TestErrTreasuryAwaitingCustodySentinel(t *testing.T) {
	if ErrTreasuryAwaitingCustody == nil || ErrTreasuryAwaitingCustody.Error() == "" {
		t.Fatal("custody sentinel must be defined")
	}
}
