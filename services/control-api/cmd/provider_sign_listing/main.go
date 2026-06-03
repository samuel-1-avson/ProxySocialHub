// provider_sign_listing signs a listing create/update payload with the provider
// Ed25519 key used by provider-node heartbeats.
//
// The output can be sent to the Control API listing create/update endpoints.
package main

import (
	"crypto/ed25519"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/mr-tron/base58"
	providerProofs "github.com/proxyhubb/control-api/internal/proofs"
)

type listingRequest struct {
	Title                 string                `json:"title"`
	Description           string                `json:"description"`
	ProviderNodeID        *uuid.UUID            `json:"provider_node_id,omitempty"`
	ProxyType             string                `json:"proxy_type"`
	Protocol              string                `json:"protocol"`
	RotationType          string                `json:"rotation_type,omitempty"`
	Country               string                `json:"country,omitempty"`
	ISP                   string                `json:"isp,omitempty"`
	PricePerGB            float64               `json:"price_per_gb"`
	MinPurchaseGB         float64               `json:"min_purchase_gb,omitempty"`
	AvailableBandwidthGB  float64               `json:"available_bandwidth_gb"`
	MaxConcurrency        int                   `json:"max_concurrency,omitempty"`
	Status                string                `json:"status,omitempty"`
	ListingOfferExpiresAt int64                 `json:"listing_offer_expires_at,omitempty"`
	Proof                 providerProofEnvelope `json:"proof,omitempty"`
}

