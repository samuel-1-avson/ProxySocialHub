package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/settlement"
	"github.com/proxyhubb/control-api/internal/solana"
)

func usage() {
	fmt.Fprintf(os.Stderr, `w12a-usage-challenge — ADR 0015 slice 1 (no new program).

Buyer files an off-chain petition (signed settlement receipt + disputed
leaves_hash). Protocol accuser (gateway-bond config.accuser) may open
accuse with that evidence_hash. Prefer resolve_release. resolve_slash is
not a command. Not permissionless buyer-to-chain. Not trustless metering.
Not DePIN. Never programs/session. Never mainnet.

Usage:
  w12a-usage-challenge demo
  w12a-usage-challenge petition <receipt.json> <leaves_hash_hex>
  w12a-usage-challenge verify   <petition.json>
  w12a-usage-challenge hash     <petition.json>
  w12a-usage-challenge accuse   <petition.json> [operator_base58]
    (CONFIRM_W12A_ACCUSE=1 or CONFIRM_W12A_RELEASE_SOAK=1; slash_bps=1;
     PROXYHUB_GATEWAY_SLASH_* must stay unset)

After accuse, wait and release with w8-gateway-bond:
  wait-window / resolve-release (CONFIRM_W11C_RELEASE=1 or soak confirm).

Exit 0 prints JSON. live_economic_slash remains false.
`)
	os.Exit(2)
}

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	switch strings.ToLower(os.Args[1]) {
	case "demo":
		runDemo(enc)
	case "petition":
		if len(os.Args) < 4 {
			usage()
		}
		runPetition(enc, os.Args[2], os.Args[3])
	case "verify":
		if len(os.Args) < 3 {
			usage()
		}
		p := mustReadPetition(os.Args[2])
		if err := settlement.VerifyPetition(p); err != nil {
			fatalf("verify: %v", err)
		}
		_ = enc.Encode(map[string]any{
			"verified":            true,
			"window_key":          p.WindowKey,
			"leaves_hash":         p.LeavesHash,
			"evidence_hash":       p.EvidenceHash,
			"resolve_path":        p.ResolvePath,
			"would_broadcast":     settlement.WouldBroadcast(),
			"live_economic_slash": false,
			"programs_session":    "unsafe_do_not_deploy",
			"slice":               1,
		})
		fmt.Fprintln(os.Stderr, "W12A_PETITION_VERIFY_OK")
	case "hash":
		if len(os.Args) < 3 {
			usage()
		}
		p := mustReadPetition(os.Args[2])
		sum, err := settlement.EvidenceHashBytes(p)
		if err != nil {
			fatalf("hash: %v", err)
		}
		_ = enc.Encode(map[string]any{
			"evidence_hash":       hex.EncodeToString(sum[:]),
			"window_key":          p.WindowKey,
			"live_economic_slash": false,
		})
	case "accuse":
		if len(os.Args) < 3 {
			usage()
		}
		runAccuse(enc, os.Args[2], os.Args[3:])
	default:
		usage()
	}
}

func runDemo(enc *json.Encoder) {
	r, err := settlement.EmitSampleReceipt(settlement.SigningKey(), "")
	if err != nil {
		fatalf("emit receipt: %v", err)
	}
	leaves := strings.Repeat("ab", 32)
	p, err := settlement.BuildPetition(r, leaves)
	if err != nil {
		fatalf("petition: %v", err)
	}
	if err := settlement.VerifyPetition(p); err != nil {
		fatalf("verify: %v", err)
	}
	_ = enc.Encode(p)
	fmt.Fprintln(os.Stderr, "W12A_USAGE_CHALLENGE_CLIENT_OK")
	fmt.Fprintln(os.Stderr, "not on-chain; not slash; not DePIN; programs/session undeployed")
}

func runPetition(enc *json.Encoder, receiptPath, leavesHex string) {
	raw, err := os.ReadFile(receiptPath)
	if err != nil {
		fatalf("read receipt: %v", err)
	}
	r, err := settlement.ParseReceipt(raw)
	if err != nil {
		fatalf("parse receipt: %v", err)
	}
	p, err := settlement.BuildPetition(*r, leavesHex)
	if err != nil {
		fatalf("petition: %v", err)
	}
	_ = enc.Encode(p)
	fmt.Fprintln(os.Stderr, "W12A_PETITION_OK")
}

