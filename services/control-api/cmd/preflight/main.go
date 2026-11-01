// Command preflight runs live, fail-closed cutover checks for the ProxyHubb
// Control API Solana custody path.
//
// Every check performs real I/O (RPC, WebSocket, KMS, price vendors) against
// the effective runtime configuration built by InitOracleFromEnv. Nothing here
// asserts a constant against itself: a PASS means the live dependency answered
// correctly at gate time.
//
// Exit status is 0 when every check passes (WARN/SKIP allowed) and 1 when any
// check FAILs.
//
// Usage:
//
//	APP_ENV=testnet go run ./cmd/preflight [-json] [-web-env path/to/web.env]
//
// The -web-env flag points at a KEY=VAL file carrying the web service env
// (NEXT_PUBLIC_SOLANA_NETWORK, NEXT_PUBLIC_SHOW_TESTNET_BANNER) so the banner
// consistency check can run outside the web container. Without it the banner
// check is skipped on non-production and fails on production.
package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
	"github.com/gagliardetto/solana-go/rpc/ws"

	"github.com/proxyhubb/control-api/internal/prices"
	"github.com/proxyhubb/control-api/internal/solana"
)

type status string

const (
	statusPass status = "PASS"
	statusFail status = "FAIL"
	statusWarn status = "WARN"
	statusSkip status = "SKIP"
)

// Result is one gate check outcome.
type Result struct {
	Name   string `json:"name"`
	Status status `json:"status"`
	Detail string `json:"detail"`
}

const (
	// solMint is the wrapped-SOL mint id used by price vendors.
	solMint = "So11111111111111111111111111111111111111112"
	// maxPriceAge bounds CoinGecko quote freshness.
	maxPriceAge = 15 * time.Minute
	// maxPriceDivergence bounds the CoinGecko/Jupiter cross-check.
	maxPriceDivergence = 0.02
	// lamportsPerSOL converts lamports to SOL.
	lamportsPerSOL = 1_000_000_000.0
)

