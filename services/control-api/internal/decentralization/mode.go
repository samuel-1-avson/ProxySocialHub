package decentralization

import (
	"os"
	"strconv"
	"strings"
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

// ZKOnchainGroth16Enabled is Sprint B flag for BN254 Groth16 verify inside the
// Solana program. Default false — Halo2-IPA remains off-chain only (BC-11).
func ZKOnchainGroth16Enabled() bool {
	return envTruthy("PROXYHUB_ZK_ONCHAIN_GROTH16", false)
}