func runAccuse(enc *json.Encoder, petitionPath string, args []string) {
	if os.Getenv("CONFIRM_W12A_ACCUSE") != "1" && os.Getenv("CONFIRM_W12A_RELEASE_SOAK") != "1" {
		fatalf("refused: set CONFIRM_W12A_ACCUSE=1 (or CONFIRM_W12A_RELEASE_SOAK=1)")
	}
	if os.Getenv("CONFIRM_W8_DEPLOY") == "1" {
		fatalf("refused: CONFIRM_W8_DEPLOY=1 is not this soak")
	}
	rpcURL := soakRPC()
	refuseMainnet(rpcURL)
	if solana.SlashGatesArmed() || solana.SlashWouldBroadcast() {
		fatalf("refused: PROXYHUB_GATEWAY_SLASH_* must stay unset (prefer resolve_release)")
	}
	p := mustReadPetition(petitionPath)
	sum, err := settlement.EvidenceHashBytes(p)
	if err != nil {
		fatalf("petition: %v", err)
	}
	id, err := solana.GatewayBondProgramID()
	if err != nil {
		fatalf("id: %v", err)
	}
	if id == solana.UnsafeSessionProgramID {
		fatalf("refused: programs/session")
	}
	op, client := requireOperator(rpcURL, args)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	bond, err := solana.FetchOperatorBond(ctx, rpcURL, id, op)
	if err != nil {
		fatalf("bond: %v", err)
	}
	if bond.OpenChallenge {
		fatalf("challenge already open on %s (wait-window / resolve-release first)", bond.AccountPubkey)
	}
	sig, err := client.AccuseGateway(ctx, op, sum, 1)
	if err != nil {
		fatalf("accuse: %v", err)
	}
	ch, err := waitChallenge(ctx, rpcURL, id, op)
	if err != nil {
		fatalf("fetch challenge: %v", err)
	}
	_ = enc.Encode(map[string]any{
		"program_id":          id,
		"operator":            op.String(),
		"accuse":              sig,
		"evidence_hash":       hex.EncodeToString(sum[:]),
		"window_key":          p.WindowKey,
		"leaves_hash":         p.LeavesHash,
		"slash_bps":           1,
		"challenge_pda":       ch.AccountPubkey.String(),
		"resolve_after":       ch.ResolveAfter,
		"resolve_path":        "release",
		"accused":             true,
		"slashed":             false,
		"live_economic_slash": false,
		"programs_session":    "unsafe_do_not_deploy",
		"slice":               1,
	})
	fmt.Fprintln(os.Stderr, "W12A_ACCUSE_OK")
	fmt.Fprintln(os.Stderr, "next: go run ./cmd/w8-gateway-bond wait-window; then resolve-release")
}

func mustReadPetition(path string) settlement.UsagePetition {
	raw, err := os.ReadFile(path)
	if err != nil {
		fatalf("read: %v", err)
	}
	p, err := settlement.ParsePetition(raw)
	if err != nil {
		fatalf("parse: %v", err)
	}
	return *p
}

func soakRPC() string {
	rpcURL := strings.TrimSpace(os.Getenv("SOLANA_RPC_URL"))
	if rpcURL == "" {
		rpcURL = strings.TrimSpace(os.Getenv("SOLANA_RPC_ENDPOINT"))
	}
	if rpcURL == "" {
		rpcURL = solana.DefaultDevnetRPCEndpoint
	}
	return rpcURL
}

func refuseMainnet(rpcURL string) {
	u := strings.ToLower(rpcURL)
	if strings.Contains(u, "mainnet") {
		fatalf("refused: never mainnet (%s)", rpcURL)
	}
	cluster := strings.ToLower(strings.TrimSpace(os.Getenv("SOLANA_CLUSTER")))
	if cluster == "mainnet" || cluster == "mainnet-beta" {
		fatalf("refused: SOLANA_CLUSTER=%s", cluster)
	}
}

func requireOperator(rpcURL string, args []string) (sol.PublicKey, *solana.OracleClient) {
	client := mustOracle(rpcURL)
	if len(args) > 0 && strings.TrimSpace(args[0]) != "" {
		op, err := sol.PublicKeyFromBase58(strings.TrimSpace(args[0]))
		if err != nil {
			fatalf("operator: %v", err)
		}
		return op, client
	}
	return client.GetOraclePublicKey(), client
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

func waitChallenge(ctx context.Context, rpcURL, id string, operator sol.PublicKey) (*solana.GatewayBondChallenge, error) {
	var last error
	for i := 0; i < 40; i++ {
		row, err := solana.FetchGatewayChallenge(ctx, rpcURL, id, operator)
		if err == nil {
			return row, nil
		}
		last = err
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(1500 * time.Millisecond):
		}
	}
	return nil, last
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
