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

// CreditSOL adds amount to the wallet using lamports arithmetic.
func (w *Wallet) CreditSOL(amount float64) {
	if amount <= 0 {
		return
	}
	w.BalanceSOL = LamportsToSOL(SOLToLamports(w.BalanceSOL) + SOLToLamports(amount))
}

// DebitSOL subtracts amount if affordable. Returns false without mutating when insufficient.
func (w *Wallet) DebitSOL(amount float64) bool {
	if amount <= 0 {
		return true
	}
	bal := SOLToLamports(w.BalanceSOL)
	need := SOLToLamports(amount)
	if bal < need {
		return false
	}
	w.BalanceSOL = LamportsToSOL(bal - need)
	return true
}

// CanAffordSOL reports whether balance covers amount at lamports precision.
func (w *Wallet) CanAffordSOL(amount float64) bool {
	if amount <= 0 {
		return true
	}
	return SOLToLamports(w.BalanceSOL) >= SOLToLamports(amount)
}
