package api

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestExplorerIndexLag(t *testing.T) {
	now := time.Date(2026, 11, 3, 18, 39, 0, 0, time.UTC)
	cases := []struct {
		name    string
		head    time.Time
		seconds int64
		ok      bool
	}{
		{"fresh", now.Add(-20 * time.Second), 20, true},
		{"behind by an hour and a half", now.Add(-97 * time.Minute), 5820, true},
		{"sub-second age rounds down", now.Add(-900 * time.Millisecond), 0, true},
		{"block time slightly ahead of this clock", now.Add(5 * time.Second), 0, true},
		{"no block time", time.Time{}, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			seconds, ok := explorerIndexLag(tc.head, now)
			if seconds != tc.seconds || ok != tc.ok {
				t.Fatalf("explorerIndexLag = (%d, %v), want (%d, %v)", seconds, ok, tc.seconds, tc.ok)
			}
		})
	}
}

func TestApplyExplorerIndexLagRecomputesFromTheHeadTime(t *testing.T) {
	now := time.Date(2026, 11, 3, 18, 39, 0, 0, time.UTC)
	head := now.Add(-10 * time.Minute)
	stale := int64(5) // what a cached response carried when it was stored
	response := ExplorerMetricsResponse{IndexedHeadTime: &head, IndexedLagSeconds: &stale}

	applyExplorerIndexLag(&response, now)

	if response.IndexedLagSeconds == nil || *response.IndexedLagSeconds != 600 {
		t.Fatalf("lag = %v, want 600", response.IndexedLagSeconds)
	}
}

func TestApplyExplorerIndexLagLeavesUnknownUnknown(t *testing.T) {
	stale := int64(5)
	response := ExplorerMetricsResponse{IndexedLagSeconds: &stale}

	applyExplorerIndexLag(&response, time.Now())

	if response.IndexedLagSeconds != nil {
		t.Fatalf("lag = %d, want it dropped when there is no head time", *response.IndexedLagSeconds)
	}
}

func TestExplorerMetricsOmitsFreshnessWhenUnknown(t *testing.T) {
	unknown, err := json.Marshal(ExplorerMetricsResponse{})
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"indexed_head_time", "indexed_lag_seconds"} {
		if strings.Contains(string(unknown), key) {
			t.Fatalf("%s must be omitted, not sent as zero: %s", key, unknown)
		}
	}

	head := time.Date(2026, 11, 3, 17, 1, 58, 0, time.UTC)
	lag := int64(5820)
	known, err := json.Marshal(ExplorerMetricsResponse{IndexedHeadTime: &head, IndexedLagSeconds: &lag})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"indexed_head_time":"2026-11-03T17:01:58Z"`, `"indexed_lag_seconds":5820`} {
		if !strings.Contains(string(known), want) {
			t.Fatalf("missing %s in %s", want, known)
		}
	}
}
