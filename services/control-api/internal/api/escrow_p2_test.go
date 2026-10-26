package api

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/testutil"
	"github.com/proxyhubb/control-api/internal/models"
)

// W-25 shared vectors: integer mirror of on-chain settle maths
// seller = amount * min(used, limit) / limit.
func TestProportionalLamports_Vectors_P2(t *testing.T) {
	cases := []struct {
		name string
		amt  int64
		used int64
		lim  int64
		skim bool
		want int64
	}{
		{"zero usage", 1_000_000_000, 0, 1 << 30, false, 0},
		{"full usage", 1_000_000_000, 1 << 30, 1 << 30, false, 1_000_000_000},
		{"half usage", 1_000_000_000, 1 << 29, 1 << 30, false, 500_000_000},
		{"over usage clamps", 1_000_000_000, 2 << 30, 1 << 30, false, 1_000_000_000},
		{"fee skim 10%", 1_000_000_000, 1 << 30, 1 << 30, true, 900_000_000},
		{"zero limit", 1_000_000_000, 100, 0, false, 0},
		{"dust no overflow", 1, 1, 1 << 40, false, 0},
		{"huge safe", 100_000_000_000, 1 << 39, 1 << 40, false, 50_000_000_000},
	}
	for _, c := range cases {
		if got := proportionalLamports(c.amt, c.used, c.lim, c.skim); got != c.want {
			t.Errorf("%s: got %d want %d", c.name, got, c.want)
		}
	}
}

// W-25 regression: missing order/session linkage previously paid 100%
// (old float helper returned full escrow amount on any lookup failure).
func TestUsageProportional_FailsClosed_P2(t *testing.T) {
	testutil.SetupTestDB(t)
	escrow := models.EscrowTransaction{
		OrderID: uuid.New(), BuyerID: uuid.New(), SellerID: uuid.New(),
		Amount: 1.0, Status: models.EscrowHeld,
	}
	got, err := usageProportionalSellerLamports(db.DB, escrow)
	if err == nil || !errors.Is(err, ErrEscrowUsageDataMissing) {
		t.Fatalf("missing order must fail closed: got %d err %v", got, err)
	}
	if got != 0 {
		t.Fatalf("fail-closed must pay 0, got %d", got)
	}
}
