package decentralization

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// FullModeEnabled returns true when the runtime should reject centralized
// fallbacks and require chain-authoritative execution for critical flows.
func FullModeEnabled() bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("FULL_DECENTRALIZATION")))
	switch raw {
	case "1", "true", "yes", "on", "full", "strict":
		return true
	default:
		return false
	}
}

func envTruthy(key string, defaultTrue bool) bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if raw == "" {
		return defaultTrue
	}
	switch raw {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return defaultTrue
	}
}

// DepositVaultCreditEnabled allows ledger credits when a deposit lands on the vault PDA.
// Default: false (safe until vault is initialized and verified).
func DepositVaultCreditEnabled() bool {
	return envTruthy("PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED", false)
}

// DepositLegacyTreasuryCreditEnabled keeps crediting deposits to SOLANA_TREASURY_ADDRESS.
// Default: true during dual-write cutover.
func DepositLegacyTreasuryCreditEnabled() bool {
	return envTruthy("PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT", true)
}

// DepositVaultUIEnabled advertises the vault PDA as the user-facing deposit destination.
// Default: false.
func DepositVaultUIEnabled() bool {
	return envTruthy("PROXYHUB_DEPOSIT_VAULT_UI", false)
}

// DepositRequireFinalized switches deposit tx verification to commitment=finalized (BC-07).
// Explicit env wins. When unset: true for staging/production, false for local/dev.
func DepositRequireFinalized() bool {
	raw := strings.TrimSpace(os.Getenv("PROXYHUB_DEPOSIT_REQUIRE_FINALIZED"))
	if raw != "" {
		return envTruthy("PROXYHUB_DEPOSIT_REQUIRE_FINALIZED", false)
	}
	env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	switch env {
	case "production", "prod", "staging":
		return true
	default:
		return false
	}
}

// RequireEscrowPDAEnabled rejects marketplace confirm/release without an escrow PDA,
// blocks custodial seller credit on auto-release, and skips custodial billing settle
// for escrow-backed marketplace sessions. Default: false.
func RequireEscrowPDAEnabled() bool {
	return envTruthy("PROXYHUB_REQUIRE_ESCROW_PDA", false)
}

// RequireSessionPDAEnabled requires PAYG/instant sessions to fund a session escrow PDA
// before activation and settles usage on-chain instead of debiting balance_sol. Default: false.
func RequireSessionPDAEnabled() bool {
	return envTruthy("PROXYHUB_REQUIRE_SESSION_PDA", false)
}

// RequireUsageProofBeforeSettle refuses marketplace escrow settle when on-chain
// submit_usage_proof anchoring fails (BC-05 metering trust). Default: false
// locally; enable on gcp-testnet / staging.
func RequireUsageProofBeforeSettle() bool {
	return envTruthy("PROXYHUB_REQUIRE_USAGE_PROOF_BEFORE_SETTLE", false)
}

// EscrowChallengeDays is the buyer hold / challenge window before auto-release.
// PROXYHUB_ESCROW_CHALLENGE_DAYS (default 7). Values < 1 fall back to 7.
func EscrowChallengeDays() int {
	raw := strings.TrimSpace(os.Getenv("PROXYHUB_ESCROW_CHALLENGE_DAYS"))
	if raw == "" {
		return 7
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return 7
	}
	return n
}

// MultisigSettleEnabled gates amount-threshold routing to escrow_multisig PDAs
// and SettleEscrowMultiSig (BC-06). Default: false.
func MultisigSettleEnabled() bool {
	return envTruthy("PROXYHUB_MULTISIG_SETTLE_ENABLED", false)
}

// MultisigSettleAmountLamports is the minimum locked amount that uses the
// multisig escrow seed + dual-sig settle path. Default: 100_000_000 (0.1 SOL).
func MultisigSettleAmountLamports() uint64 {
	raw := strings.TrimSpace(os.Getenv("PROXYHUB_MULTISIG_SETTLE_AMOUNT_LAMPORTS"))
	if raw == "" {
		return 100_000_000
	}
	n, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || n == 0 {
		return 100_000_000
	}
	return n
}

// JournalAsSoTEnabled inverts Credit/Debit write order: post journal first, then
// mutate wallets.balance_* as a cache (M4). Default false — dual-write wallet-first.
func JournalAsSoTEnabled() bool {
	return envTruthy("PROXYHUB_JOURNAL_AS_SOT", false)
}

// JournalShadowReadEnabled logs wallet vs Σ2100 drift during recon (alert-only).
// Default true when JournalAsSoT is on; otherwise follows PROXYHUB_JOURNAL_SHADOW_READ.
func JournalShadowReadEnabled() bool {
	raw := strings.TrimSpace(os.Getenv("PROXYHUB_JOURNAL_SHADOW_READ"))
	if raw != "" {
		return envTruthy("PROXYHUB_JOURNAL_SHADOW_READ", false)
	}
	return JournalAsSoTEnabled()
}

