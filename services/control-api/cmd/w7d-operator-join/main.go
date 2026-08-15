package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/gateways"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/proofs"
)

func usage() {
	fmt.Fprintf(os.Stderr, `w7d-operator-join — generate an operator key and sign a W6.B manifest locally.

The signing seed never goes to control-api. Publish only the pubkey + signed
manifest (bundle entry). ProxyHubb cannot rotate a foreign org's key.

Usage:
  w7d-operator-join keygen
  w7d-operator-join sign              < stdin JSON
  w7d-operator-join sign-from-keygen  < keygen JSON
  w7d-operator-join extract-bundle    < sign JSON

sign input:
  signing_key, slug, org_id, host_id, buyer_base_url, tunnel_addrs[], peer_urls[]
  optional: display_name, health_url, bonded, expires_at (unix)

sign-from-keygen reads keygen JSON and signs a foreign-org demo manifest
(override with W12B_SLUG / W12B_ORG_ID / W12B_HOST_ID / W12B_BUYER_BASE_URL /
W12B_HEALTH_URL / W12B_TUNNEL_ADDR). extract-bundle writes bundle JSON only
(no signing_key).

Exit 0 prints JSON. Not a live multi-org claim. See docs/ops/W12_PERMISSIONLESS_JOIN.md for the permissionless pin path.
`)
	os.Exit(2)
}

type signIn struct {
	SigningKey   string   `json:"signing_key"`
	Slug         string   `json:"slug"`
	DisplayName  string   `json:"display_name"`
	OrgID        string   `json:"org_id"`
	HostID       string   `json:"host_id"`
	BuyerBaseURL string   `json:"buyer_base_url"`
	HealthURL    string   `json:"health_url"`
	TunnelAddrs  []string `json:"tunnel_addrs"`
	PeerURLs     []string `json:"peer_urls"`
	Bonded       *bool    `json:"bonded"`
	ExpiresAt    int64    `json:"expires_at"`
}

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	switch strings.ToLower(os.Args[1]) {
	case "keygen":
		cmdKeygen()
	case "sign":
		cmdSign()
	case "sign-from-keygen":
		cmdSignFromKeygen()
	case "extract-bundle":
		cmdExtractBundle()
	default:
		usage()
	}
}

