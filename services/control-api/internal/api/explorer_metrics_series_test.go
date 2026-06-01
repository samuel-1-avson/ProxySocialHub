package api

import "testing"

func TestExplorerMetricsUnavailableMessage(t *testing.T) {
	if got := explorerMetricsUnavailableMessage(false); got == "" {
		t.Fatal("expected default message")
	}
	custom := explorerMetricsUnavailableMessage(true)
	if custom == "" || custom == explorerMetricsUnavailableMessage(false) {
		t.Fatalf("expected distinct custom-range message, got %q", custom)
	}
}
