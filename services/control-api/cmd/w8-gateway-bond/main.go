package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/proxyhubb/control-api/internal/solana"
)

const (
	soakTreasuryDefault = "8g7WUuPosAg82Uu7iGYCx6HBnoTBFb4QuyiJCEGzktU4"
	soakMinStake        = uint64(1_000_000)
	soakBondAmount      = uint64(1_000_000)
	soakMaxSlashBps     = uint16(5_000)
)

func usage() {
	fmt.Fprintf(os.Stderr, `w8-gateway-bond — inspect / observe-soak programs/gateway-bond.

Not programs/session. Live slash is not claimed. GCP execute stays off.
resolve_slash is not a CLI command (prefer resolve_release).

Usage:
  w8-gateway-bond id
  w8-gateway-bond pda <operator_base58>
  w8-gateway-bond gates
  w8-gateway-bond fetch [operator_base58]
  w8-gateway-bond soak
    (CONFIRM_W8_DEVNET_SOAK=1; initialize + allow + one tiny bond; never accuse/slash)
  w8-gateway-bond bond
    (CONFIRM_W12B_BOND=1 or CONFIRM_W8_DEVNET_SOAK=1; operator keypair bonds min stake)
  w8-gateway-bond accuse [operator_base58]
    (CONFIRM_W11C_ACCUSE=1; opens challenge; does not move stake)
  w8-gateway-bond wait-window [operator_base58]
    (polls until resolve_after; no tx)
  w8-gateway-bond resolve-release [operator_base58]
    (CONFIRM_W11C_RELEASE=1; closes challenge; does not slash)
  w8-gateway-bond soak-release [operator_base58]
    (CONFIRM_W11C_RELEASE_SOAK=1; accuse + wait >=3600s + resolve_release)

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
	rpcURL := soakRPC()
	switch strings.ToLower(os.Args[1]) {
	case "id":
		id, err := solana.GatewayBondProgramID()
		if err != nil {
			fatalf("id: %v", err)
		}
		_ = enc.Encode(map[string]any{
			"program_id":             id,
			"localnet_id":            id == solana.GatewayBondProgramIDLocalnet,
			"programs_session":       "unsafe_do_not_deploy",
			"live_economic_slash":    false,
			"bonded_gateway_program": "localnet_soak",
			"gateway_slash_execute":  solana.SlashExecuteMode(),
		})
	case "pda":
		if len(os.Args) < 3 {
			usage()
		}
		prog, err := solana.GatewayBondProgramKey()
		if err != nil {
			fatalf("program: %v", err)
		}
		op, err := sol.PublicKeyFromBase58(os.Args[2])
		if err != nil {
			fatalf("operator: %v", err)
		}
		cfg, _, err := solana.GetGatewayBondConfigPDA(prog)
		if err != nil {
			fatalf("config pda: %v", err)
		}
		bond, _, err := solana.GetOperatorBondPDA(prog, op)
		if err != nil {
			fatalf("bond pda: %v", err)
		}
		ch, _, err := solana.GetGatewayChallengePDA(prog, op)
		if err != nil {
			fatalf("challenge pda: %v", err)
		}
		_ = enc.Encode(map[string]any{
			"program_id":       prog.String(),
			"operator":         op.String(),
			"config_pda":       cfg.String(),
			"bond_pda":         bond.String(),
			"challenge_pda":    ch.String(),
			"programs_session": "unsafe_do_not_deploy",
		})
	case "gates":
		_ = enc.Encode(map[string]any{
			"gateway_slash_execute": solana.SlashExecuteMode(),
			"gates_armed":           solana.SlashGatesArmed(),
			"would_broadcast":       solana.SlashWouldBroadcast(),
			"live_economic_slash":   false,
			"programs_session":      "unsafe_do_not_deploy",
		})
	case "fetch":
		refuseMainnet(rpcURL)
		id, err := solana.GatewayBondProgramID()
		if err != nil {
			fatalf("id: %v", err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		cfg, err := solana.FetchGatewayBondConfig(ctx, rpcURL, id)
		out := map[string]any{
			"program_id":          id,
			"rpc":                 rpcURL,
			"live_economic_slash": false,
			"programs_session":    "unsafe_do_not_deploy",
			"accused":             false,
		}
		if err != nil {
			if solana.IsGatewayBondAccountMissing(err) {
				out["config"] = "missing"
				_ = enc.Encode(out)
				return
			}
			fatalf("fetch: %v", err)
		}
		out["config"] = map[string]any{
			"pda":                   cfg.AccountPubkey.String(),
			"admin":                 cfg.Admin.String(),
			"accuser":               cfg.Accuser.String(),
			"treasury":              cfg.Treasury.String(),
			"challenge_window_secs": cfg.ChallengeWindowSecs,
			"unbonding_secs":        cfg.UnbondingSecs,
			"min_stake_lamports":    cfg.MinStakeLamports,
			"max_slash_bps":         cfg.MaxSlashBps,
			"deploy_allowed":        cfg.DeployAllowed,
		}
		op, ok := optionalOperator(os.Args[2:])
		if !ok {
			if kp := strings.TrimSpace(os.Getenv("SOLANA_ORACLE_KEYPAIR")); kp != "" {
				client := mustOracle(rpcURL)
				op = client.GetOraclePublicKey()
				ok = true
			}
		}
		if ok {
			attachBondAndChallenge(ctx, out, rpcURL, id, op)
		}
		_ = enc.Encode(out)
	case "soak":
		runSoak(enc, rpcURL)
	case "bond":
		runBondOnly(enc, rpcURL)
	case "accuse":
		runAccuse(enc, rpcURL, os.Args[2:])
	case "wait-window":
		runWaitWindow(enc, rpcURL, os.Args[2:])
	case "resolve-release":
		runResolveRelease(enc, rpcURL, os.Args[2:])
	case "soak-release":
		runSoakRelease(enc, rpcURL, os.Args[2:])
	default:
		usage()
	}
}

func runSoak(enc *json.Encoder, rpcURL string) {
	if os.Getenv("CONFIRM_W8_DEVNET_SOAK") != "1" {
		fatalf("refused: set CONFIRM_W8_DEVNET_SOAK=1 (never accuse/slash; never session; never mainnet)")
	}
	if os.Getenv("CONFIRM_W8_DEPLOY") == "1" {
		fatalf("refused: CONFIRM_W8_DEPLOY=1 is not this soak. Use CONFIRM_W8_DEVNET_SOAK=1")
	}
	refuseMainnet(rpcURL)
	if solana.SlashGatesArmed() || solana.SlashWouldBroadcast() {
		fatalf("refused: PROXYHUB_GATEWAY_SLASH_* must stay unset during observe soak")
	}
	id, err := solana.GatewayBondProgramID()
	if err != nil {
		fatalf("id: %v", err)
	}
	if id == solana.UnsafeSessionProgramID {
		fatalf("refused: programs/session")
	}
	client := mustOracle(rpcURL)
	operator := client.GetOraclePublicKey()
	treasuryStr := strings.TrimSpace(os.Getenv("PROXYHUB_TREASURY_PUBKEY"))
	if treasuryStr == "" {
		treasuryStr = soakTreasuryDefault
	}
	treasury, err := sol.PublicKeyFromBase58(treasuryStr)
	if err != nil {
		fatalf("treasury: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	steps := map[string]any{}
	cfg, err := solana.FetchGatewayBondConfig(ctx, rpcURL, id)
	switch {
	case solana.IsGatewayBondAccountMissing(err):
		sig, e := client.InitializeGatewayBondConfig(
			ctx,
			operator,
			treasury,
			solana.GatewayBondMinChallengeWindowSecs,
			solana.GatewayBondMinChallengeWindowSecs,
			soakMinStake,
			soakMaxSlashBps,
		)
		if e != nil {
			fatalf("initialize_config: %v", e)
		}
		steps["initialize_config"] = sig
		cfg, err = waitGatewayBondConfig(ctx, rpcURL, id)
		if err != nil {
			fatalf("fetch after init: %v", err)
		}
		if cfg.DeployAllowed {
			fatalf("deploy_allowed started true; expected false after initialize_config")
		}
		steps["deploy_allowed_after_init"] = false
	case err != nil:
		fatalf("fetch config: %v", err)
	default:
		steps["initialize_config"] = "already_present"
	}

	if !cfg.DeployAllowed {
		sig, e := client.SetGatewayBondDeployAllowed(ctx, true)
		if e != nil {
			fatalf("set_deploy_allowed: %v", e)
		}
		steps["set_deploy_allowed"] = sig
		cfg, err = waitGatewayBondDeployAllowed(ctx, rpcURL, id, true)
		if err != nil {
			fatalf("fetch after set_deploy_allowed: %v", err)
		}
	} else {
		steps["set_deploy_allowed"] = "already_true"
	}

	bond, err := solana.FetchOperatorBond(ctx, rpcURL, id, operator)
	needBond := solana.IsGatewayBondAccountMissing(err) || (err == nil && (!bond.Bonded || bond.StakeLamports < soakMinStake))
	if err != nil && !solana.IsGatewayBondAccountMissing(err) {
		fatalf("fetch bond: %v", err)
	}
	if needBond {
		sig, e := client.BondGatewayStake(ctx, soakBondAmount)
		if e != nil {
			fatalf("bond: %v", e)
		}
		steps["bond"] = sig
		bond, err = waitOperatorBond(ctx, rpcURL, id, operator)
		if err != nil {
			fatalf("fetch after bond: %v", err)
		}
	} else {
		steps["bond"] = "already_bonded"
	}

	cfg, err = waitGatewayBondConfig(ctx, rpcURL, id)
	if err != nil {
		fatalf("final config: %v", err)
	}
	bond, err = waitOperatorBond(ctx, rpcURL, id, operator)
	if err != nil {
		fatalf("final bond: %v", err)
	}

	_ = enc.Encode(map[string]any{
		"program_id":             id,
		"rpc":                    rpcURL,
		"operator":               operator.String(),
		"steps":                  steps,
		"deploy_allowed":         cfg.DeployAllowed,
		"min_stake_lamports":     cfg.MinStakeLamports,
		"bond_pda":               bond.AccountPubkey.String(),
		"stake_lamports":         bond.StakeLamports,
		"bonded":                 bond.Bonded,
		"open_challenge":         bond.OpenChallenge,
		"accused":                false,
		"slashed":                false,
		"live_economic_slash":    false,
		"gateway_slash_execute":  solana.SlashExecuteMode(),
		"programs_session":       "unsafe_do_not_deploy",
		"bonded_gateway_program": "devnet_observe",
	})
	fmt.Fprintln(os.Stderr, "W8_DEVNET_SOAK_OK")
}

func runBondOnly(enc *json.Encoder, rpcURL string) {
	if os.Getenv("CONFIRM_W12B_BOND") != "1" && os.Getenv("CONFIRM_W8_DEVNET_SOAK") != "1" {
		fatalf("refused: set CONFIRM_W12B_BOND=1 (or CONFIRM_W8_DEVNET_SOAK=1)")
	}
	if os.Getenv("CONFIRM_W8_DEPLOY") == "1" {
		fatalf("refused: CONFIRM_W8_DEPLOY=1 is not a bond tool")
	}
	refuseMainnet(rpcURL)
	if solana.SlashGatesArmed() || solana.SlashWouldBroadcast() {
		fatalf("refused: PROXYHUB_GATEWAY_SLASH_* must stay unset")
	}
	id, err := solana.GatewayBondProgramID()
	if err != nil {
		fatalf("id: %v", err)
	}
	if id == solana.UnsafeSessionProgramID {
		fatalf("refused: programs/session")
	}
	client := mustOracle(rpcURL)
	op := client.GetOraclePublicKey()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cfg, err := solana.FetchGatewayBondConfig(ctx, rpcURL, id)
	if err != nil {
		fatalf("config: %v (initialize first with CONFIRM_W8_DEVNET_SOAK=1)", err)
	}
	if !cfg.DeployAllowed {
		fatalf("deploy_allowed=false")
	}
	sig, err := client.BondGatewayStake(ctx, soakBondAmount)
	if err != nil {
		fatalf("bond: %v", err)
	}
	bond, err := waitOperatorBond(ctx, rpcURL, id, op)
	if err != nil {
		fatalf("fetch bond: %v", err)
	}
	_ = enc.Encode(map[string]any{
		"program_id":          id,
		"operator":            op.String(),
		"bond":                sig,
		"bond_pda":            bond.AccountPubkey.String(),
		"stake_lamports":      bond.StakeLamports,
		"bonded":              bond.Bonded,
		"live_economic_slash": false,
		"programs_session":    "unsafe_do_not_deploy",
	})
	fmt.Fprintln(os.Stderr, "W12B_BOND_OK")
}

func waitGatewayBondDeployAllowed(ctx context.Context, rpcURL, id string, want bool) (*solana.GatewayBondConfig, error) {
	var last error
	for i := 0; i < 40; i++ {
		cfg, err := solana.FetchGatewayBondConfig(ctx, rpcURL, id)
		if err == nil && cfg.DeployAllowed == want {
			return cfg, nil
		}
		if err != nil {
			last = err
		} else {
			last = fmt.Errorf("deploy_allowed=%v want %v", cfg.DeployAllowed, want)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(1500 * time.Millisecond):
		}
	}
	return nil, last
}

func waitGatewayBondConfig(ctx context.Context, rpcURL, id string) (*solana.GatewayBondConfig, error) {
	var last error
	for i := 0; i < 40; i++ {
		cfg, err := solana.FetchGatewayBondConfig(ctx, rpcURL, id)
		if err == nil {
			return cfg, nil
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

func waitOperatorBond(ctx context.Context, rpcURL, id string, operator sol.PublicKey) (*solana.GatewayBondAccount, error) {
	var last error
	for i := 0; i < 40; i++ {
		row, err := solana.FetchOperatorBond(ctx, rpcURL, id, operator)
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

func refuseW11CLive(rpcURL string) {
	if os.Getenv("CONFIRM_W8_DEPLOY") == "1" {
		fatalf("refused: CONFIRM_W8_DEPLOY=1 is not this soak")
	}
	refuseMainnet(rpcURL)
	if solana.SlashGatesArmed() || solana.SlashWouldBroadcast() {
		fatalf("refused: PROXYHUB_GATEWAY_SLASH_* must stay unset (prefer resolve_release; do not arm slash)")
	}
	id, err := solana.GatewayBondProgramID()
	if err != nil {
		fatalf("id: %v", err)
	}
	if id == solana.UnsafeSessionProgramID {
		fatalf("refused: programs/session")
	}
}

func optionalOperator(args []string) (sol.PublicKey, bool) {
	if len(args) == 0 || strings.TrimSpace(args[0]) == "" {
		return sol.PublicKey{}, false
	}
	op, err := sol.PublicKeyFromBase58(strings.TrimSpace(args[0]))
	if err != nil {
		fatalf("operator: %v", err)
	}
	return op, true
}

func requireOperator(rpcURL string, args []string) (sol.PublicKey, *solana.OracleClient) {
	client := mustOracle(rpcURL)
	if op, ok := optionalOperator(args); ok {
		return op, client
	}
	return client.GetOraclePublicKey(), client
}

func soakEvidenceHash(operator sol.PublicKey) [32]byte {
	msg := "PROXYHUB_W11C_RELEASE_SOAK:v1:" + operator.String()
	return sha256.Sum256([]byte(msg))
}

func attachBondAndChallenge(ctx context.Context, out map[string]any, rpcURL, id string, op sol.PublicKey) {
	out["operator"] = op.String()
	bond, err := solana.FetchOperatorBond(ctx, rpcURL, id, op)
	if err != nil {
		if solana.IsGatewayBondAccountMissing(err) {
			out["bond"] = "missing"
		} else {
			fatalf("bond: %v", err)
		}
	} else {
		out["bond"] = map[string]any{
			"pda":              bond.AccountPubkey.String(),
			"stake_lamports":   bond.StakeLamports,
			"bonded":           bond.Bonded,
			"open_challenge":   bond.OpenChallenge,
			"slash_count":      bond.SlashCount,
			"slashed_lamports": bond.SlashedLamports,
		}
		out["accused"] = bond.OpenChallenge
		out["slashed"] = bond.SlashCount > 0 || bond.SlashedLamports > 0
	}
	ch, err := solana.FetchGatewayChallenge(ctx, rpcURL, id, op)
	if err != nil {
		if solana.IsGatewayBondAccountMissing(err) {
			out["challenge"] = "missing"
			return
		}
		fatalf("challenge: %v", err)
	}
	now := time.Now().UTC().Unix()
	remaining := solana.ChallengeWindowRemaining(now, ch.ResolveAfter)
	autoAt, autoOK := solana.AutoReleaseAt(ch.OpenedAt, 3600)
	if cfg, ok := out["config"].(map[string]any); ok {
		if w, ok := cfg["challenge_window_secs"].(int64); ok {
			autoAt, autoOK = solana.AutoReleaseAt(ch.OpenedAt, w)
		}
	}
	out["challenge"] = map[string]any{
		"pda":                   ch.AccountPubkey.String(),
		"accuser":               ch.Accuser.String(),
		"evidence_hash":         hex.EncodeToString(ch.EvidenceHash[:]),
		"slash_bps":             ch.SlashBps,
		"opened_at":             ch.OpenedAt,
		"resolve_after":         ch.ResolveAfter,
		"window_remaining_secs": remaining,
		"window_elapsed":        remaining == 0,
		"auto_release_at":       autoAt,
		"auto_release_ok":       autoOK,
		"status":                ch.Status,
	}
	out["accused"] = true
}

func runAccuse(enc *json.Encoder, rpcURL string, args []string) {
	if os.Getenv("CONFIRM_W11C_ACCUSE") != "1" && os.Getenv("CONFIRM_W11C_RELEASE_SOAK") != "1" {
		fatalf("refused: set CONFIRM_W11C_ACCUSE=1 (or CONFIRM_W11C_RELEASE_SOAK=1)")
	}
	refuseW11CLive(rpcURL)
	op, client := requireOperator(rpcURL, args)
	id, _ := solana.GatewayBondProgramID()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	bond, err := solana.FetchOperatorBond(ctx, rpcURL, id, op)
	if err != nil {
		fatalf("bond: %v", err)
	}
	if bond.OpenChallenge {
		fatalf("challenge already open on %s", bond.AccountPubkey)
	}
	ev := soakEvidenceHash(op)
	bps := uint16(1)
	sig, err := client.AccuseGateway(ctx, op, ev, bps)
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
		"evidence_hash":       hex.EncodeToString(ev[:]),
		"slash_bps":           bps,
		"challenge_pda":       ch.AccountPubkey.String(),
		"resolve_after":       ch.ResolveAfter,
		"accused":             true,
		"slashed":             false,
		"live_economic_slash": false,
		"programs_session":    "unsafe_do_not_deploy",
		"resolve_path":        "release",
	})
	fmt.Fprintln(os.Stderr, "W11C_ACCUSE_OK")
}

func runWaitWindow(enc *json.Encoder, rpcURL string, args []string) {
	refuseMainnet(rpcURL)
	id, err := solana.GatewayBondProgramID()
	if err != nil {
		fatalf("id: %v", err)
	}
	op, ok := optionalOperator(args)
	if !ok {
		client := mustOracle(rpcURL)
		op = client.GetOraclePublicKey()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	ch, err := solana.FetchGatewayChallenge(ctx, rpcURL, id, op)
	if err != nil {
		fatalf("challenge: %v", err)
	}
	poll := 15 * time.Second
	for {
		now := time.Now().UTC().Unix()
		left := solana.ChallengeWindowRemaining(now, ch.ResolveAfter)
		if left == 0 {
			_ = enc.Encode(map[string]any{
				"operator":            op.String(),
				"challenge_pda":       ch.AccountPubkey.String(),
				"resolve_after":       ch.ResolveAfter,
				"window_elapsed":      true,
				"live_economic_slash": false,
			})
			fmt.Fprintln(os.Stderr, "W11C_WINDOW_ELAPSED")
			return
		}
		fmt.Fprintf(os.Stderr, "wait-window remaining_secs=%d resolve_after=%d\n", left, ch.ResolveAfter)
		select {
		case <-ctx.Done():
			fatalf("wait-window: %v", ctx.Err())
		case <-time.After(poll):
		}
		next, err := solana.FetchGatewayChallenge(ctx, rpcURL, id, op)
		if err != nil {
			fmt.Fprintf(os.Stderr, "wait-window refresh retry: %v\n", err)
			continue
		}
		ch = next
	}
}

func runResolveRelease(enc *json.Encoder, rpcURL string, args []string) {
	if os.Getenv("CONFIRM_W11C_RELEASE") != "1" && os.Getenv("CONFIRM_W11C_RELEASE_SOAK") != "1" {
		fatalf("refused: set CONFIRM_W11C_RELEASE=1 (or CONFIRM_W11C_RELEASE_SOAK=1)")
	}
	refuseW11CLive(rpcURL)
	op, client := requireOperator(rpcURL, args)
	id, _ := solana.GatewayBondProgramID()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	ch, err := solana.FetchGatewayChallenge(ctx, rpcURL, id, op)
	if err != nil {
		fatalf("challenge: %v", err)
	}
	now := time.Now().UTC().Unix()
	if left := solana.ChallengeWindowRemaining(now, ch.ResolveAfter); left > 0 {
		fatalf("refused: challenge window still open (%ds remaining). Run wait-window first (W11.C soak is after 3600s)", left)
	}
	sig, err := client.ResolveGatewayRelease(ctx, op, ch.Accuser)
	if err != nil {
		fatalf("resolve_release: %v", err)
	}
	bond, err := waitOperatorBond(ctx, rpcURL, id, op)
	if err != nil {
		fatalf("bond after release: %v", err)
	}
	_ = enc.Encode(map[string]any{
		"program_id":          id,
		"operator":            op.String(),
		"resolve_release":     sig,
		"open_challenge":      bond.OpenChallenge,
		"stake_lamports":      bond.StakeLamports,
		"accused":             bond.OpenChallenge,
		"slashed":             false,
		"live_economic_slash": false,
		"programs_session":    "unsafe_do_not_deploy",
	})
	fmt.Fprintln(os.Stderr, "W11C_RELEASE_OK")
}

func runSoakRelease(enc *json.Encoder, rpcURL string, args []string) {
	if os.Getenv("CONFIRM_W11C_RELEASE_SOAK") != "1" {
		fatalf("refused: set CONFIRM_W11C_RELEASE_SOAK=1 (accuse + wait 3600s + resolve_release; never slash)")
	}
	refuseW11CLive(rpcURL)
	op, client := requireOperator(rpcURL, args)
	id, _ := solana.GatewayBondProgramID()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	steps := map[string]any{}
	bond, err := solana.FetchOperatorBond(ctx, rpcURL, id, op)
	if err != nil {
		fatalf("bond: %v", err)
	}
	if !bond.OpenChallenge {
		ev := soakEvidenceHash(op)
		sig, e := client.AccuseGateway(ctx, op, ev, 1)
		if e != nil {
			fatalf("accuse: %v", e)
		}
		steps["accuse"] = sig
		_, err = waitChallenge(ctx, rpcURL, id, op)
		if err != nil {
			fatalf("challenge after accuse: %v", err)
		}
	} else {
		steps["accuse"] = "already_open"
	}
	ch, err := solana.FetchGatewayChallenge(ctx, rpcURL, id, op)
	if err != nil {
		fatalf("challenge: %v", err)
	}
	for {
		now := time.Now().UTC().Unix()
		left := solana.ChallengeWindowRemaining(now, ch.ResolveAfter)
		if left == 0 {
			break
		}
		fmt.Fprintf(os.Stderr, "soak-release remaining_secs=%d\n", left)
		select {
		case <-ctx.Done():
			fatalf("wait: %v", ctx.Err())
		case <-time.After(15 * time.Second):
		}
		next, err := solana.FetchGatewayChallenge(ctx, rpcURL, id, op)
		if err != nil {
			fmt.Fprintf(os.Stderr, "soak-release refresh retry: %v\n", err)
			continue
		}
		ch = next
	}
	steps["window_elapsed"] = true
	sig, err := client.ResolveGatewayRelease(ctx, op, ch.Accuser)
	if err != nil {
		fatalf("resolve_release: %v", err)
	}
	steps["resolve_release"] = sig
	bond, err = waitOperatorBond(ctx, rpcURL, id, op)
	if err != nil {
		fatalf("bond after release: %v", err)
	}
	_ = enc.Encode(map[string]any{
		"program_id":             id,
		"operator":               op.String(),
		"steps":                  steps,
		"open_challenge":         bond.OpenChallenge,
		"stake_lamports":         bond.StakeLamports,
		"accused":                false,
		"slashed":                false,
		"live_economic_slash":    false,
		"gateway_slash_execute":  solana.SlashExecuteMode(),
		"programs_session":       "unsafe_do_not_deploy",
		"bonded_gateway_program": "devnet_observe",
	})
	fmt.Fprintln(os.Stderr, "W11C_RELEASE_SOAK_OK")
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
