package proofs

import (
	"crypto/ed25519"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mr-tron/base58"
)

// DecodeSigningKey parses a base58 Ed25519 seed (32 bytes) or private key (64 bytes).
func DecodeSigningKey(secret string) (ed25519.PrivateKey, ed25519.PublicKey, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return nil, nil, fmt.Errorf("signing key is required")
	}
	raw, err := base58.Decode(secret)
	if err != nil {
		return nil, nil, fmt.Errorf("signing key must be base58: %w", err)
	}
	var privateKey ed25519.PrivateKey
	switch len(raw) {
	case ed25519.SeedSize:
		privateKey = ed25519.NewKeyFromSeed(raw)
	case ed25519.PrivateKeySize:
		privateKey = ed25519.PrivateKey(raw)
	default:
		return nil, nil, fmt.Errorf("signing key must be %d or %d bytes, got %d", ed25519.SeedSize, ed25519.PrivateKeySize, len(raw))
	}
	return privateKey, privateKey.Public().(ed25519.PublicKey), nil
}

// SignListingOffer builds and signs a listing offer proof envelope.
func SignListingOffer(privateKey ed25519.PrivateKey, payload ListingOfferPayload) (ProviderProofEnvelope, error) {
	if payload.ProviderNodeID == uuid.Nil {
		return ProviderProofEnvelope{}, fmt.Errorf("provider node id is required")
	}
	issuedAt := time.Now().UTC().Unix()
	if payload.Status == "" {
		payload.Status = "active"
	}
	if payload.RotationType == "" {
		payload.RotationType = "static"
	}
	if payload.MaxConcurrency <= 0 {
		payload.MaxConcurrency = 5
	}

	payloadHash := HashListingOfferPayload(payload)
	envelope := ProviderProofEnvelope{
		MessageType:    ListingOfferMessageType,
		Version:        ProviderProofVersion,
		ProviderNodeID: payload.ProviderNodeID.String(),
		GatewayNodeID:  payload.GatewayNodeID,
		ProviderHotkey: base58.Encode(privateKey.Public().(ed25519.PublicKey)),
		IssuedAt:       issuedAt,
		Nonce:          uuid.NewString(),
		PayloadHash:    payloadHash,
	}
	sig := ed25519.Sign(privateKey, []byte(BuildProviderProofMessage(envelope)))
	envelope.Signature = base58.Encode(sig)
	return envelope, nil
}
