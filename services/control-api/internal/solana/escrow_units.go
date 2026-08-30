package solana

import (
	"math/big"
)

const (
	// BytesPerGiB is the marketplace GiB (1024^3), matching session.bytes_used.
	BytesPerGiB = 1024 * 1024 * 1024
	// EscrowUnitsPerGiB is the on-chain bandwidth_limit_gb / bandwidth_used_gb
	// scale. The program pays amount * used / limit with integer division, so a
	// 1 GiB account with limit=1 can only pay 0% or 100%. Micro-GiB (1e6 units
	// per GiB) lets a 0.107 GiB session pay ~10.7% and refund the rest.
	EscrowUnitsPerGiB uint64 = 1_000_000
)

// LimitUnitsFromGiB is the value written to initializeEscrow.bandwidth_limit_gb.
func LimitUnitsFromGiB(gb float64) uint64 {
	if gb <= 0 {
		return 0
	}
	units := uint64(gb*float64(EscrowUnitsPerGiB) + 0.5)
	if units == 0 {
		return 1
	}
	return units
}

// PurchasedBytes is the byte cap implied by a purchased GiB amount.
func PurchasedBytes(gb float64) int64 {
	if gb <= 0 {
		return BytesPerGiB
	}
	return int64(gb*float64(BytesPerGiB) + 0.5)
}

// ChainLimitLooksLikeWholeGiB reports pre-micro-GiB escrows (limit is a small
// integer GiB count). Sub-GiB usage floors to 0 units on those accounts.
func ChainLimitLooksLikeWholeGiB(chainLimit uint64) bool {
	return chainLimit > 0 && chainLimit < EscrowUnitsPerGiB
}

// ScaleUsedToLimit converts consumed bytes into the same unit as chainLimit.
// used = floor(usedBytes * chainLimit / purchasedBytes), capped at chainLimit.
func ScaleUsedToLimit(usedBytes, purchasedBytes int64, chainLimit uint64) uint64 {
	if usedBytes <= 0 || chainLimit == 0 {
		return 0
	}
	if purchasedBytes <= 0 {
		purchasedBytes = BytesPerGiB
	}
	if usedBytes >= purchasedBytes {
		return chainLimit
	}
	num := new(big.Int).SetInt64(usedBytes)
	num.Mul(num, new(big.Int).SetUint64(chainLimit))
	den := new(big.Int).SetInt64(purchasedBytes)
	num.Div(num, den)
	if !num.IsUint64() {
		return chainLimit
	}
	out := num.Uint64()
	if out > chainLimit {
		return chainLimit
	}
	return out
}

// UsedUnitsFromBytes is ScaleUsedToLimit against a 1 GiB micro-GiB account.
func UsedUnitsFromBytes(usedBytes int64) uint64 {
	return ScaleUsedToLimit(usedBytes, BytesPerGiB, EscrowUnitsPerGiB)
}
