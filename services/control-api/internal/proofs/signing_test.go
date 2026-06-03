package proofs

import (
	"crypto/ed25519"
	"testing"

	"github.com/google/uuid"
	"github.com/mr-tron/base58"
)

func TestSignListingOffer_Verifies(t *testing.T) {
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(i + 1)
	}
	priv, pub, err := DecodeSigningKey(base58.Encode(seed))
	if err != nil {
		t.Fatal(err)
	}
	_ = pub

	nodeID := uuid.New()
	envelope, err := SignListingOffer(priv, ListingOfferPayload{
		ProviderNodeID:       nodeID,
		GatewayNodeID:        "node_test",
		Title:                "Test listing",
		ProxyType:            "residential",
		Protocol:             "http",
		RotationType:         "static",
		Country:              "US",
		PricePerGB:           1.5,
		MinPurchaseGB:        1,
		AvailableBandwidthGB: 10,
		MaxConcurrency:       5,
		Status:               "active",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyProviderProof(envelope, ListingOfferMessageType, envelope.ProviderHotkey, envelope.PayloadHash, 0); err != nil {
		t.Fatalf("verify: %v", err)
	}
}
