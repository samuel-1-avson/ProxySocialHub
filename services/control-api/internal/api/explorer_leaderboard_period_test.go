package api

import (
	"testing"
	"time"

	"github.com/proxyhubb/control-api/internal/models"
)

func TestExplorerPeriodSince(t *testing.T) {
	now := time.Now()
	tests := []struct {
		period   string
		minHours float64
		maxHours float64
	}{
		{"1h", 0.9, 1.1},
		{"24h", 23, 25},
		{"7d", 167, 169},
		{"30d", 719, 721},
		{"invalid", 23, 25},
	}
	for _, tc := range tests {
		since := explorerPeriodSince(tc.period)
		elapsed := now.Sub(since).Hours()
		if elapsed < tc.minHours || elapsed > tc.maxHours {
			t.Fatalf("explorerPeriodSince(%q) = %v ago (%.2fh), want %.1f–%.1fh",
				tc.period, since, elapsed, tc.minHours, tc.maxHours)
		}
	}
}

func TestExplorerLeaderboardEntryFromNodeCapsQualityScore(t *testing.T) {
	entry := explorerLeaderboardEntryFromNode(models.ExplorerNode{
		NodeID:        "node-1",
		UptimePercent: 100,
	}, 500, 10_000)
	if entry.QualityScore != 100 {
		t.Fatalf("expected quality score capped at 100, got %v", entry.QualityScore)
	}
}
