package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/catalog"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
)

func usage() {
	fmt.Fprintf(os.Stderr, `w9b-listing-bundle — verify/list/emit a Wave 9.B listing-commitment bundle (no control-api).

Usage:
  w9b-listing-bundle emit
  w9b-listing-bundle emit-onchain
  w9b-listing-bundle verify <file-or-url>
  w9b-listing-bundle list   <file-or-url>

emit writes a signed sample bundle (on_chain=false).
emit-onchain confirms the W9.A soak PDA on RPC, then signs on_chain=true.
Title/media are not in the bundle. Never programs/session.
Exit 0 only when at least one entry verifies and none fail (verify).
`)
	os.Exit(2)
}

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	cmd := strings.ToLower(os.Args[1])
	if cmd == "emit" {
		secret := catalog.SigningKey()
		b, err := catalog.EmitSampleBundle(secret)
		if err != nil {
			fmt.Fprintf(os.Stderr, "emit: %v\n", err)
			os.Exit(2)
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetEscapeHTML(false)
		_ = enc.Encode(b)
		return
	}
	if cmd == "emit-onchain" {
		if err := emitOnChain(); err != nil {
			fmt.Fprintf(os.Stderr, "emit-onchain: %v\n", err)
			os.Exit(2)
		}
		return
	}
	if len(os.Args) < 3 {
		usage()
	}
	src := os.Args[2]
	raw, err := readSource(src)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read: %v\n", err)
		os.Exit(2)
	}
	bundle, err := catalog.ParseBundle(raw)
	if err != nil {
		fmt.Fprintf(os.Stderr, "parse: %v\n", err)
		os.Exit(2)
	}
	entries := catalog.VerifyBundleEntries(bundle)
	switch cmd {
	case "list":
		for _, e := range entries {
			fmt.Printf("%s hash=%s pda=%s on_chain=%v verified=%v %s\n",
				e.Entry.ListingID, e.Entry.OfferHash, e.Entry.PDA, e.Entry.OnChain, e.Verified, e.Reason)
		}
		fmt.Printf("count=%d catalog_source=bundle\n", len(entries))
	case "verify":
		ok := 0
		bad := 0
		for _, e := range entries {
			if e.Verified {
				ok++
				fmt.Printf("ok %s\n", e.Entry.ListingID)
			} else {
				bad++
				fmt.Printf("fail %s %s\n", e.Entry.ListingID, e.Reason)
			}
		}
		fmt.Printf("verified=%d failed=%d catalog_source=bundle\n", ok, bad)
		if ok == 0 || bad > 0 {
			os.Exit(1)
		}
		fmt.Println("W9B_BUNDLE_VERIFY_OK")
	default:
		usage()
	}
}

func readSource(src string) ([]byte, error) {
	if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
		return httpGet(src)
	}
	return os.ReadFile(src)
}

func emitOnChain() error {
	programID := strings.TrimSpace(os.Getenv("SOLANA_PROGRAM_ID"))
	if programID == "" {
		programID = solana.DefaultProgramID
	}
	if programID == solana.UnsafeSessionProgramID {
		return fmt.Errorf("refused: programs/session")
	}
	rpcURL := strings.TrimSpace(os.Getenv("SOLANA_RPC_URL"))
	if rpcURL == "" {
		rpcURL = strings.TrimSpace(os.Getenv("SOLANA_RPC_ENDPOINT"))
	}
	if rpcURL == "" {
		rpcURL = solana.DefaultDevnetRPCEndpoint
	}
	listing := catalog.SoakListing()
	provider, err := sol.PublicKeyFromBase58(listing.ListingOfferSigner)
	if err != nil {
		return fmt.Errorf("provider: %w", err)
	}
	hash, err := solana.ParseOfferHashHex(listing.ListingOfferHash)
	if err != nil {
		return fmt.Errorf("offer hash: %w", err)
	}
	prog, err := sol.PublicKeyFromBase58(programID)
	if err != nil {
		return fmt.Errorf("program: %w", err)
	}
	pda, _, err := solana.ListingCommitmentPDA(prog, provider, hash)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	row, err := solana.FetchListingCommitment(ctx, rpcURL, programID, provider, hash)
	if err != nil {
		return fmt.Errorf("rpc confirm: %w", err)
	}
	if !row.IsActive {
		return fmt.Errorf("pda %s is inactive", pda)
	}
	if row.AccountPubkey != pda {
		return fmt.Errorf("pda mismatch")
	}
	listing.ListingCommitmentPDA = pda.String()
	listing.ListingCommitmentOnChain = true
	secret := catalog.SigningKey()
	if secret == "" {
		var genErr error
		secret, genErr = catalog.GenerateSigningSecret()
		if genErr != nil {
			return genErr
		}
	}
	b, err := catalog.BuildBundle([]models.ProxyListing{listing}, secret)
	if err != nil {
		return err
	}
	onChain := 0
	for _, e := range b.Entries {
		if e.OnChain && strings.TrimSpace(e.PDA) != "" {
			onChain++
		}
	}
	if onChain == 0 {
		return fmt.Errorf("bundle has no on_chain=true row")
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(b); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "W9B_ON_CHAIN_TRUE pda=%s n=%d\n", pda, onChain)
	return nil
}

func httpGet(url string) ([]byte, error) {
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("GET %s: %s %s", url, resp.Status, body)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 1<<20))
}
