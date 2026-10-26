package models

import "math"

// LamportsPerSOL is Solana's native subunit scale used for custodial balance math.
const LamportsPerSOL = 1_000_000_000.0

// SOLToLamports converts a SOL amount to lamports with banker's-safe rounding.
// Float64 USD/SOL storage remains for API compatibility; all mutations should
// round-trip through lamports to avoid 0.1+0.2 style drift.
func SOLToLamports(sol float64) uint64 {
	if sol <= 0 {
		return 0
	}
	return uint64(math.Round(sol * LamportsPerSOL))
}

// LamportsToSOL converts lamports back to SOL as float64.
func LamportsToSOL(lamports uint64) float64 {
	return float64(lamports) / LamportsPerSOL
}

// EffectiveBalanceLamports returns the custodial balance in lamports.
// W-19 (P1): balance_lamports is the single authoritative stored balance.
// The old heuristic derived lamports from the float balance_sol whenever
// lamports was 0 - resurrecting legitimately drained wallets whenever a
// stale float shadow survived. Legacy rows are repaired once at write
// time (BeforeSave + migration 000159), never guessed at read time.
func (w *Wallet) EffectiveBalanceLamports() int64 {
	return w.BalanceLamports
}

// BalanceDriftLamports reports stored-lamports minus float-derived
// lamports; reconciliation surfaces non-zero drift (W-19/W-18).
func (w *Wallet) BalanceDriftLamports() int64 {
	return w.BalanceLamports - int64(SOLToLamports(w.BalanceSOL))
}

// SyncLamportsFromSOLForLegacyRow reconciles the dual-write pair at
// SAVE time for writers that still assign the deprecated float field
// directly (test seeding, legacy writers): when the pair disagrees, the
// explicitly-assigned float wins for this write - the same fixed point
// the DB trigger enforces. Production money writers never assign
// BalanceSOL directly (locked helpers maintain both from lamports), so
// this cannot resurrect a drained wallet in production; the read path
// (EffectiveBalanceLamports) never guesses.
func (w *Wallet) SyncLamportsFromSOLForLegacyRow() {
	if derived := int64(SOLToLamports(w.BalanceSOL)); derived != w.BalanceLamports {
		w.BalanceLamports = derived
	}
}

// CreditLamports adds delta lamports and syncs BalanceSOL from BalanceLamports.
func (w *Wallet) CreditLamports(delta int64) {
	if delta <= 0 {
		return
	}
	w.BalanceLamports = w.EffectiveBalanceLamports() + delta
	if w.BalanceLamports < 0 {
		w.BalanceLamports = 0
	}
	w.BalanceSOL = LamportsToSOL(uint64(w.BalanceLamports))
}

// DebitLamports subtracts delta if affordable. Returns false without mutating when insufficient.
func (w *Wallet) DebitLamports(delta int64) bool {
	if delta <= 0 {
		return true
	}
	bal := w.EffectiveBalanceLamports()
	if bal < delta {
		return false
	}
	w.BalanceLamports = bal - delta
	w.BalanceSOL = LamportsToSOL(uint64(w.BalanceLamports))
	return true
}

// CanAffordLamports reports whether balance covers delta at lamports precision.
func (w *Wallet) CanAffordLamports(delta int64) bool {
	if delta <= 0 {
		return true
	}
	return w.EffectiveBalanceLamports() >= delta
}

// CreditSOL adds amount to the wallet using lamports arithmetic.
func (w *Wallet) CreditSOL(amount float64) {
	w.CreditLamports(int64(SOLToLamports(amount)))
}

// DebitSOL subtracts amount if affordable. Returns false without mutating when insufficient.
func (w *Wallet) DebitSOL(amount float64) bool {
	return w.DebitLamports(int64(SOLToLamports(amount)))
}

// CanAffordSOL reports whether balance covers amount at lamports precision.
func (w *Wallet) CanAffordSOL(amount float64) bool {
	return w.CanAffordLamports(int64(SOLToLamports(amount)))
}

// DefaultAutoPayoutThresholdLamports is the historical 0.05 SOL sweep floor.
const DefaultAutoPayoutThresholdLamports = 50_000_000

// PayableLamports returns earnings available for on-chain payout (W-10).
func (w *Wallet) PayableLamports() int64 {
	if w.EarningsPayableLamports < 0 {
		return 0
	}
	if w.EarningsPayableLamports > w.BalanceLamports {
		return w.BalanceLamports
	}
	return w.EarningsPayableLamports
}

// AutoPayoutThresholdOrDefault resolves the user's auto-payout threshold.
func (w *Wallet) AutoPayoutThresholdOrDefault() int64 {
	if w.AutoPayoutThresholdLamports > 0 {
		return w.AutoPayoutThresholdLamports
	}
	return DefaultAutoPayoutThresholdLamports
}

// clampPayableToBalance enforces payable <= balance after a debit:
// spending draws non-earnings funds first, earnings only once the rest
// is gone (W-10).
func (w *Wallet) clampPayableToBalance() {
	if w.EarningsPayableLamports > w.BalanceLamports {
		w.EarningsPayableLamports = w.BalanceLamports
	}
	if w.EarningsPayableLamports < 0 {
		w.EarningsPayableLamports = 0
	}
}
