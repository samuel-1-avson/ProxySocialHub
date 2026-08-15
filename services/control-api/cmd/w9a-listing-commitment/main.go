package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/solana"
)

func usage() {
	fmt.Fprintf(os.Stderr, `w9a-listing-commitment — Wave 9.A ListingCommitment PDA (not a catalog).

Does not deploy programs/session. GCP observe soak is gated.

Usage:
  w9a-listing-commitment honesty
  w9a-listing-commitment pda <provider_base58> <offer_hash_hex>
  w9a-listing-commitment probe
  w9a-listing-commitment fetch <provider_base58> <offer_hash_hex>
  w9a-listing-commitment register <provider_base58> <offer_hash_hex> <listing_uuid>
    (requires CONFIRM_W9A_LIVE=1 and SOLANA_ORACLE_KEYPAIR)

Exit 0 prints JSON. Live economic slash / session program are not claimed.
`)
	os.Exit(2)
}

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	programID := strings.TrimSpace(os.Getenv("SOLANA_PROGRAM_ID"))
	if programID == "" {
		programID = solana.DefaultProgramID
	}
	rpcURL := strings.TrimSpace(os.Getenv("SOLANA_RPC_URL"))
	if rpcURL == "" {
		rpcURL = strings.TrimSpace(os.Getenv("SOLANA_RPC_ENDPOINT"))
	}
	if rpcURL == "" {
		rpcURL = solana.DefaultDevnetRPCEndpoint
	}

	switch strings.ToLower(os.Args[1]) {
	case "honesty":
		mode := decentralization.ListingCommitmentMode()
		commitments := "ed25519_offer_hash"
		if mode != "off" {
			commitments = "ed25519_offer_hash+listing_commitment_pda"
		}
		_ = enc.Encode(map[string]any{
			"program_id":                programID,
			"listing_commitment_mode":   mode,
			"listing_commitments":       commitments,
			"catalog_source":            "postgres",
			"delist_authority":          "platform_moderation",
			"gcp_default":               "off",
			"not_a_catalog":             true,
			"programs_session":          "unsafe_do_not_deploy",
			"live_listing_commitment":   mode != "off",
		})
	case "pda":
		if len(os.Args) < 4 {
			usage()
		}
		provider, err := sol.PublicKeyFromBase58(os.Args[2])
		if err != nil {
			fatalf("provider: %v", err)
		}
		hash, err := solana.ParseOfferHashHex(os.Args[3])
		if err != nil {
			fatalf("offer hash: %v", err)
		}
		prog, err := sol.PublicKeyFromBase58(programID)
		if err != nil {
			fatalf("program: %v", err)
		}
		if programID == solana.UnsafeSessionProgramID {
			fatalf("refused: programs/session")
		}
		pda, bump, err := solana.ListingCommitmentPDA(prog, provider, hash)
		if err != nil {
			fatalf("pda: %v", err)
		}
		_ = enc.Encode(map[string]any{
			"program_id":       programID,
			"provider":         provider.String(),
			"offer_hash":       os.Args[3],
			"pda":              pda.String(),
			"bump":             bump,
			"programs_session": "unsafe_do_not_deploy",
			"not_a_catalog":    true,
		})
	case "probe":
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		probe, err := solana.ProbeListingCommitmentOnChain(ctx, rpcURL, programID)
		if err != nil && probe.IxStatus == "" {
			fatalf("probe: %v", err)
		}
		_ = enc.Encode(probe)
		if probe.IxStatus == "ix_present" {
			fmt.Fprintln(os.Stderr, "W9A_IX_PRESENT")
		}
	case "fetch":
		if len(os.Args) < 4 {
			usage()
		}
		client := mustOracle(rpcURL)
		provider, err := sol.PublicKeyFromBase58(os.Args[2])
		if err != nil {
			fatalf("provider: %v", err)
		}
		hash, err := solana.ParseOfferHashHex(os.Args[3])
		if err != nil {
			fatalf("offer hash: %v", err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		row, err := client.ReadListingCommitment(ctx, provider, hash)
		if err != nil {
			fatalf("fetch: %v", err)
		}
		_ = enc.Encode(map[string]any{
			"pda":            row.AccountPubkey.String(),
			"provider":       row.Provider.String(),
			"listing_id":     row.ListingID.String(),
			"is_active":      row.IsActive,
			"registered_at":  row.RegisteredAt,
			"not_a_catalog":  true,
			"programs_session": "unsafe_do_not_deploy",
		})
	case "register":
		if os.Getenv("CONFIRM_W9A_LIVE") != "1" {
			fatalf("refused: set CONFIRM_W9A_LIVE=1 to send register_listing_commitment (never session)")
		}
		if len(os.Args) < 5 {
			usage()
		}
		if programID == solana.UnsafeSessionProgramID {
			fatalf("refused: programs/session")
		}
		client := mustOracle(rpcURL)
		provider, err := sol.PublicKeyFromBase58(os.Args[2])
		if err != nil {
			fatalf("provider: %v", err)
		}
		hash, err := solana.ParseOfferHashHex(os.Args[3])
		if err != nil {
			fatalf("offer hash: %v", err)
		}
		listingID, err := uuid.Parse(os.Args[4])
		if err != nil {
			fatalf("listing uuid: %v", err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		sig, err := client.RegisterListingCommitmentOnChain(ctx, solana.RegisterListingCommitmentParams{
			Provider:  provider,
			OfferHash: hash,
			ListingID: listingID,
		})
		if err != nil {
			fatalf("register: %v", err)
		}
		pda, _, _ := client.GetListingCommitmentPDA(provider, hash)
		_ = enc.Encode(map[string]any{
			"tx":               sig,
			"pda":              pda.String(),
			"programs_session": "unsafe_do_not_deploy",
			"not_a_catalog":    true,
		})
		fmt.Fprintln(os.Stderr, "W9A_LISTING_COMMITMENT_LIVE_OK")
	default:
		usage()
	}
}

func mustOracle(rpcURL string) *solana.OracleClient {
	kp := strings.TrimSpace(os.Getenv("SOLANA_ORACLE_KEYPAIR"))
	if kp == "" {
		fatalf("SOLANA_ORACLE_KEYPAIR is required")
	}
	client, err := solana.NewOracleClient(solana.Config{
		RPCEndpoints:      []string{rpcURL},
		OracleKeypairPath: kp,
		Network:           "devnet",
	})
	if err != nil {
		fatalf("oracle: %v", err)
	}
	return client
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
