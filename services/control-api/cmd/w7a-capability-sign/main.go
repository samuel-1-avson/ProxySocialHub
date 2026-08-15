package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/proxyhubb/control-api/internal/proofs"
)

type inDoc struct {
	// SigningKey is the issuer Ed25519 secret (platform or a verified bundle operator).
	SigningKey     string `json:"signing_key"`
	SessionID      string `json:"session_id"`
	OfferHash      string `json:"offer_hash"`
	BuyerID        string `json:"buyer_id"`
	ExpiresAt      int64  `json:"expires_at"`
	BandwidthLimit int64  `json:"bandwidth_limit"`
	OperatorPubkey string `json:"operator_pubkey"`
	Username       string `json:"username"`
	IssuedAt       int64  `json:"issued_at"`
}

type outDoc struct {
	Canonical      string `json:"canonical"`
	Signature      string `json:"signature"`
	IssuerPubkey   string `json:"issuer_pubkey"`
	OperatorPubkey string `json:"operator_pubkey"`
	UsernameHash   string `json:"username_hash"`
	IssuedAt       int64  `json:"issued_at"`
	ExpiresAt      int64  `json:"expires_at"`
	Token          string `json:"token"`
}

func main() {
	var in inDoc
	if err := json.NewDecoder(os.Stdin).Decode(&in); err != nil {
		fmt.Fprintf(os.Stderr, "stdin json: %v\n", err)
		os.Exit(2)
	}
	issued := in.IssuedAt
	if issued <= 0 {
		issued = time.Now().UTC().Unix()
	}
	expires := in.ExpiresAt
	if expires <= 0 {
		expires = issued + 7200
	}
	p := proofs.SessionCapabilityPayload{
		SessionID:      strings.TrimSpace(in.SessionID),
		OfferHash:      strings.TrimSpace(in.OfferHash),
		BuyerID:        strings.TrimSpace(in.BuyerID),
		ExpiresAt:      expires,
		BandwidthLimit: in.BandwidthLimit,
		OperatorPubkey: strings.TrimSpace(in.OperatorPubkey),
		UsernameHash:   proofs.HashCredentialsUsername(in.Username),
		IssuedAt:       issued,
	}
	sig, issuer, err := proofs.SignSessionCapability(p, in.SigningKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "sign: %v\n", err)
		os.Exit(2)
	}
	if p.OperatorPubkey == "" {
		p.OperatorPubkey = issuer
	}
	wire, err := proofs.EncodeSessionCapabilityToken(p, sig, issuer)
	if err != nil {
		fmt.Fprintf(os.Stderr, "token: %v\n", err)
		os.Exit(2)
	}
	out := outDoc{
		Canonical:      string(proofs.CanonicalSessionCapabilityBytes(p)),
		Signature:      sig,
		IssuerPubkey:   issuer,
		OperatorPubkey: p.OperatorPubkey,
		UsernameHash:   p.UsernameHash,
		IssuedAt:       p.IssuedAt,
		ExpiresAt:      p.ExpiresAt,
		Token:          wire,
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(out); err != nil {
		fmt.Fprintf(os.Stderr, "encode: %v\n", err)
		os.Exit(2)
	}
}
