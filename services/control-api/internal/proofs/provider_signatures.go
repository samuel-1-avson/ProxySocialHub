package proofs

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mr-tron/base58"
)

const (
	ProviderHeartbeatMessageType = "PROXYHUB_PROVIDER_HEARTBEAT"
	ListingOfferMessageType      = "PROXYHUB_LISTING_OFFER"
	ProviderProofVersion         = "v1"
)

// ProviderProofEnvelope is the common signature wrapper for provider-authored data.
type ProviderProofEnvelope struct {
	MessageType    string `json:"message_type"`
	Version        string `json:"version"`
	ProviderNodeID string `json:"provider_node_id"`
	GatewayNodeID  string `json:"gateway_node_id,omitempty"`
	ProviderHotkey string `json:"provider_hotkey"`
	IssuedAt       int64  `json:"issued_at"`
	Nonce          string `json:"nonce"`
	PayloadHash    string `json:"payload_hash"`
	Signature      string `json:"signature"`
}

type HeartbeatPayload struct {
	ProviderNodeID    uuid.UUID
	GatewayNodeID     string
	LatencyMs         int
	ActiveConnections int
	UptimePercent     float64
	IssuedAt          int64
}

type ListingOfferPayload struct {
	ProviderNodeID       uuid.UUID
	GatewayNodeID        string
	Title                string
	Description          string
	ProxyType            string
	Protocol             string
	RotationType         string
	Country              string
	ISP                  string
	PricePerGB           float64
	MinPurchaseGB        float64
	AvailableBandwidthGB float64
	MaxConcurrency       int
	Status               string
	ExpiresAt            int64
}

func VerifyProviderProof(envelope ProviderProofEnvelope, expectedMessageType, expectedHotkey, expectedPayloadHash string, maxAge time.Duration) error {
	if strings.TrimSpace(envelope.MessageType) != expectedMessageType {
		return fmt.Errorf("unexpected proof message type")
	}
	if strings.TrimSpace(envelope.Version) != ProviderProofVersion {
		return fmt.Errorf("unsupported proof version")
	}
	if strings.TrimSpace(envelope.ProviderHotkey) == "" {
		return fmt.Errorf("provider hotkey is required")
	}
	if expectedHotkey != "" && envelope.ProviderHotkey != expectedHotkey {
		return fmt.Errorf("provider hotkey does not match registered node")
	}
	if !strings.EqualFold(strings.TrimSpace(envelope.PayloadHash), strings.TrimSpace(expectedPayloadHash)) {
		return fmt.Errorf("payload hash mismatch")
	}
	if envelope.IssuedAt <= 0 {
		return fmt.Errorf("issued_at is required")
	}
	if maxAge > 0 {
		issued := time.Unix(envelope.IssuedAt, 0)
		if time.Since(issued) > maxAge || time.Until(issued) > 2*time.Minute {
			return fmt.Errorf("proof timestamp outside accepted window")
		}
	}
	if strings.TrimSpace(envelope.Nonce) == "" {
		return fmt.Errorf("nonce is required")
	}

	pubKeyBytes, err := base58.Decode(envelope.ProviderHotkey)
	if err != nil || len(pubKeyBytes) != ed25519.PublicKeySize {
		return fmt.Errorf("invalid provider hotkey")
	}
	sigBytes, err := base58.Decode(envelope.Signature)
	if err != nil || len(sigBytes) != ed25519.SignatureSize {
		return fmt.Errorf("invalid provider signature")
	}
	if !ed25519.Verify(pubKeyBytes, []byte(BuildProviderProofMessage(envelope)), sigBytes) {
		return fmt.Errorf("provider signature verification failed")
	}
	return nil
}

func BuildProviderProofMessage(envelope ProviderProofEnvelope) string {
	return fmt.Sprintf("%s:%s:%s:%s:%s:%d:%s:%s",
		envelope.MessageType,
		envelope.Version,
		envelope.ProviderNodeID,
		envelope.GatewayNodeID,
		envelope.ProviderHotkey,
		envelope.IssuedAt,
		envelope.Nonce,
		envelope.PayloadHash,
	)
}

func HashHeartbeatPayload(payload HeartbeatPayload) string {
	msg := fmt.Sprintf("PROXYHUB_HEARTBEAT_PAYLOAD:v1:%s:%s:%d:%d:%.6f:%d",
		payload.ProviderNodeID.String(),
		payload.GatewayNodeID,
		payload.LatencyMs,
		payload.ActiveConnections,
		payload.UptimePercent,
		payload.IssuedAt,
	)
	return sha256Hex(msg)
}

func HashListingOfferPayload(payload ListingOfferPayload) string {
	msg := fmt.Sprintf("PROXYHUB_LISTING_OFFER_PAYLOAD:v1:%s:%s:%s:%s:%s:%s:%s:%s:%s:%.9f:%.9f:%.9f:%d:%s:%d",
		payload.ProviderNodeID.String(),
		payload.GatewayNodeID,
		payload.Title,
		payload.Description,
		payload.ProxyType,
		payload.Protocol,
		payload.RotationType,
		payload.Country,
		payload.ISP,
		payload.PricePerGB,
		payload.MinPurchaseGB,
		payload.AvailableBandwidthGB,
		payload.MaxConcurrency,
		payload.Status,
		payload.ExpiresAt,
	)
	return sha256Hex(msg)
}

func sha256Hex(message string) string {
	sum := sha256.Sum256([]byte(message))
	return hex.EncodeToString(sum[:])
}