func main() {
	jsonOut := flag.Bool("json", false, "emit results as JSON")
	webEnvPath := flag.String("web-env", "", "optional KEY=VAL file with web service env for the banner check")
	flag.Parse()

	if *webEnvPath != "" {
		if err := loadWebEnv(*webEnvPath); err != nil {
			fmt.Fprintf(os.Stderr, "preflight: %v\n", err)
			os.Exit(1)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	results := runAll(ctx)

	if *jsonOut {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(results); err != nil {
			fmt.Fprintf(os.Stderr, "preflight: encode: %v\n", err)
			os.Exit(1)
		}
	} else {
		fmt.Printf("%-18s %-6s %s\n", "CHECK", "STATUS", "DETAIL")
		for _, r := range results {
			fmt.Printf("%-18s %-6s %s\n", r.Name, r.Status, r.Detail)
		}
	}

	for _, r := range results {
		if r.Status == statusFail {
			os.Exit(1)
		}
	}
}

func runAll(ctx context.Context) []Result {
	var out []Result
	fail := func(name, format string, args ...any) {
		out = append(out, Result{Name: name, Status: statusFail, Detail: fmt.Sprintf(format, args...)})
	}
	pass := func(name, format string, args ...any) {
		out = append(out, Result{Name: name, Status: statusPass, Detail: fmt.Sprintf(format, args...)})
	}
	warn := func(name, format string, args ...any) {
		out = append(out, Result{Name: name, Status: statusWarn, Detail: fmt.Sprintf(format, args...)})
	}
	skip := func(name, format string, args ...any) {
		out = append(out, Result{Name: name, Status: statusSkip, Detail: fmt.Sprintf(format, args...)})
	}

	// --- app_env: BC-08 custody enforcement requires an explicit env. ---
	appEnv := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	prod := appEnv == "production" || appEnv == "prod"
	switch appEnv {
	case "testnet", "staging", "production", "prod":
		pass("app_env", "APP_ENV=%s", appEnv)
	default:
		fail("app_env", "APP_ENV=%q is not explicit (want testnet|staging|production); custody checks would warn instead of enforce", os.Getenv("APP_ENV"))
	}

	// --- config_load: mirror the server's two init paths (main.go). ---
	// Path 1 (InitOracleFromEnv) skips without SOLANA_ORACLE_KEYPAIR; path 2
	// (liquidity-manager boot) defaults the path and succeeds via KMS.
	client := initRuntimeClient(ctx)
	if client == nil {
		if prod {
			fail("config_load", "no oracle client after both server init paths (settlement disabled in production)")
			return out
		}
		warn("config_load", "no oracle client after both server init paths (settlement disabled; client checks skip)")
	} else if err := solana.ValidateConfiguredTreasuryAddresses(client); err != nil {
		// The server log.Fatalf's here, so the gate fails too.
		fail("config_load", "treasury custody misconfiguration: %v", err)
		return out
	} else {
		pass("config_load", "oracle client built (program %s)", client.GetProgramID())
	}

	// --- rpc_reachable: every configured endpoint must serve a live slot. ---
	endpoints := solana.RPCEndpointsFromEnv()
	type healthy struct {
		client *rpc.Client
		ep     string
		slot   uint64
	}
	var good []healthy
	var rpcNotes []string
	for _, ep := range endpoints {
		c := rpc.New(ep)
		sctx, scancel := context.WithTimeout(ctx, 15*time.Second)
		start := time.Now()
		slot, err := c.GetSlot(sctx, rpc.CommitmentFinalized)
		scancel()
		if err != nil {
			// Scrub credentials: endpoint URLs may carry ?api-key= secrets.
			errStr := strings.ReplaceAll(err.Error(), ep, scrubEndpoint(ep))
			rpcNotes = append(rpcNotes, fmt.Sprintf("%s ERR %v", scrubEndpoint(ep), errStr))
			continue
		}
		good = append(good, healthy{client: c, ep: ep, slot: slot})
		rpcNotes = append(rpcNotes, fmt.Sprintf("%s slot=%d %dms", scrubEndpoint(ep), slot, time.Since(start).Milliseconds()))
	}
	if len(good) == 0 {
		fail("rpc_reachable", "no RPC endpoint served a slot: %s", strings.Join(rpcNotes, "; "))
		return out
	}
	rpcDetail := strings.Join(rpcNotes, "; ")
	public := false
	for _, ep := range endpoints {
		if isPublicEndpoint(ep) {
			public = true
		}
	}
	switch {
	case prod && public:
		fail("rpc_reachable", "production uses public RPC (rate-limited before): %s", rpcDetail)
	case len(endpoints) < 2:
		warn("rpc_reachable", "single RPC endpoint (no failover): %s", rpcDetail)
	case public:
		warn("rpc_reachable", "public RPC endpoint in use: %s", rpcDetail)
	default:
		pass("rpc_reachable", "%s", rpcDetail)
	}
	rpcClient := good[0].client

	// --- ws_live: live slot notifications over WebSocket. ---
	wsEndpoint := solana.WSEndpointFromEnv(endpoints)
	if wsEndpoint == "" {
		warn("ws_live", "no WS endpoint derived; deposit watcher falls back to polling")
	} else if err := checkWSSlot(ctx, wsEndpoint); err != nil {
		errStr := strings.ReplaceAll(err.Error(), wsEndpoint, scrubEndpoint(wsEndpoint))
		warn("ws_live", "%s: %v (watcher falls back to polling)", scrubEndpoint(wsEndpoint), errStr)
	} else {
		pass("ws_live", "%s delivered a live slot notification", scrubEndpoint(wsEndpoint))
	}

	// --- program_live: program executable + upgrade authority on-chain. ---
	programID, pok := resolveProgramID(client)
	if !pok {
		fail("program_live", "no oracle client and SOLANA_PROGRAM_ID missing or invalid")
	} else {
		authority, authPresent, err := checkProgramLive(ctx, rpcClient, programID)
		switch {
		case err != nil:
			fail("program_live", "%s: %v", programID, err)
		case !authPresent:
			if isTruthy(os.Getenv("PROXYHUBB_ALLOW_IMMUTABLE_PROGRAM")) {
				warn("program_live", "%s executable, upgrade authority None (immutable; explicitly allowed)", programID)
			} else {
				fail("program_live", "%s executable but upgrade authority is None (immutable); set PROXYHUBB_ALLOW_IMMUTABLE_PROGRAM=true only if intended", programID)
			}
		case prod:
			want := strings.TrimSpace(os.Getenv("SOLANA_PROGRAM_UPGRADE_AUTHORITY"))
			switch {
			case want == "":
				fail("program_live", "%s authority %s but SOLANA_PROGRAM_UPGRADE_AUTHORITY is unset; production must pin it", programID, authority)
			case want != authority.String():
				fail("program_live", "%s authority %s != pinned %s", programID, authority, want)
			default:
				pass("program_live", "%s executable, authority matches pin %s", programID, shortKey(authority.String()))
			}
		default:
			pass("program_live", "%s executable, upgrade authority %s", programID, authority)
		}
	}

	// --- pda_vault: canonical vault PDA derives + matches config. ---
	var vaultPDA sol.PublicKey
	if client == nil {
		skip("pda_vault", "settlement disabled (no oracle client)")
	} else if pda, bump, err := client.GetDepositVaultPDA(); err != nil {
		fail("pda_vault", "derive: %v", err)
	} else {
		vaultPDA = pda
		want := solana.GetDepositVaultAddress()
		if want != "" && want != vaultPDA.String() {
			fail("pda_vault", "derived %s (bump %d) != SOLANA_DEPOSIT_VAULT_ADDRESS %s", vaultPDA, bump, want)
		} else {
			vctx, vcancel := context.WithTimeout(ctx, 15*time.Second)
			acct, aerr := rpcClient.GetAccountInfo(vctx, vaultPDA)
			vcancel()
			switch {
			case aerr != nil:
				warn("pda_vault", "%s (bump %d): account query failed: %v", vaultPDA, bump, aerr)
			case acct == nil || acct.Value == nil:
				warn("pda_vault", "%s (bump %d): not yet initialized on-chain", vaultPDA, bump)
			default:
				pass("pda_vault", "%s (bump %d): exists, owner %s, %.6f SOL", vaultPDA, bump, acct.Value.Owner, lamportsToSOL(acct.Value.Lamports))
			}
		}
	}

	// --- kms_roundtrip: sign with the configured signer, verify locally. ---
	checkKMSRoundTrip(ctx, prod, pass, fail, warn)

	// --- custody_distinct: oracle / hot / vault / cold pairwise distinct. ---
	var oraclePK, hotPK sol.PublicKey
	if client != nil {
		oraclePK = client.GetOraclePublicKey()
		hotPK = client.GetPayoutPublicKey()
	}
	coldStr := strings.TrimSpace(os.Getenv("SOLANA_TREASURY_COLD_ADDRESS"))
	coldPK, coldErr := sol.PublicKeyFromBase58(coldStr)
	if client == nil {
		skip("custody_distinct", "settlement disabled (no oracle client)")
	} else if coldStr == "" || coldErr != nil {
		if prod {
			fail("custody_distinct", "SOLANA_TREASURY_COLD_ADDRESS missing or invalid in production")
		} else {
			warn("custody_distinct", "cold vault not configured (%s); oracle %s hot %s vault %s",
				nonEmptyOr(coldStr, "unset"), shortKey(oraclePK.String()), shortKey(hotPK.String()), shortKey(vaultPDA.String()))
		}
	} else {
		roles := map[string]sol.PublicKey{"oracle": oraclePK, "hot": hotPK, "vault": vaultPDA, "cold": coldPK}
		seen := map[string]string{}
		dup := ""
		for role, pk := range roles {
			if prev, ok := seen[pk.String()]; ok {
				dup = fmt.Sprintf("%s == %s (%s)", role, prev, shortKey(pk.String()))
				break
			}
			seen[pk.String()] = role
		}
		if dup != "" {
			fail("custody_distinct", "custody roles share an address: %s", dup)
		} else {
			pass("custody_distinct", "oracle/hot/vault/cold pairwise distinct")
		}
	}

	// --- hot_float: hot balance within on-call min/max bounds. ---
	minF, minOK := parseFloatEnv("SOLANA_TREASURY_HOT_MIN_BALANCE")
	maxF, maxOK := parseFloatEnv("SOLANA_TREASURY_HOT_MAX_BALANCE")
	if !minOK || !maxOK {
		if prod {
			fail("hot_float", "hot float bounds unset (min ok=%v max ok=%v); production must set both", minOK, maxOK)
		} else {
			warn("hot_float", "hot float bounds unset (min ok=%v max ok=%v)", minOK, maxOK)
		}
	} else if client == nil {
		skip("hot_float", "settlement disabled (no oracle client)")
	} else {
		bctx, bcancel := context.WithTimeout(ctx, 20*time.Second)
		bal, berr := client.GetBalance(bctx, hotPK)
		bcancel()
		if berr != nil {
			fail("hot_float", "hot %s balance query: %v", shortKey(hotPK.String()), berr)
		} else {
			solBal := lamportsToSOL(bal)
			switch {
			case solBal < minF:
				fail("hot_float", "hot %.6f SOL below min %.6f (payouts would stall)", solBal, minF)
			case solBal > maxF:
				warn("hot_float", "hot %.6f SOL above max %.6f (sweep to cold)", solBal, maxF)
			default:
				pass("hot_float", "hot %.6f SOL within [%.6f, %.6f]", solBal, minF, maxF)
			}
		}
	}

	// --- vault_floor: deposit vault above the reserve floor. ---
	floorF, floorOK := parseFloatEnv("SOLANA_VAULT_RESERVE_FLOOR_SOL")
	if client == nil {
		skip("vault_floor", "settlement disabled (no oracle client)")
	} else if vaultMissing(ctx, rpcClient, vaultPDA) {
		skip("vault_floor", "vault %s not initialized; floor applies after first deposit", shortKey(vaultPDA.String()))
	} else if !floorOK {
		if prod {
			fail("vault_floor", "SOLANA_VAULT_RESERVE_FLOOR_SOL unset in production")
		} else {
			warn("vault_floor", "SOLANA_VAULT_RESERVE_FLOOR_SOL unset")
		}
	} else {
		bctx, bcancel := context.WithTimeout(ctx, 20*time.Second)
		bal, berr := client.GetBalance(bctx, vaultPDA)
		bcancel()
		if berr != nil {
			fail("vault_floor", "vault balance query: %v", berr)
		} else if solBal := lamportsToSOL(bal); solBal < floorF {
			fail("vault_floor", "vault %.6f SOL below floor %.6f", solBal, floorF)
		} else {
			pass("vault_floor", "vault %.6f SOL above floor %.6f", solBal, floorF)
		}
	}

	// --- oracle_price: live quote, fresh, cross-checked. ---
	checkOraclePrice(ctx, pass, fail, warn)

	// --- dev_keys_off: dev signing must be off in production. ---
	// Mirrors the gate in internal/api/provider_dev_listing_sign.go: the
	// PROXYHUB_ALLOW_DEV_LISTING_SIGN env plus release-mode hardening.
	allowDev := isTruthy(os.Getenv("PROXYHUB_ALLOW_DEV_LISTING_SIGN"))
	ginMode := strings.ToLower(strings.TrimSpace(os.Getenv("GIN_MODE")))
	if prod {
		switch {
		case allowDev:
			fail("dev_keys_off", "PROXYHUB_ALLOW_DEV_LISTING_SIGN is set in production")
		case ginMode != "release":
			fail("dev_keys_off", "GIN_MODE=%q in production (want release)", os.Getenv("GIN_MODE"))
		default:
			pass("dev_keys_off", "dev server signing off, GIN_MODE=release")
		}
	} else {
		pass("dev_keys_off", "dev signing allowed=%v GIN_MODE=%q (non-production)", allowDev, nonEmptyOr(ginMode, "unset"))
	}

	// --- banner_consistent: web honesty strip matches APP_ENV. ---
	// Mirrors apps/web/src/components/TestnetEnvironmentBanner.tsx.
	network := os.Getenv("NEXT_PUBLIC_SOLANA_NETWORK")
	show := os.Getenv("NEXT_PUBLIC_SHOW_TESTNET_BANNER")
	webProvided := *webEnvProvided() || network != "" || show != ""
	st, reason := bannerConsistent(appEnv, network, show)
	if !webProvided {
		if prod {
			fail("banner_consistent", "cannot verify web banner: pass -web-env (production must prove the strip is hidden)")
		} else {
			skip("banner_consistent", "web env not provided; run with -web-env to verify the strip")
		}
	} else if st == statusFail {
		fail("banner_consistent", "%s", reason)
	} else {
		pass("banner_consistent", "%s", reason)
	}

	return out
}

// initRuntimeClient reproduces the server boot's oracle wiring (main.go):
// InitOracleFromEnv first, then the liquidity-manager Config with the same
// keypair-path defaulting. Returns nil when settlement is disabled.
func initRuntimeClient(ctx context.Context) *solana.OracleClient {
	restore := quietStdout()
	defer restore()

	// Path 1: skips silently without SOLANA_ORACLE_KEYPAIR (settlement off).
	// The server only logs a warning on error and continues, so do the same.
	_ = solana.InitOracleFromEnv()
	if client := solana.GetOracleClient(); client != nil {
		return client
	}

	// Path 2: liquidity-manager boot defaults the keypair path and relies on
	// KMS signers when no file exists.
	hotPath := strings.TrimSpace(os.Getenv("SOLANA_TREASURY_HOT_KEYPAIR"))
	if hotPath == "" {
		hotPath = strings.TrimSpace(os.Getenv("SOLANA_TREASURY_KEYPAIR"))
	}
	oraclePath := strings.TrimSpace(os.Getenv("SOLANA_ORACLE_KEYPAIR"))
	if oraclePath == "" {
		oraclePath = "oracle-keypair.json"
	}
	client, err := solana.NewOracleClient(solana.Config{
		RPCEndpoints:           solana.HealthyRPCEndpoints(ctx, solana.RPCEndpointsFromEnv()),
		OracleKeypairPath:      oraclePath,
		TreasuryHotKeypairPath: hotPath,
		Network:                solana.EffectiveSolanaNetwork(),
	})
	if err != nil {
		return nil
	}
	solana.RegisterOracleClient(client)
	return client
}

// quietStdout silences the solana package's boot chatter so --json output
// stays parseable. Returns a restore function.
func quietStdout() func() {
	null, err := os.OpenFile(os.DevNull, os.O_WRONLY, 0)
	if err != nil {
		return func() {}
	}
	saved := os.Stdout
	os.Stdout = null
	return func() {
		os.Stdout = saved
		null.Close()
	}
}

// resolveProgramID returns the program under test: the oracle client's when
// settlement is enabled, else SOLANA_PROGRAM_ID or the compiled-in default
// (mirroring effectiveProgramID in internal/solana/client.go).
func resolveProgramID(client *solana.OracleClient) (sol.PublicKey, bool) {
	if client != nil {
		return client.GetProgramID(), true
	}
	id := strings.TrimSpace(os.Getenv("SOLANA_PROGRAM_ID"))
	if id == "" {
		id = solana.DefaultProgramID
	}
	pid, err := sol.PublicKeyFromBase58(id)
	if err != nil {
		return sol.PublicKey{}, false
	}
	return pid, true
}

// webEnvProvided reports whether -web-env was passed (set in loadWebEnv).
var webEnvFlag = false

func webEnvProvided() *bool { return &webEnvFlag }

// loadWebEnv imports the two banner inputs from a KEY=VAL file.
func loadWebEnv(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read -web-env %s: %w", path, err)
	}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		if k != "NEXT_PUBLIC_SOLANA_NETWORK" && k != "NEXT_PUBLIC_SHOW_TESTNET_BANNER" {
			continue
		}
		v = strings.Trim(strings.TrimSpace(v), `"'`)
		os.Setenv(k, v)
	}
	webEnvFlag = true
	return nil
}

