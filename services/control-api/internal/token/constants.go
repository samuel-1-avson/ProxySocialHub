package token

const (
	PHBDecimals           uint64  = 1_000_000_000
	PHBDecimalsFloat64    float64 = 1_000_000_000
	PHBProposalMinimumRaw uint64  = 100 * PHBDecimals
)

func PHBFromRaw(raw uint64) float64 {
	return float64(raw) / PHBDecimalsFloat64
}
