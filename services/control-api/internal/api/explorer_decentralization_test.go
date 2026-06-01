package api

import "testing"

func TestClassifyExplorerDecentralizationMode(t *testing.T) {
	tests := []struct {
		name               string
		uniqueWriters      int64
		minWriters         int64
		slotsAnalyzed      int64
		slotsMeetingQuorum int64
		conflictingSlots   int64
		expected           string
	}{
		{
			name:          "bootstrap no attestations",
			uniqueWriters: 0,
			minWriters:    2,
			expected:      "bootstrap_no_attestations",
		},
		{
			name:               "single writer centralized",
			uniqueWriters:      1,
			minWriters:         2,
			slotsAnalyzed:      128,
			slotsMeetingQuorum: 128,
			expected:           "centralized_single_writer",
		},
		{
			name:               "below threshold",
			uniqueWriters:      2,
			minWriters:         3,
			slotsAnalyzed:      128,
			slotsMeetingQuorum: 128,
			expected:           "multi_writer_below_threshold",
		},
		{
			name:               "conflicting views",
			uniqueWriters:      3,
			minWriters:         2,
			slotsAnalyzed:      128,
			slotsMeetingQuorum: 120,
			conflictingSlots:   2,
			expected:           "multi_writer_conflicting_views",
		},
		{
			name:               "partial quorum",
			uniqueWriters:      3,
			minWriters:         2,
			slotsAnalyzed:      128,
			slotsMeetingQuorum: 120,
			expected:           "multi_writer_partial_quorum",
		},
		{
			name:               "full quorum",
			uniqueWriters:      3,
			minWriters:         2,
			slotsAnalyzed:      128,
			slotsMeetingQuorum: 128,
			expected:           "multi_writer_quorum",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := classifyExplorerDecentralizationMode(
				tc.uniqueWriters,
				tc.minWriters,
				tc.slotsAnalyzed,
				tc.slotsMeetingQuorum,
				tc.conflictingSlots,
			)
			if got != tc.expected {
				t.Fatalf("expected mode %q, got %q", tc.expected, got)
			}
		})
	}
}

func TestIsExplorerFullyDecentralized(t *testing.T) {
	base := ExplorerDecentralizationStatusResponse{
		ExplorerMode:        "multi_writer_quorum",
		MinWritersRequired:  2,
		UniqueWriters:       2,
		ConflictingSlots:    0,
		RecentSlotsAnalyzed: 256,
		SlotsMeetingQuorum:  256,
	}

	if !isExplorerFullyDecentralized(base) {
		t.Fatalf("expected fully decentralized response to be true")
	}

	mutations := []ExplorerDecentralizationStatusResponse{
		func() ExplorerDecentralizationStatusResponse { r := base; r.UniqueWriters = 1; return r }(),
		func() ExplorerDecentralizationStatusResponse { r := base; r.ConflictingSlots = 1; return r }(),
		func() ExplorerDecentralizationStatusResponse { r := base; r.SlotsMeetingQuorum = 200; return r }(),
		func() ExplorerDecentralizationStatusResponse { r := base; r.RecentSlotsAnalyzed = 0; return r }(),
		func() ExplorerDecentralizationStatusResponse {
			r := base
			r.ExplorerMode = "multi_writer_partial_quorum"
			return r
		}(),
	}

	for i, resp := range mutations {
		if isExplorerFullyDecentralized(resp) {
			t.Fatalf("mutation %d should not be fully decentralized", i)
		}
	}
}