// checkWSSlot connects to the WS endpoint and waits for one slot notification.
func checkWSSlot(ctx context.Context, endpoint string) error {
	cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	client, err := ws.Connect(cctx, endpoint)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer client.Close()
	sub, err := client.SlotSubscribe()
	if err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}
	defer sub.Unsubscribe()
	rctx, rcancel := context.WithTimeout(ctx, 20*time.Second)
	defer rcancel()
	res, err := sub.Recv(rctx)
	if err != nil {
		return fmt.Errorf("no slot notification: %w", err)
	}
	if res == nil {
		return fmt.Errorf("empty slot notification")
	}
	return nil
}

// checkProgramLive verifies the program account is executable under the
// upgradeable loader and returns its upgrade authority.
func checkProgramLive(ctx context.Context, c *rpc.Client, programID sol.PublicKey) (sol.PublicKey, bool, error) {
	pctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	out, err := c.GetAccountInfo(pctx, programID)
	if err != nil {
		return sol.PublicKey{}, false, fmt.Errorf("account query: %w", err)
	}
	if out == nil || out.Value == nil {
		return sol.PublicKey{}, false, fmt.Errorf("account missing on-chain")
	}
	if !out.Value.Executable {
		return sol.PublicKey{}, false, fmt.Errorf("account is not executable")
	}
	if !out.Value.Owner.Equals(sol.BPFLoaderUpgradeableProgramID) {
		return sol.PublicKey{}, false, fmt.Errorf("owner %s is not the upgradeable loader", out.Value.Owner)
	}
	programDataAddr, err := parseProgramAccount(out.Value.Data.GetBinary())
	if err != nil {
		return sol.PublicKey{}, false, fmt.Errorf("program account layout: %w", err)
	}
	dctx, dcancel := context.WithTimeout(ctx, 15*time.Second)
	defer dcancel()
	dout, err := c.GetAccountInfo(dctx, programDataAddr)
	if err != nil {
		return sol.PublicKey{}, false, fmt.Errorf("programdata query: %w", err)
	}
	if dout == nil || dout.Value == nil {
		return sol.PublicKey{}, false, fmt.Errorf("programdata account missing")
	}
	present, authority, err := parseProgramDataAuthority(dout.Value.Data.GetBinary())
	if err != nil {
		return sol.PublicKey{}, false, fmt.Errorf("programdata layout: %w", err)
	}
	return authority, present, nil
}

