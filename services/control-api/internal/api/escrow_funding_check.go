package api

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
)

const (
	// escrowShortfallToleranceBps is how far under the quote an on-chain escrow may be and
	// still count as funded, in basis points. The quote is computed in floating point and
	// the wallet signs the lamport amount the API returned, so honest escrows match; the
	// slack only absorbs rounding. It is nowhere near enough to make a cheat worthwhile.
	escrowShortfallToleranceBps = 100

	// sessionEscrowFloorLamports is the minimum the fund/solana quote endpoints apply when
	// the computed amount rounds to zero.
	sessionEscrowFloorLamports uint64 = 1_000_000
)

// escrowFundingProblem is a reason an on-chain escrow cannot back the order or session
// being activated.
type escrowFundingProblem struct {
	Status  int
	Code    string
	Message string
}

// minLamportsForQuote is the smallest escrow amount accepted for a quote.
func minLamportsForQuote(quotedSOL float64) uint64 {
	quote := models.SOLToLamports(quotedSOL)
	if quote == 0 {
		return sessionEscrowFloorLamports
	}
	return quote - quote*escrowShortfallToleranceBps/10_000
}

// checkOrderEscrowFunding verifies that the on-chain escrow holds at least the amount
// quoted for the order and allows at least the bandwidth purchased. Before this, only
// "amount > 0" was checked, so a one-lamport escrow could activate a large order.
func checkOrderEscrowFunding(order *models.Order, escrow *solana.Escrow) *escrowFundingProblem {
	if order.AmountLockedSOL <= 0 {
		return &escrowFundingProblem{
			Status:  http.StatusConflict,
			Code:    "escrow_quote_missing",
			Message: "This order has no escrow quote. Call POST .../pay/solana first so the required amount is recorded.",
		}
	}
	if min := minLamportsForQuote(order.AmountLockedSOL); escrow.Amount < min {
		return &escrowFundingProblem{
			Status:  http.StatusConflict,
			Code:    "escrow_underfunded",
			Message: "On-chain escrow holds less than the order price.",
		}
	}
	if order.BandwidthGB > 0 && !escrowBandwidthCoversOrder(escrow.BandwidthLimitGB, order.BandwidthGB) {
		return &escrowFundingProblem{
			Status:  http.StatusConflict,
			Code:    "escrow_bandwidth_too_small",
			Message: "On-chain escrow bandwidth limit is smaller than the bandwidth ordered.",
		}
	}
	return nil
}

// escrowBandwidthCoversOrder compares the escrow's bandwidth_limit_gb with the order. New
// escrows count micro-GiB (EscrowUnitsPerGiB per GiB); escrows from before that change
// count whole GiB, so a small limit is read as a GiB count.
func escrowBandwidthCoversOrder(chainLimit uint64, orderGiB float64) bool {
	if chainLimit >= solana.LimitUnitsFromGiB(orderGiB) {
		return true
	}
	if solana.ChainLimitLooksLikeWholeGiB(chainLimit) {
		wholeGiB := uint64(orderGiB)
		if wholeGiB == 0 {
			wholeGiB = 1
		}
		return chainLimit >= wholeGiB
	}
	return false
}

// checkSessionEscrowFunding verifies a session escrow against the quote stored by the
// fund/solana step: amount at least the quoted amount, bandwidth at least what the
// session was sized for.
func checkSessionEscrowFunding(quotedSOL float64, bandwidthLimitBytes int64, escrow *solana.SessionEscrowData) *escrowFundingProblem {
	if min := minLamportsForQuote(quotedSOL); escrow.Amount < min {
		return &escrowFundingProblem{
			Status:  http.StatusConflict,
			Code:    "session_escrow_underfunded",
			Message: "On-chain session escrow holds less than the quoted amount.",
		}
	}
	if bandwidthLimitBytes > 0 && escrow.BandwidthLimitBytes < uint64(bandwidthLimitBytes) {
		return &escrowFundingProblem{
			Status:  http.StatusConflict,
			Code:    "session_escrow_bandwidth_too_small",
			Message: "On-chain session escrow bandwidth limit is smaller than the session's limit.",
		}
	}
	return nil
}

// orderEscrowBoundElsewhere reports whether another order that is still using the
// escrow already holds this PDA. Legacy escrow PDAs are one account per buyer/seller
// pair, so a second order confirmed against the same funded escrow would get service
// paid for by the first. Pending and cancelled orders do not hold the escrow; completed
// and refunded orders have released it.
func orderEscrowBoundElsewhere(tx *gorm.DB, escrowPDA string, orderID uuid.UUID) (bool, error) {
	if escrowPDA == "" {
		return false, nil
	}
	var n int64
	err := tx.Model(&models.Order{}).
		Where("escrow_pda = ? AND id <> ? AND status IN ?", escrowPDA, orderID,
			[]models.OrderStatus{models.OrderStatusActive, models.OrderStatusDisputed}).
		Count(&n).Error
	return n > 0, err
}
