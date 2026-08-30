package api

import (
	"context"
	"testing"

	"github.com/proxyhubb/control-api/internal/models"
)

func TestOrderUsesMultisigSettle(t *testing.T) {
	if orderUsesMultisigSettle(nil) {
		t.Fatal("nil order")
	}
	if orderUsesMultisigSettle(&models.Order{}) {
		t.Fatal("empty kind should be legacy")
	}
	if orderUsesMultisigSettle(&models.Order{EscrowSeedKind: "legacy"}) {
		t.Fatal("legacy")
	}
	if !orderUsesMultisigSettle(&models.Order{EscrowSeedKind: "multisig"}) {
		t.Fatal("want multisig")
	}
	if !orderUsesMultisigSettle(&models.Order{EscrowSeedKind: "MultiSig"}) {
		t.Fatal("case insensitive")
	}
}

func TestChainUsedUnitsFromBytes_SubGiB(t *testing.T) {
	order := &models.Order{BandwidthGB: 1, BandwidthLimitGB: 1}
	got := chainUsedUnitsFromBytes(context.Background(), order, 115073280)
	if got != 107170 {
		t.Fatalf("got %d want 107170 micro-GiB", got)
	}
	if chainUsedUnitsFromBytes(context.Background(), order, 0) != 0 {
		t.Fatal("zero bytes must settle as unused (buyer refund)")
	}
}

func TestOrderPurchasedGiB(t *testing.T) {
	if orderPurchasedGiB(&models.Order{BandwidthGB: 1.5}) != 1.5 {
		t.Fatal("prefer BandwidthGB")
	}
	if orderPurchasedGiB(&models.Order{BandwidthLimitGB: 2}) != 2 {
		t.Fatal("legacy whole-GiB column")
	}
}
