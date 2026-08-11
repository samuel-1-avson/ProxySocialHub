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
// Prefers BalanceLamports when it matches BalanceSOL (or BalanceSOL is zero);
// otherwise uses stored BalanceLamports as the dual-write SoT.
func (w *Wallet) EffectiveBalanceLamports() int64 {
	fromSOL := int64(SOLToLamports(w.BalanceSOL))
	if w.BalanceLamports == fromSOL {
		return w.BalanceLamports
	}
	if w.BalanceLamports == 0 {
		return fromSOL
	}
	return w.BalanceLamports
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
