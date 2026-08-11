package treasury

import (
	"os"
	"strings"
)

// minHotSweepSOL avoids proposing dust sweeps.
const minHotSweepSOL = 0.05

// SweepEnabled reports whether hot→cold excess sweep proposals are allowed.
// Default on when unset; set SOLANA_TREASURY_SWEEP_ENABLED=false to disable.
func SweepEnabled() bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("SOLANA_TREASURY_SWEEP_ENABLED")))
	if raw == "" {
		return true
	}
	return raw == "1" || raw == "true" || raw == "yes" || raw == "on"
}

// ExcessHotSweepSOL returns how much SOL to move hot→cold so hot returns to hotMax.
// Returns 0 when below max or excess is dust.
func ExcessHotSweepSOL(balanceSOL, hotMaxSOL float64) float64 {
	if hotMaxSOL <= 0 || balanceSOL <= hotMaxSOL {
		return 0
	}
	excess := balanceSOL - hotMaxSOL
	if excess < minHotSweepSOL {
		return 0
	}
	return excess
}