// parseProgramAccount extracts the ProgramData address from an upgradeable
// program account: u32 discriminant (2 = Program) + 32-byte address.
func parseProgramAccount(data []byte) (sol.PublicKey, error) {
	if len(data) < 36 {
		return sol.PublicKey{}, fmt.Errorf("short data (%d bytes)", len(data))
	}
	if binary.LittleEndian.Uint32(data[0:4]) != 2 {
		return sol.PublicKey{}, fmt.Errorf("discriminant %d is not Program(2)", binary.LittleEndian.Uint32(data[0:4]))
	}
	return sol.PublicKeyFromBytes(data[4:36]), nil
}

// parseProgramDataAuthority extracts the upgrade authority from a ProgramData
// account: u32(3) + u64 slot + COption<Pubkey> (u32 tag + 32 bytes when Some).
func parseProgramDataAuthority(data []byte) (bool, sol.PublicKey, error) {
	if len(data) < 16 {
		return false, sol.PublicKey{}, fmt.Errorf("short data (%d bytes)", len(data))
	}
	if binary.LittleEndian.Uint32(data[0:4]) != 3 {
		return false, sol.PublicKey{}, fmt.Errorf("discriminant %d is not ProgramData(3)", binary.LittleEndian.Uint32(data[0:4]))
	}
	switch tag := binary.LittleEndian.Uint32(data[12:16]); tag {
	case 0:
		return false, sol.PublicKey{}, nil
	case 1:
		if len(data) < 48 {
			return false, sol.PublicKey{}, fmt.Errorf("short authority (%d bytes)", len(data))
		}
		return true, sol.PublicKeyFromBytes(data[16:48]), nil
	default:
		return false, sol.PublicKey{}, fmt.Errorf("bad authority tag %d", tag)
	}
}