// AllowAdminDisputeForceResolve is the escape hatch for admin jury override.
// Default false. Hard-disabled when FULL_DECENTRALIZATION is on (see admin API).
func AllowAdminDisputeForceResolve() bool {
	return envTruthy("PROXYHUB_ALLOW_ADMIN_DISPUTE_FORCE_RESOLVE", false)
}

// ProviderRegistryGateMode controls DISC-01 Wave 3.1 selection against on-chain
// ProviderRegistry (is_active + heartbeat TTL).
// Values: off | observe | enforce (default off).
func ProviderRegistryGateMode() string {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("PROXYHUB_PROVIDER_REGISTRY_GATE")))
	switch raw {
	case "observe", "enforce":
		return raw
	case "1", "true", "yes", "on":
		return "enforce"
	default:
		return "off"
	}
}

// ProviderRegistryGateEnabled is true when mode is observe or enforce.
func ProviderRegistryGateEnabled() bool {
	return ProviderRegistryGateMode() != "off"
}

// ProviderRegistryGateEnforce is true only in enforce mode (fail-closed).
func ProviderRegistryGateEnforce() bool {
	return ProviderRegistryGateMode() == "enforce"
}

// BrowseRegistryFilterMode controls Wave 5.C catalog hard-filter for browse/map.
// Values: off | observe | enforce (default off).
// Enforce drops listings whose PG provider_nodes.is_registered_on_chain is false.
// Does not claim an on-chain listing PDA index — still Postgres catalog.
func BrowseRegistryFilterMode() string {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("PROXYHUB_BROWSE_REGISTRY_FILTER")))
	switch raw {
	case "observe", "enforce":
		return raw
	case "1", "true", "yes", "on":
		return "enforce"
	default:
		return "off"
	}
}

// BrowseRegistryFilterEnforce is true when browse/map must omit unregistered supply.
func BrowseRegistryFilterEnforce() bool {
	return BrowseRegistryFilterMode() == "enforce"
}

// ListingCommitmentMode controls Wave 5.C.5 offer-hash PDA anchoring.
// Values: off | observe | enforce (default off).
// observe: best-effort oracle register + PG mirror + browse annotation.
// enforce: browse/map also hard-filter by listing_commitment_on_chain.
// Not a full on-chain catalog — merchandising remains Postgres.
func ListingCommitmentMode() string {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("PROXYHUB_LISTING_COMMITMENT")))
	switch raw {
	case "observe", "enforce":
		return raw
	case "1", "true", "yes", "on":
		return "observe"
	default:
		return "off"
	}
}

// ListingCommitmentEnabled is true for observe or enforce.
func ListingCommitmentEnabled() bool {
	return ListingCommitmentMode() != "off"
}

// ListingCommitmentEnforce is true when browse must omit listings without a PDA mirror.
func ListingCommitmentEnforce() bool {
	return ListingCommitmentMode() == "enforce"
}

// ProviderRegistryHeartbeatMaxAge is the max age of last_heartbeat for a live
// registry row. PROXYHUB_PROVIDER_REGISTRY_HEARTBEAT_MAX_AGE (Go duration, default 30m).
func ProviderRegistryHeartbeatMaxAge() time.Duration {
	raw := strings.TrimSpace(os.Getenv("PROXYHUB_PROVIDER_REGISTRY_HEARTBEAT_MAX_AGE"))
	if raw == "" {
		return 30 * time.Minute
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		return 30 * time.Minute
	}
	return d
}

// CredentialProofMode controls Wave 3.3 / W5.C.2 buyer order-credential artifacts.
// Values: off | observe | enforce (default off).
// Enforce binds HMAC into Redis at activation and edge verifies on marketplace CONNECT.
func CredentialProofMode() string {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("PROXYHUB_CREDENTIAL_PROOF")))
	switch raw {
	case "observe", "enforce":
		return raw
	case "1", "true", "yes", "on":
		return "enforce"
	default:
		return "off"
	}
}

// CredentialProofEnabled is true when observe or enforce mode is on.
func CredentialProofEnabled() bool {
	return CredentialProofMode() != "off"
}

// CredentialProofEnforce is true when CONNECT must verify the bound HMAC artifact.
func CredentialProofEnforce() bool {
	return CredentialProofMode() == "enforce"
}

