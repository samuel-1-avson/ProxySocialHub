package api

import "testing"

func TestExplorerSuccessRatePercent(t *testing.T) {
	tests := []struct {
		raw  float64
		want float64
	}{
		{0, 0},
		{0.95, 95},
		{1, 100},
		{95, 95},
		{100, 100},
		{150, 100},
	}
	for _, tc := range tests {
		if got := explorerSuccessRatePercent(tc.raw); got != tc.want {
			t.Fatalf("explorerSuccessRatePercent(%v) = %v, want %v", tc.raw, got, tc.want)
		}
	}
}

func TestExplorerNodeSearchPatternEscapesWildcards(t *testing.T) {
	got := explorerNodeSearchPattern(`a%b_c`)
	if got != `%a\%b\_c%` {
		t.Fatalf("pattern = %q", got)
	}
}