// checkKMSRoundTrip signs a fresh random message with the configured signer
// and verifies the signature against its public key.
func checkKMSRoundTrip(ctx context.Context, prod bool,
	pass func(string, string, ...any), fail func(string, string, ...any), warn func(string, string, ...any)) {
	roundTrip := func(name string, signer solSigner) {
		msg := make([]byte, 32)
		if _, err := rand.Read(msg); err != nil {
			fail("kms_roundtrip", "%s: rand: %v", name, err)
			return
		}
		sctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		sig, err := signer.Sign(sctx, msg)
		if err != nil {
			fail("kms_roundtrip", "%s sign: %v", name, err)
			return
		}
		if !ed25519.Verify(signer.PublicKey().Bytes(), msg, sig) {
			fail("kms_roundtrip", "%s signature did not verify", name)
			return
		}
		pass("kms_roundtrip", "%s sign+verify ok (%s)", name, shortKey(signer.PublicKey().String()))
	}

	useGCP := os.Getenv("USE_GCP_KMS") == "true"
	useAWS := os.Getenv("USE_AWS_KMS") == "true"
	switch {
	case useGCP:
		// Prefer GCP Cloud KMS when both flags are set (GCP deployment path),
		// mirroring NewOracleClient.
		signer, err := solana.NewGCPKMSSigner(ctx,
			strings.TrimSpace(os.Getenv("GCP_KMS_KEY_NAME")),
			strings.TrimSpace(os.Getenv("GCP_KMS_PUBLIC_KEY")))
		if err != nil {
			fail("kms_roundtrip", "gcp kms init: %v", err)
			return
		}
		roundTrip("gcp-kms", signer)
		checkHotKMS(ctx, roundTrip, fail)
	case useAWS:
		pubKey, err := sol.PublicKeyFromBase58(strings.TrimSpace(os.Getenv("AWS_KMS_PUBLIC_KEY")))
		if err != nil {
			fail("kms_roundtrip", "invalid AWS_KMS_PUBLIC_KEY: %v", err)
			return
		}
		signer, err := solana.NewAWSKMSSigner(os.Getenv("AWS_KMS_KEY_ID"), pubKey)
		if err != nil {
			fail("kms_roundtrip", "aws kms init: %v", err)
			return
		}
		roundTrip("aws-kms", signer)
	default:
		if prod {
			fail("kms_roundtrip", "production without USE_GCP_KMS/USE_AWS_KMS (boot refuses local signing too)")
			return
		}
		warn("kms_roundtrip", "KMS flags unset; oracle signs with a local keypair (dev only)")
		checkHotKMS(ctx, roundTrip, fail)
	}
}