// SessionCapabilityMode controls Wave 7.A Ed25519 capability tokens.
// Values: off | observe | enforce (default off).
// Observe attaches the token to Redis; enforce fail-closes mint without a signing key
// and is the edge admission path (HMAC not required when capability enforce is on).
func SessionCapabilityMode() string {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("PROXYHUB_SESSION_CAPABILITY")))
	switch raw {
	case "observe", "enforce":
		return raw
	case "1", "true", "yes", "on":
		return "observe"
	default:
		return "off"
	}
}

// SessionCapabilityEnabled is true when observe or enforce mode is on.
func SessionCapabilityEnabled() bool {
	return SessionCapabilityMode() != "off"
}

// SessionCapabilityEnforce is true when marketplace CONNECT must verify the capability.
func SessionCapabilityEnforce() bool {
	return SessionCapabilityMode() == "enforce"
}

// SessionMintHonesty is the public session_mint label (not DePIN).
// enforce + operator mint soak → operator_capability;
// enforce → capability_token; otherwise HMAC if credential proof is on, else none.
func SessionMintHonesty() string {
	if SessionCapabilityEnforce() && OperatorCapabilityMintEnabled() {
		return "operator_capability"
	}
	if SessionCapabilityEnforce() {
		return "capability_token"
	}
	if CredentialProofEnabled() {
		return "control_api_hmac"
	}
	return "none"
}

// OperatorCapabilityMintEnabled is PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT.
// Does not change admission by itself; enforce still required for CONNECT.
func OperatorCapabilityMintEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT"))) {
	case "1", "true", "yes", "on", "observe", "enforce":
		return true
	default:
		return false
	}
}

func operatorBundlePinConfigured() bool {
	return strings.TrimSpace(os.Getenv("PROXYHUB_OPERATOR_BUNDLE_PATH")) != "" ||
		strings.TrimSpace(os.Getenv("PROXYHUB_OPERATOR_BUNDLE_URL")) != "" ||
		strings.TrimSpace(os.Getenv("PROXYHUB_OPERATOR_BUNDLE_CID")) != ""
}

func sessionCapabilityIssuerHonesty() string {
	if operatorBundlePinConfigured() {
		return "operators_and_control_api"
	}
	return "control_api"
}

// SessionCapabilityMeta is public Wave 7.A honesty for GET /system/config/public.
func SessionCapabilityMeta() map[string]interface{} {
	mode := SessionCapabilityMode()
	note := "Wave 7.A: marketplace CONNECT can verify an Ed25519 capability locally " +
		"(no CONTROL_API_URL at CONNECT). Issuer may still be control-api at mint time. " +
		"Redis may still cache the blob. Not an on-chain lease PDA; not programs/session."
	switch mode {
	case "enforce":
		note += " PROXYHUB_SESSION_CAPABILITY=enforce: capability is admission; HMAC not required. " +
			"W7.C: CONNECT password phubb1.<token> admits without Redis session: (usage WAL still Redis-best-effort). " +
			"Remaining SPOF is the token issuer until W8/W9 chain lease."
	case "observe":
		note += " Observe attaches the token but HMAC/legacy still gates if credential proof enforce is on. Redis still required for CONNECT."
	default:
		note += " Default off — SESSION_SECRET HMAC remains the marketplace proof when credential proof is on."
	}
	return map[string]interface{}{
		"session_mint":                     SessionMintHonesty(),
		"session_capability_mode":          mode,
		"session_capability_issuer":        sessionCapabilityIssuerHonesty(),
		"session_capability_operator_mint": OperatorCapabilityMintEnabled(),
		"session_capability_issuer_pubkey": strings.TrimSpace(os.Getenv("PROXYHUB_SESSION_CAPABILITY_ISSUER_PUBKEY")),
		"redis_optional_connect":           mode == "enforce",
		"admission_sot":                    SessionMintHonesty(),
		"remaining_spof":                   remainingSPOF(mode),
		"note":                             note,
	}
}

func remainingSPOF(mode string) string {
	if mode == "enforce" {
		return "token_issuer"
	}
	return "control_api_hmac_and_redis"
}

// ListingAppealDays is the seller window to appeal a delist (Wave 3.5).
// PROXYHUB_LISTING_APPEAL_DAYS (default 7). Values < 1 fall back to 7.
func ListingAppealDays() int {
	raw := strings.TrimSpace(os.Getenv("PROXYHUB_LISTING_APPEAL_DAYS"))
	if raw == "" {
		return 7
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return 7
	}
	return n
}

// ZKOnchainGroth16Enabled is Sprint B / Wave 4.1 flag for BN254 Groth16 verify
// inside the Solana program. Default false — Halo2-IPA remains off-chain only (BC-11).
// When true, settlement must use the Groth16 path, which currently fail-closes
// until ZKOnchainGroth16Ready() is true (verifier + Anchor tests).
func ZKOnchainGroth16Enabled() bool {
	return envTruthy("PROXYHUB_ZK_ONCHAIN_GROTH16", false)
}

