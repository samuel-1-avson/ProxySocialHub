package api

import (
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
