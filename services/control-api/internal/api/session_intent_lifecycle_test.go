package api

import (
	"testing"
	"time"

	"github.com/proxyhubb/control-api/internal/models"
)

func TestCanAutoExpireSessionIntent(t *testing.T) {
	tests := []struct {
		name  string
		state models.SessionIntentLifecycle
		want  bool
	}{
		{name: "authorized can auto expire", state: models.SessionIntentAuthorized, want: true},
		{name: "routed can auto expire", state: models.SessionIntentRouted, want: true},
		{name: "active does not auto expire", state: models.SessionIntentActive, want: false},
		{name: "ledger committed does not auto expire", state: models.SessionIntentLedgerCommitted, want: false},
		{name: "expired does not auto expire", state: models.SessionIntentExpired, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := canAutoExpireSessionIntent(test.state); got != test.want {
				t.Fatalf("canAutoExpireSessionIntent(%q) = %v, want %v", test.state, got, test.want)
			}
		})
	}
}

func TestCanAdvanceGatewaySessionIntentLifecycle(t *testing.T) {
	tests := []struct {
		name string
		from models.SessionIntentLifecycle
		to   models.SessionIntentLifecycle
		want bool
	}{
		{name: "authorized to routed", from: models.SessionIntentAuthorized, to: models.SessionIntentRouted, want: true},
		{name: "routed to active", from: models.SessionIntentRouted, to: models.SessionIntentActive, want: true},
		{name: "active to closing", from: models.SessionIntentActive, to: models.SessionIntentClosing, want: true},
		{name: "closing to ledger committed", from: models.SessionIntentClosing, to: models.SessionIntentLedgerCommitted, want: true},
		{name: "same state is idempotent", from: models.SessionIntentClosing, to: models.SessionIntentClosing, want: true},
		{name: "authorized cannot jump to ledger committed", from: models.SessionIntentAuthorized, to: models.SessionIntentLedgerCommitted, want: false},
		{name: "ledger committed is terminal for gateway", from: models.SessionIntentLedgerCommitted, to: models.SessionIntentActive, want: false},
		{name: "expired cannot reopen", from: models.SessionIntentExpired, to: models.SessionIntentActive, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := canAdvanceGatewaySessionIntentLifecycle(test.from, test.to); got != test.want {
				t.Fatalf("canAdvanceGatewaySessionIntentLifecycle(%q, %q) = %v, want %v", test.from, test.to, got, test.want)
			}
		})
	}
}

func TestCanAdvanceSettlementSessionIntentLifecycle(t *testing.T) {
	tests := []struct {
		name string
		from models.SessionIntentLifecycle
		to   models.SessionIntentLifecycle
		want bool
	}{
		{name: "ledger committed to batched", from: models.SessionIntentLedgerCommitted, to: models.SessionIntentBatched, want: true},
		{name: "batched to chain committed", from: models.SessionIntentBatched, to: models.SessionIntentChainCommitted, want: true},
		{name: "chain committed to archived", from: models.SessionIntentChainCommitted, to: models.SessionIntentArchived, want: true},
		{name: "same state is idempotent", from: models.SessionIntentBatched, to: models.SessionIntentBatched, want: true},
		{name: "ledger committed cannot jump to archived", from: models.SessionIntentLedgerCommitted, to: models.SessionIntentArchived, want: false},
		{name: "authorized cannot jump into settlement", from: models.SessionIntentAuthorized, to: models.SessionIntentBatched, want: false},
		{name: "archived cannot reopen", from: models.SessionIntentArchived, to: models.SessionIntentChainCommitted, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := canAdvanceSettlementSessionIntentLifecycle(test.from, test.to); got != test.want {
				t.Fatalf("canAdvanceSettlementSessionIntentLifecycle(%q, %q) = %v, want %v", test.from, test.to, got, test.want)
			}
		})
	}
}

func TestApplySessionIntentLifecycleTransitionSetsExpectedTimestamp(t *testing.T) {
	now := time.Date(2026, time.April, 14, 10, 0, 0, 0, time.UTC)
	record := &models.SessionIntentRecord{}
	updates := map[string]interface{}{}

	applySessionIntentLifecycleTransition(record, updates, models.SessionIntentClosing, now)

	if got, ok := updates["lifecycle_state"]; !ok || got != models.SessionIntentClosing {
		t.Fatalf("expected lifecycle_state to be closing, got %#v", got)
	}
	if got, ok := updates["closing_at"]; !ok || got != now {
		t.Fatalf("expected closing_at to be set to %v, got %#v", now, got)
	}
	if _, ok := updates["activated_at"]; ok {
		t.Fatalf("did not expect activated_at to be backfilled")
	}
}

func TestApplySessionIntentLifecycleTransitionSetsSettlementTimestamps(t *testing.T) {
	now := time.Date(2026, time.April, 14, 11, 30, 0, 0, time.UTC)

	tests := []struct {
		name         string
		next         models.SessionIntentLifecycle
		timestampKey string
	}{
		{name: "batched timestamp", next: models.SessionIntentBatched, timestampKey: "batched_at"},
		{name: "chain committed timestamp", next: models.SessionIntentChainCommitted, timestampKey: "chain_committed_at"},
		{name: "archived timestamp", next: models.SessionIntentArchived, timestampKey: "archived_at"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			record := &models.SessionIntentRecord{}
			updates := map[string]interface{}{}

			applySessionIntentLifecycleTransition(record, updates, test.next, now)

			if got, ok := updates["lifecycle_state"]; !ok || got != test.next {
				t.Fatalf("expected lifecycle_state to be %q, got %#v", test.next, got)
			}
			if got, ok := updates[test.timestampKey]; !ok || got != now {
				t.Fatalf("expected %s to be set to %v, got %#v", test.timestampKey, now, got)
			}
		})
	}
}