// ZKOnchainGroth16Ready reports whether on-chain alt_bn128 verify is wired and
// operators may send submit_zk_batch_groth16. Default false.
//
// Set PROXYHUB_ZK_ONCHAIN_GROTH16_READY=true only after:
//   - proxyhub built with --features onchain-groth16
//   - host tests (groth16_batch) pass
//   - program redeployed with matching BatchGroth16VKHash
func ZKOnchainGroth16Ready() bool {
	return envTruthy("PROXYHUB_ZK_ONCHAIN_GROTH16_READY", false)
}

// ErrOnchainGroth16NotReady is returned when Groth16 settlement is required or
// requested but the verifier is not live.
var ErrOnchainGroth16NotReady = errOnchainGroth16NotReady{}

type errOnchainGroth16NotReady struct{}

func (errOnchainGroth16NotReady) Error() string {
	return "PROXYHUB_ZK_ONCHAIN_GROTH16: on-chain Groth16 verifier not ready (set PROXYHUB_ZK_ONCHAIN_GROTH16_READY after onchain-groth16 deploy)"
}

// GateOnchainGroth16Settlement fail-closes when the operator enabled Groth16
// settlement before the verifier is ready. Call from ZK batch submit paths.
func GateOnchainGroth16Settlement() error {
	if !ZKOnchainGroth16Enabled() {
		return nil
	}
	if ZKOnchainGroth16Ready() {
		return nil
	}
	return ErrOnchainGroth16NotReady
}

// OpsOnchainPauseEnabled controls whether control-api may invoke the Solana
// program emergency_pause ix. Default false (Wave 4.4) — JWT admin only flips
// the Redis/app breaker; on-chain pause requires the program admin key via an
// explicit ops script with CONFIRM_ONCHAIN_PAUSE=1.
func OpsOnchainPauseEnabled() bool {
	return envTruthy("PROXYHUB_OPS_ONCHAIN_PAUSE", false)
}

// GovTreasuryAutoSpendEnabled would allow governance to SendSOL from hot wallet
// when paired with PROXYHUB_GOV_TREASURY_EXECUTE_CONFIRM=1 (Wave 5.C.3).
// Default false — without the confirm gate, treasury proposals stay pending_custody.
func GovTreasuryAutoSpendEnabled() bool {
	return envTruthy("PROXYHUB_GOV_TREASURY_AUTO_SPEND", false)
}

// GovTreasuryExecuteConfirm is the second gate for live hot-wallet treasury spend.
// Must be exactly "1" (same pattern as CONFIRM_ONCHAIN_PAUSE). Default unset/false.
func GovTreasuryExecuteConfirm() bool {
	return strings.TrimSpace(os.Getenv("PROXYHUB_GOV_TREASURY_EXECUTE_CONFIRM")) == "1"
}

// GovTreasuryHotWalletExecuteArmed is true only when auto-spend + confirm are both set.
func GovTreasuryHotWalletExecuteArmed() bool {
	return GovTreasuryAutoSpendEnabled() && GovTreasuryExecuteConfirm()
}

// GovernanceAutonomyMeta is public honesty for Wave 4.4 / W5.C.3.
func GovernanceAutonomyMeta() map[string]interface{} {
	armed := GovTreasuryHotWalletExecuteArmed()
	execPath := "pending_custody"
	note := "Wave 4.4/W5.C.3: API emergency pause is app-level (Redis) by default. " +
		"On-chain emergency_pause requires program admin + explicit ops confirm. "
	if armed {
		execPath = "hot_wallet_dual_gated"
		note += "Treasury auto-spend dual-gated (AUTO_SPEND + EXECUTE_CONFIRM=1) — " +
			"hot-wallet SendSOL, not on-chain proposal→treasury PDA CPI."
	} else {
		note += "Passed treasury proposals queue pending_custody unless " +
			"PROXYHUB_GOV_TREASURY_AUTO_SPEND and PROXYHUB_GOV_TREASURY_EXECUTE_CONFIRM=1."
	}
	return map[string]interface{}{
		"ops_onchain_pause_via_api": OpsOnchainPauseEnabled(),
		"app_level_pause":           "redis_watchtower",
		"onchain_pause":             "program_admin_key_only",
		"treasury_auto_spend":       GovTreasuryAutoSpendEnabled(),
		"treasury_execute_confirm":  GovTreasuryExecuteConfirm(),
		"treasury_execution":        execPath,
		"onchain_execute_proposal":  "status_flip_after_timelock_no_sol_move",
		"note":                      note,
	}
}