type providerProofEnvelope struct {
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

func main() {
	envFile := flag.String("env-file", "", "path to .env")
	inputPath := flag.String("input", "", "listing JSON file (default: stdin)")
	outputPath := flag.String("output", "", "write signed listing JSON to file (default: stdout)")
	signingKey := flag.String("signing-key", "", "base58 Ed25519 seed/keypair (default: PROXYHUB_PROVIDER_SIGNING_KEY)")
	providerNodeIDRaw := flag.String("provider-node-id", "", "provider_nodes.id (default: JSON provider_node_id or latest node matching signer)")
	gatewayNodeID := flag.String("gateway-node-id", "", "gateway node identity (default: DB lookup when DATABASE_URL is set)")
	status := flag.String("status", "", "canonical listing status to sign (default: JSON status or active)")
	proofOnly := flag.Bool("proof-only", false, "emit only the proof envelope")
	flag.Parse()

	loadEnv(*envFile)

	req, err := readListingRequest(*inputPath)
	if err != nil {
		fatal("%v", err)
	}

	seed := strings.TrimSpace(*signingKey)
	if seed == "" {
		seed = strings.TrimSpace(os.Getenv("PROXYHUB_PROVIDER_SIGNING_KEY"))
	}
	privateKey, publicKey, err := decodeSigningKey(seed)
	if err != nil {
		fatal("%v", err)
	}
	publicKeyBase58 := base58.Encode(publicKey)

	var providerNodeID uuid.UUID
	if req.ProviderNodeID != nil {
		providerNodeID = *req.ProviderNodeID
	}
	if id := strings.TrimSpace(*providerNodeIDRaw); id != "" {
		parsed, err := uuid.Parse(id)
		if err != nil {
			fatal("invalid provider-node-id: %v", err)
		}
		providerNodeID = parsed
	}
	if providerNodeID == uuid.Nil {
		fatal("provider node id is required (set provider_node_id in JSON or pass -provider-node-id)")
	}
	req.ProviderNodeID = &providerNodeID
	resolvedGatewayNodeID := strings.TrimSpace(*gatewayNodeID)

	rotationType := req.RotationType
	if rotationType == "" {
		rotationType = "static"
	}
	maxConcurrency := req.MaxConcurrency
	if maxConcurrency <= 0 {
		maxConcurrency = 5
	}
	canonicalStatus := req.Status
	if *status != "" {
		canonicalStatus = *status
	}
	if canonicalStatus == "" {
		canonicalStatus = "active"
	}

	issuedAt := time.Now().UTC().Unix()
	payloadHash := providerProofs.HashListingOfferPayload(providerProofs.ListingOfferPayload{
		ProviderNodeID:       providerNodeID,
		GatewayNodeID:        resolvedGatewayNodeID,
		Title:                req.Title,
		Description:          req.Description,
		ProxyType:            req.ProxyType,
		Protocol:             req.Protocol,
		RotationType:         rotationType,
		Country:              req.Country,
		ISP:                  req.ISP,
		PricePerGB:           req.PricePerGB,
		MinPurchaseGB:        req.MinPurchaseGB,
		AvailableBandwidthGB: req.AvailableBandwidthGB,
		MaxConcurrency:       maxConcurrency,
		Status:               canonicalStatus,
		ExpiresAt:            req.ListingOfferExpiresAt,
	})
	envelope := providerProofs.ProviderProofEnvelope{
		MessageType:    providerProofs.ListingOfferMessageType,
		Version:        providerProofs.ProviderProofVersion,
		ProviderNodeID: providerNodeID.String(),
		GatewayNodeID:  resolvedGatewayNodeID,
		ProviderHotkey: publicKeyBase58,
		IssuedAt:       issuedAt,
		Nonce:          uuid.NewString(),
		PayloadHash:    payloadHash,
	}
	signature := ed25519.Sign(privateKey, []byte(providerProofs.BuildProviderProofMessage(envelope)))
	req.RotationType = rotationType
	req.MaxConcurrency = maxConcurrency
	req.Status = canonicalStatus
	req.Proof = providerProofEnvelope{
		MessageType:    envelope.MessageType,
		Version:        envelope.Version,
		ProviderNodeID: envelope.ProviderNodeID,
		GatewayNodeID:  envelope.GatewayNodeID,
		ProviderHotkey: envelope.ProviderHotkey,
		IssuedAt:       envelope.IssuedAt,
		Nonce:          envelope.Nonce,
		PayloadHash:    envelope.PayloadHash,
		Signature:      base58.Encode(signature),
	}

	if *proofOnly {
		writeJSON(*outputPath, req.Proof)
		return
	}
	writeJSON(*outputPath, req)
}

func loadEnv(path string) {
	if path != "" {
		_ = godotenv.Load(path)
		return
	}
	_ = godotenv.Load(".env")
}

func readListingRequest(path string) (listingRequest, error) {
	var data []byte
	var err error
	if path == "" || path == "-" {
		data, err = io.ReadAll(os.Stdin)
	} else {
		data, err = os.ReadFile(path)
	}
	if err != nil {
		return listingRequest{}, fmt.Errorf("read listing JSON: %w", err)
	}
	var req listingRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return listingRequest{}, fmt.Errorf("parse listing JSON: %w", err)
	}
	return req, nil
}

func decodeSigningKey(secret string) (ed25519.PrivateKey, ed25519.PublicKey, error) {
	if secret == "" {
		return nil, nil, fmt.Errorf("signing key is required (set -signing-key or PROXYHUB_PROVIDER_SIGNING_KEY)")
	}
	bytes, err := base58.Decode(secret)
	if err != nil {
		return nil, nil, fmt.Errorf("signing key must be base58: %w", err)
	}
	var privateKey ed25519.PrivateKey
	switch len(bytes) {
	case ed25519.SeedSize:
		privateKey = ed25519.NewKeyFromSeed(bytes)
	case ed25519.PrivateKeySize:
		privateKey = ed25519.PrivateKey(bytes)
	default:
		return nil, nil, fmt.Errorf("signing key must be %d or %d bytes, got %d", ed25519.SeedSize, ed25519.PrivateKeySize, len(bytes))
	}
	return privateKey, privateKey.Public().(ed25519.PublicKey), nil
}

func writeJSON(path string, value any) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		fatal("marshal output: %v", err)
	}
	if path == "" || path == "-" {
		_, _ = os.Stdout.Write(data)
		_, _ = os.Stdout.Write([]byte("\n"))
		return
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		fatal("write output: %v", err)
	}
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "provider_sign_listing: "+format+"\n", args...)
	os.Exit(1)
}
