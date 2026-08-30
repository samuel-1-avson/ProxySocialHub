package solana

import "testing"

func TestLimitUnitsFromGiB(t *testing.T) {
	if got := LimitUnitsFromGiB(1); got != EscrowUnitsPerGiB {
		t.Fatalf("1 GiB: got %d want %d", got, EscrowUnitsPerGiB)
	}
	if got := LimitUnitsFromGiB(2); got != 2*EscrowUnitsPerGiB {
		t.Fatalf("2 GiB: got %d", got)
	}
	if got := LimitUnitsFromGiB(0.5); got != EscrowUnitsPerGiB/2 {
		t.Fatalf("0.5 GiB: got %d", got)
	}
	if LimitUnitsFromGiB(0) != 0 {
		t.Fatal("0 GiB should be 0")
	}
}

func TestScaleUsedToLimit_SubGiBShopSession(t *testing.T) {
	// Live session ab5d020b: 115,073,280 bytes of a 1 GiB order.
	const usedBytes int64 = 115073280
	units := ScaleUsedToLimit(usedBytes, BytesPerGiB, EscrowUnitsPerGiB)
	if units == 0 || units == EscrowUnitsPerGiB {
		t.Fatalf("sub-GiB usage must be a proper fraction, got %d", units)
	}
	if units != 107170 {
		t.Fatalf("got %d want 107170 (115073280 * 1e6 / 2^30)", units)
	}
	legacy := ScaleUsedToLimit(usedBytes, BytesPerGiB, 1)
	if legacy != 0 {
		t.Fatalf("legacy limit=1 must floor sub-GiB to 0, got %d", legacy)
	}
}

func TestScaleUsedToLimit_ZeroAndCap(t *testing.T) {
	if ScaleUsedToLimit(0, BytesPerGiB, EscrowUnitsPerGiB) != 0 {
		t.Fatal("zero bytes")
	}
	if got := ScaleUsedToLimit(BytesPerGiB, BytesPerGiB, EscrowUnitsPerGiB); got != EscrowUnitsPerGiB {
		t.Fatalf("full GiB: got %d", got)
	}
	if got := ScaleUsedToLimit(BytesPerGiB*2, BytesPerGiB, EscrowUnitsPerGiB); got != EscrowUnitsPerGiB {
		t.Fatalf("over cap: got %d", got)
	}
}

func TestChainLimitLooksLikeWholeGiB(t *testing.T) {
	if !ChainLimitLooksLikeWholeGiB(1) || !ChainLimitLooksLikeWholeGiB(10) {
		t.Fatal("small limits are legacy GiB")
	}
	if ChainLimitLooksLikeWholeGiB(EscrowUnitsPerGiB) {
		t.Fatal("micro-GiB limit is not legacy")
	}
}
