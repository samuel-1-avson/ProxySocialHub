package models_test

import (
	"testing"

	"github.com/proxyhubb/control-api/internal/decentralization"
)

func TestJournalAsSoTFlagDefaultOff(t *testing.T) {
	t.Setenv("PROXYHUB_JOURNAL_AS_SOT", "")
	if decentralization.JournalAsSoTEnabled() {
		t.Fatal("expected JournalAsSoT default false")
	}
	t.Setenv("PROXYHUB_JOURNAL_AS_SOT", "true")
	if !decentralization.JournalAsSoTEnabled() {
		t.Fatal("expected JournalAsSoT true")
	}
}

func TestJournalShadowReadFollowsSoTWhenUnset(t *testing.T) {
	t.Setenv("PROXYHUB_JOURNAL_SHADOW_READ", "")
	t.Setenv("PROXYHUB_JOURNAL_AS_SOT", "true")
	if !decentralization.JournalShadowReadEnabled() {
		t.Fatal("shadow should default on when JournalAsSoT on")
	}
	t.Setenv("PROXYHUB_JOURNAL_AS_SOT", "false")
	if decentralization.JournalShadowReadEnabled() {
		t.Fatal("shadow should default off when JournalAsSoT off and env unset")
	}
}
