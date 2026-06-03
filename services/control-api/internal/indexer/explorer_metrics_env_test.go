package indexer

import (
	"testing"
	"time"
)

func TestExplorerMetricsIntervalFromEnvDefaults(t *testing.T) {
	t.Setenv("EXPLORER_METRICS_INTERVAL", "")
	got := ExplorerMetricsIntervalFromEnv()
	if got != 10*time.Minute {
		t.Fatalf("default interval = %v, want 10m", got)
	}
}

func TestExplorerMetricsIntervalFromEnvParsesHours(t *testing.T) {
	t.Setenv("EXPLORER_METRICS_INTERVAL", "1h")
	got := ExplorerMetricsIntervalFromEnv()
	if got != time.Hour {
		t.Fatalf("interval = %v, want 1h", got)
	}
}