// checkHotKMS round-trips the optional hot-payout KMS signer when configured.
func checkHotKMS(ctx context.Context, roundTrip func(string, solSigner), fail func(string, string, ...any)) {
	if os.Getenv("USE_GCP_KMS_HOT") != "true" {
		return
	}
	signer, err := solana.NewGCPKMSSigner(ctx,
		strings.TrimSpace(os.Getenv("GCP_KMS_HOT_KEY_NAME")),
		strings.TrimSpace(os.Getenv("GCP_KMS_HOT_PUBLIC_KEY")))
	if err != nil {
		fail("kms_roundtrip", "gcp hot kms init: %v", err)
		return
	}
	roundTrip("gcp-kms-hot", signer)
}

// solSigner is the signing surface both cloud KMS signers implement.
type solSigner interface {
	PublicKey() sol.PublicKey
	Sign(ctx context.Context, message []byte) ([]byte, error)
}

// vaultMissing reports whether the vault PDA has no on-chain account.
func vaultMissing(ctx context.Context, c *rpc.Client, vault sol.PublicKey) bool {
	vctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	acct, err := c.GetAccountInfo(vctx, vault)
	return err != nil || acct == nil || acct.Value == nil
}

// checkOraclePrice verifies a live, fresh, sane SOL quote and cross-checks it
// against a second vendor.
func checkOraclePrice(ctx context.Context,
	pass func(string, string, ...any), fail func(string, string, ...any), warn func(string, string, ...any)) {
	pctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	price, err := prices.GetSOLPrice(pctx)
	cancel()
	if err != nil {
		fail("oracle_price", "CoinGecko via runtime path: %v", err)
		return
	}
	if !(price > 0.1 && price < 1e7) || math.IsNaN(price) {
		fail("oracle_price", "insane quote %v", price)
		return
	}

	httpClient := &http.Client{Timeout: 15 * time.Second}
	_, updatedAt, ferr := fetchCoinGeckoFresh(ctx, httpClient)
	if ferr != nil {
		fail("oracle_price", "CoinGecko freshness probe: %v", ferr)
		return
	}
	if age := time.Since(updatedAt); age > maxPriceAge {
		fail("oracle_price", "quote %.2f stale by %s", price, age.Round(time.Second))
		return
	}

	jup, jerr := fetchJupiterSOLPrice(ctx, httpClient)
	switch {
	case jerr != nil:
		warn("oracle_price", "%.2f fresh, but Jupiter cross-check unavailable: %v (single-source)", price, jerr)
	case math.Abs(jup-price)/price > maxPriceDivergence:
		warn("oracle_price", "%.2f vs Jupiter %.2f diverge >%.0f%%; investigate before cutover", price, jup, maxPriceDivergence*100)
	default:
		pass("oracle_price", "%.2f fresh, Jupiter agrees (%.2f)", price, jup)
	}
}

