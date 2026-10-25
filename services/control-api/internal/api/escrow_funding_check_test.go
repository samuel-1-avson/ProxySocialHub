package api

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"github.com/proxyhubb/control-api/internal/testutil"
)

const oneSOL = 1_000_000_000

func problemCode(p *escrowFundingProblem) string {
	if p == nil {
		return ""
	}
	return p.Code
}

// BE-CRIT-03: confirmEscrow used to accept any escrow with amount > 0, so a one-lamport
// escrow could activate a large order.
func TestCheckOrderEscrowFunding(t *testing.T) {
	order := func(quoteSOL, gb float64) *models.Order {
		return &models.Order{AmountLockedSOL: quoteSOL, BandwidthGB: gb}
	}
	escrow := func(amount, limit uint64) *solana.Escrow {
		return &solana.Escrow{Amount: amount, BandwidthLimitGB: limit}
	}
	micro := func(gb float64) uint64 { return solana.LimitUnitsFromGiB(gb) }

	cases := []struct {
		name   string
		order  *models.Order
		escrow *solana.Escrow
		want   string
	}{
		{"one lamport for a 20 SOL order", order(20, 100), escrow(1, micro(100)), "escrow_underfunded"},
		{"exact quote and bandwidth", order(2, 5), escrow(2*oneSOL, micro(5)), ""},
		{"more than the quote", order(2, 5), escrow(3*oneSOL, micro(5)), ""},
		{"within the 1% rounding slack", order(2, 5), escrow(2*oneSOL-2*oneSOL/200, micro(5)), ""},
		{"2% short", order(2, 5), escrow(2*oneSOL-2*oneSOL/50, micro(5)), "escrow_underfunded"},
		{"no quote recorded", order(0, 5), escrow(oneSOL, micro(5)), "escrow_quote_missing"},
		{"bandwidth limit of one micro-unit", order(2, 5), escrow(2*oneSOL, 1), "escrow_bandwidth_too_small"},
		{"bandwidth limit below the order", order(2, 5), escrow(2*oneSOL, micro(4)), "escrow_bandwidth_too_small"},
		{"legacy whole-GiB escrow covering the order", order(2, 2), escrow(2*oneSOL, 2), ""},
		{"legacy whole-GiB escrow too small", order(2, 3), escrow(2*oneSOL, 2), "escrow_bandwidth_too_small"},
		{"sub-GiB order on a legacy escrow", order(1, 0.5), escrow(oneSOL, 1), ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := problemCode(checkOrderEscrowFunding(tc.order, tc.escrow))
			if got != tc.want {
				t.Fatalf("problem = %q, want %q", got, tc.want)
			}
		})
	}

	if p := checkOrderEscrowFunding(order(20, 100), escrow(1, micro(100))); p == nil || p.Status != http.StatusConflict {
		t.Fatalf("expected a 409 problem, got %+v", p)
	}
}

func TestCheckSessionEscrowFunding(t *testing.T) {
	const gib = int64(1024 * 1024 * 1024)
	esc := func(amount uint64, limit int64) *solana.SessionEscrowData {
		return &solana.SessionEscrowData{Amount: amount, BandwidthLimitBytes: uint64(limit)}
	}
	cases := []struct {
		name   string
		quote  float64
		bw     int64
		escrow *solana.SessionEscrowData
		want   string
	}{
		{"one lamport for a quoted session", 0.5, gib, esc(1, gib), "session_escrow_underfunded"},
		{"funded to the quote", 0.5, gib, esc(oneSOL/2, gib), ""},
		{"bandwidth below the session's limit", 0.5, 2 * gib, esc(oneSOL/2, gib), "session_escrow_bandwidth_too_small"},
		{"unlimited session skips the bandwidth check", 0.5, 0, esc(oneSOL/2, 1), ""},
		{"quote rounded to zero uses the floor", 0, gib, esc(1, gib), "session_escrow_underfunded"},
		{"quote rounded to zero, floor met", 0, gib, esc(sessionEscrowFloorLamports, gib), ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := problemCode(checkSessionEscrowFunding(tc.quote, tc.bw, tc.escrow))
			if got != tc.want {
				t.Fatalf("problem = %q, want %q", got, tc.want)
			}
		})
	}
}

func newBindingOrder(t *testing.T, pda string, status models.OrderStatus) models.Order {
	t.Helper()
	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("bind-provider"), "provider")
	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("bind-buyer"), "buyer")
	listing := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "binding listing",
		PricePerGB:           1,
		AvailableBandwidthGB: 10,
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("create listing: %v", err)
	}
	o := models.Order{
		BuyerID: buyer.ID, SellerID: provider.ID, ListingID: listing.ID,
		BandwidthGB: 1, PricePerGB: 1, TotalPrice: 1,
		Status: status, EscrowPDA: pda,
	}
	if err := db.DB.Create(&o).Error; err != nil {
		t.Fatalf("create order: %v", err)
	}
	return o
}

// A legacy escrow PDA is one account per buyer/seller pair. An order that is already
// active on it must block a second order from being confirmed against the same funds.
func TestOrderEscrowBoundElsewhere(t *testing.T) {
	testutil.SetupTestDB(t)

	pda := "BindPDA" + uuid.NewString()[:8]
	holder := newBindingOrder(t, pda, models.OrderStatusActive)
	candidate := newBindingOrder(t, pda, models.OrderStatusPendingPayment)

	if bound, err := orderEscrowBoundElsewhere(db.DB, pda, candidate.ID); err != nil || !bound {
		t.Fatalf("candidate should see the PDA held by an active order: bound=%v err=%v", bound, err)
	}
	if bound, err := orderEscrowBoundElsewhere(db.DB, pda, holder.ID); err != nil || bound {
		t.Fatalf("the active order itself should not count as bound elsewhere: bound=%v err=%v", bound, err)
	}

	// Once the first order has released the escrow, the PDA can back a new order.
	if err := db.DB.Model(&models.Order{}).Where("id = ?", holder.ID).Update("status", models.OrderStatusCompleted).Error; err != nil {
		t.Fatalf("complete holder: %v", err)
	}
	if bound, err := orderEscrowBoundElsewhere(db.DB, pda, candidate.ID); err != nil || bound {
		t.Fatalf("a completed order must not hold the PDA: bound=%v err=%v", bound, err)
	}

	if bound, err := orderEscrowBoundElsewhere(db.DB, "", candidate.ID); err != nil || bound {
		t.Fatalf("empty PDA is never bound: bound=%v err=%v", bound, err)
	}
}
