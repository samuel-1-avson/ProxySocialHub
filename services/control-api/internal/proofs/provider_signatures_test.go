package proofs

import (
	"crypto/ed25519"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/mr-tron/base58"
)

func TestVerifyProviderProof_ValidHeartbeat(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	providerNodeID := uuid.New()
	payloadHash := HashHeartbeatPayload(HeartbeatPayload{
		ProviderNodeID:    providerNodeID,
		GatewayNodeID:     "node_provider",
		LatencyMs:         25,
		ActiveConnections: 3,
		UptimePercent:     100,
		IssuedAt:          time.Now().Unix(),
	})
	envelope := ProviderProofEnvelope{
		MessageType:    ProviderHeartbeatMessageType,
		Version:        ProviderProofVersion,
		ProviderNodeID: providerNodeID.String(),
		GatewayNodeID:  "node_provider",
		ProviderHotkey: base58.Encode(publicKey),
		IssuedAt:       time.Now().Unix(),
		Nonce:          uuid.NewString(),
		PayloadHash:    payloadHash,
	}
	envelope.Signature = base58.Encode(ed25519.Sign(privateKey, []byte(BuildProviderProofMessage(envelope))))

	if err := VerifyProviderProof(envelope, ProviderHeartbeatMessageType, base58.Encode(publicKey), payloadHash, time.Minute); err != nil {
		t.Fatalf("expected valid proof: %v", err)
	}
}

func TestVerifyProviderProof_RejectsPayloadMismatch(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	envelope := ProviderProofEnvelope{
		MessageType:    ProviderHeartbeatMessageType,
		Version:        ProviderProofVersion,
		ProviderNodeID: uuid.NewString(),
		GatewayNodeID:  "node_provider",
		ProviderHotkey: base58.Encode(publicKey),
		IssuedAt:       time.Now().Unix(),
		Nonce:          uuid.NewString(),
		PayloadHash:    "bad",
	}
	envelope.Signature = base58.Encode(ed25519.Sign(privateKey, []byte(BuildProviderProofMessage(envelope))))

	if err := VerifyProviderProof(envelope, ProviderHeartbeatMessageType, base58.Encode(publicKey), "expected", time.Minute); err == nil {
		t.Fatal("expected payload mismatch to fail")
	}
}