// fetchCoinGeckoFresh reads a timestamped quote straight from CoinGecko.
func fetchCoinGeckoFresh(ctx context.Context, httpClient *http.Client) (float64, time.Time, error) {
	url := "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_last_updated_at=true"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, time.Time{}, err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, time.Time{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, time.Time{}, fmt.Errorf("status %d", resp.StatusCode)
	}
	var body struct {
		Solana struct {
			USD         float64 `json:"usd"`
			LastUpdated int64   `json:"last_updated_at"`
		} `json:"solana"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return 0, time.Time{}, err
	}
	if body.Solana.LastUpdated == 0 {
		return 0, time.Time{}, fmt.Errorf("no last_updated_at in response")
	}
	return body.Solana.USD, time.Unix(body.Solana.LastUpdated, 0), nil
}

// fetchJupiterSOLPrice reads an independent SOL quote (no API key).
func fetchJupiterSOLPrice(ctx context.Context, httpClient *http.Client) (float64, error) {
	url := "https://lite-api.jup.ag/price/v3?ids=" + solMint
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("status %d", resp.StatusCode)
	}
	var body map[string]struct {
		USDPrice float64 `json:"usdPrice"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return 0, err
	}
	q, ok := body[solMint]
	if !ok || q.USDPrice <= 0 {
		return 0, fmt.Errorf("no usable quote in response")
	}
	return q.USDPrice, nil
}