func cmdKeygen() {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		fmt.Fprintf(os.Stderr, "keygen: %v\n", err)
		os.Exit(2)
	}
	out := map[string]string{
		"signing_key": base58.Encode(priv.Seed()),
		"pubkey":      base58.Encode(priv.Public().(ed25519.PublicKey)),
		"note":        "Keep signing_key offline. Publish pubkey only. Platform cannot rotate this key.",
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(out)
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func cmdSignFromKeygen() {
	var key struct {
		SigningKey string `json:"signing_key"`
	}
	if err := json.NewDecoder(os.Stdin).Decode(&key); err != nil {
		fmt.Fprintf(os.Stderr, "stdin json: %v\n", err)
		os.Exit(2)
	}
	bonded := true
	signAndEncode(signIn{
		SigningKey:   key.SigningKey,
		Slug:         envOr("W12B_SLUG", "edge-ext-w12b"),
		OrgID:        envOr("W12B_ORG_ID", "ext-operator-org-1"),
		HostID:       envOr("W12B_HOST_ID", "vps-ext-w12b"),
		BuyerBaseURL: envOr("W12B_BUYER_BASE_URL", "http://203.0.113.50:8090"),
		HealthURL:    envOr("W12B_HEALTH_URL", "http://203.0.113.50:8090/health"),
		TunnelAddrs:  []string{envOr("W12B_TUNNEL_ADDR", "203.0.113.50:3128")},
		PeerURLs:     []string{},
		Bonded:       &bonded,
	})
}

func cmdExtractBundle() {
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(os.Stdin).Decode(&raw); err != nil {
		fmt.Fprintf(os.Stderr, "stdin json: %v\n", err)
		os.Exit(2)
	}
	b, ok := raw["bundle"]
	if !ok || len(b) == 0 || string(b) == "null" {
		fmt.Fprintf(os.Stderr, "extract-bundle: missing bundle\n")
		os.Exit(2)
	}
	if _, ok := raw["signing_key"]; ok {
		fmt.Fprintf(os.Stderr, "extract-bundle: refusing JSON that still contains signing_key\n")
		os.Exit(2)
	}
	if _, err := os.Stdout.Write(b); err != nil {
		fmt.Fprintf(os.Stderr, "extract-bundle: %v\n", err)
		os.Exit(2)
	}
	if b[len(b)-1] != '\n' {
		fmt.Fprintln(os.Stdout)
	}
}

func cmdSign() {
	var in signIn
	if err := json.NewDecoder(os.Stdin).Decode(&in); err != nil {
		fmt.Fprintf(os.Stderr, "stdin json: %v\n", err)
		os.Exit(2)
	}
	signAndEncode(in)
}

func signAndEncode(in signIn) {
	_, pub, err := proofs.DecodeSigningKey(in.SigningKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "signing_key: %v\n", err)
		os.Exit(2)
	}
	bonded := true
	if in.Bonded != nil {
		bonded = *in.Bonded
	}
	expires := in.ExpiresAt
	if expires <= 0 {
		expires = time.Now().UTC().Add(30 * 24 * time.Hour).Unix()
	}
	exp := time.Unix(expires, 0).UTC()
	display := strings.TrimSpace(in.DisplayName)
	if display == "" {
		display = strings.TrimSpace(in.Slug)
	}
	op := &models.GatewayOperator{
		Slug:              strings.TrimSpace(in.Slug),
		DisplayName:       display,
		OrgID:             strings.TrimSpace(in.OrgID),
		HostID:            strings.TrimSpace(in.HostID),
		BuyerBaseURL:      strings.TrimSpace(in.BuyerBaseURL),
		HealthURL:         strings.TrimSpace(in.HealthURL),
		TunnelAddrs:       in.TunnelAddrs,
		PeerURLs:          in.PeerURLs,
		Pubkey:            base58.Encode(pub),
		Bonded:            bonded,
		Status:            gateways.StatusActive,
		ManifestExpiresAt: &exp,
	}
	if op.Slug == "" || op.OrgID == "" || op.HostID == "" || op.BuyerBaseURL == "" {
		fmt.Fprintf(os.Stderr, "sign: slug, org_id, host_id, buyer_base_url required\n")
		os.Exit(2)
	}
	if gateways.IsPlatformOrg(op.OrgID) {
		fmt.Fprintf(os.Stderr, "sign: org_id %q is the platform org; W7.D requires a distinct org_id\n", op.OrgID)
		os.Exit(2)
	}
	sig, err := gateways.SignManifest(op, in.SigningKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "sign: %v\n", err)
		os.Exit(2)
	}
	op.ManifestSignature = sig
	op.ManifestPayload = string(gateways.CanonicalManifestBytes(op))
	ok, reason := gateways.VerifyManifest(op)
	if !ok {
		fmt.Fprintf(os.Stderr, "verify after sign: %s\n", reason)
		os.Exit(2)
	}
	bundle := gateways.BuildBundle([]models.GatewayOperator{*op})
	out := map[string]any{
		"pubkey":             op.Pubkey,
		"org_id":             op.OrgID,
		"host_id":            op.HostID,
		"manifest_payload":   op.ManifestPayload,
		"manifest_signature": op.ManifestSignature,
		"bundle":             bundle,
		"note":               "Give ProxyHubb the bundle/pubkey only. Keep signing_key. Not DePIN.",
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(out); err != nil {
		fmt.Fprintf(os.Stderr, "encode: %v\n", err)
		os.Exit(2)
	}
}