// bannerConsistent mirrors TestnetEnvironmentBanner: production must hide the
// strip on mainnet; every other env must show it.
func bannerConsistent(appEnv, network, show string) (status, string) {
	network = strings.TrimSpace(network)
	if network == "" {
		network = "devnet"
	}
	visible := bannerVisible(network, show)
	prod := appEnv == "production" || appEnv == "prod"
	switch {
	case prod && visible:
		return statusFail, fmt.Sprintf("testnet banner visible in production (network %q)", network)
	case prod && !strings.Contains(strings.ToLower(network), "mainnet"):
		return statusFail, fmt.Sprintf("production on network %q (want mainnet)", network)
	case prod:
		return statusPass, fmt.Sprintf("banner hidden on mainnet (%q)", network)
	case !visible:
		return statusFail, fmt.Sprintf("banner hidden on %s (honesty strip must show)", nonEmptyOr(appEnv, "unset env"))
	default:
		return statusPass, fmt.Sprintf("banner visible on %s (%q)", nonEmptyOr(appEnv, "unset env"), network)
	}
}

// bannerVisible reimplements shouldShowTestnetBanner from the web app.
func bannerVisible(network, show string) bool {
	switch strings.ToLower(strings.TrimSpace(show)) {
	case "0", "false", "no":
		return false
	case "1", "true", "yes":
		return true
	}
	n := strings.ToLower(network)
	return strings.Contains(n, "devnet") || strings.Contains(n, "testnet") || strings.Contains(n, "local")
}

// isPublicEndpoint reports well-known public RPC hosts.
func isPublicEndpoint(ep string) bool {
	e := strings.ToLower(ep)
	return strings.Contains(e, "api.devnet.solana.com") ||
		strings.Contains(e, "api.mainnet-beta.solana.com") ||
		strings.Contains(e, "api.testnet.solana.com")
}

// isTruthy matches the repo's truthy-env convention (see
// internal/api/provider_dev_listing_sign.go).
func isTruthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "y", "on":
		return true
	}
	return false
}

// parseFloatEnv parses a float env var, reporting whether it was set+valid.
func parseFloatEnv(name string) (float64, bool) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return 0, false
	}
	f, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(f) {
		return 0, false
	}
	return f, true
}

func lamportsToSOL(lamports uint64) float64 {
	return float64(lamports) / lamportsPerSOL
}

// scrubEndpoint redacts query strings (often ?api-key= secrets) from display.
func scrubEndpoint(ep string) string {
	if i := strings.Index(ep, "?"); i >= 0 {
		return ep[:i] + "?<redacted>"
	}
	return ep
}

func shortKey(s string) string {
	if len(s) <= 12 {
		return s
	}
	return s[:8] + "…" + s[len(s)-4:]
}

func nonEmptyOr(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return v
}
