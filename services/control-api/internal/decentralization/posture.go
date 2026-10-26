package decentralization

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// StrictEnvBool parses a boolean env flag and rejects unknown values
// instead of silently falling back to a default (P0-8: a typo like
// "ture" or "enabled" must fail boot, not quietly pick a posture).
// Returns (value, set, err).
func StrictEnvBool(key string) (bool, bool, error) {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if raw == "" {
		return false, false, nil
	}
	switch raw {
	case "1", "true", "yes", "on":
		return true, true, nil
	case "0", "false", "no", "off":
		return false, true, nil
	default:
		return false, true, fmt.Errorf("%s=%q is not a recognised boolean (use true/false/1/0/yes/no/on/off)", key, os.Getenv(key))
	}
}

// boolPostureFlags are the boolean security-posture flags read via
// envTruthy in mode.go. Every one must parse strictly at boot.
var boolPostureFlags = []string{
	"PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED",
	"PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT",
	"PROXYHUB_DEPOSIT_VAULT_UI",
	"PROXYHUB_DEPOSIT_REQUIRE_FINALIZED",
	"PROXYHUB_REQUIRE_ESCROW_PDA",
	"PROXYHUB_REQUIRE_SESSION_PDA",
	"PROXYHUB_REQUIRE_USAGE_PROOF_BEFORE_SETTLE",
	"PROXYHUB_MULTISIG_SETTLE_ENABLED",
	"PROXYHUB_JOURNAL_AS_SOT",
	"PROXYHUB_JOURNAL_SHADOW_READ",
	"PROXYHUB_ALLOW_ADMIN_DISPUTE_FORCE_RESOLVE",
	"PROXYHUB_ZK_ONCHAIN_GROTH16",
	"PROXYHUB_ZK_ONCHAIN_GROTH16_READY",
	"PROXYHUB_OPS_ONCHAIN_PAUSE",
	"PROXYHUB_GOV_TREASURY_AUTO_SPEND",
}

// enumPostureFlags accept off|observe|enforce plus truthy aliases.
var enumPostureFlags = []string{
	"PROXYHUB_PROVIDER_REGISTRY_GATE",
	"PROXYHUB_BROWSE_REGISTRY_FILTER",
	"PROXYHUB_LISTING_COMMITMENT",
	"PROXYHUB_CREDENTIAL_PROOF",
	"PROXYHUB_SESSION_CAPABILITY",
	"PROXYHUB_SESSION_CAPABILITY_OPERATOR_MINT",
}

// IsProduction reports a production APP_ENV.
func IsProduction() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV"))) {
	case "production", "prod":
		return true
	}
	return false
}

// ValidateSecurityPosture is the boot gate (P0-8). Any environment:
// posture flags must parse. Production additionally refuses to boot
// unless the secure wallet posture is asserted explicitly — secure
// values must never be reached by accident of a default.
func ValidateSecurityPosture() error {
	var problems []string

	// W-27: money caps must be coherent (single config, boot-validated).
	if _, err := MoneyCaps(); err != nil {
		problems = append(problems, err.Error())
	}

	for _, key := range boolPostureFlags {
		if _, _, err := StrictEnvBool(key); err != nil {
			problems = append(problems, err.Error())
		}
	}
	for _, key := range enumPostureFlags {
		raw := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
		switch raw {
		case "", "off", "observe", "enforce", "1", "true", "yes", "on", "0", "false", "no":
		default:
			problems = append(problems, fmt.Sprintf("%s=%q is not a recognised mode (use off/observe/enforce)", key, os.Getenv(key)))
		}
	}
	if raw := strings.ToLower(strings.TrimSpace(os.Getenv("FULL_DECENTRALIZATION"))); raw != "" {
		switch raw {
		case "1", "true", "yes", "on", "full", "strict", "0", "false", "no", "off":
		default:
			problems = append(problems, fmt.Sprintf("FULL_DECENTRALIZATION=%q is not recognised (use true/false/full/strict)", os.Getenv("FULL_DECENTRALIZATION")))
		}
	}

	if IsProduction() {
		// Finalized deposits must be an explicit operator assertion.
		finalized, set, err := StrictEnvBool("PROXYHUB_DEPOSIT_REQUIRE_FINALIZED")
		if err == nil {
			if !set {
				problems = append(problems, "PROXYHUB_DEPOSIT_REQUIRE_FINALIZED must be set explicitly in production (expected: true)")
			} else if !finalized {
				problems = append(problems, "PROXYHUB_DEPOSIT_REQUIRE_FINALIZED=false is forbidden in production (deposits must be finalized before credit)")
			}
		}
		// At least one deposit credit destination must be enabled, or
		// user deposits land on-chain with no ledger credit path.
		if !DepositVaultCreditEnabled() && !DepositLegacyTreasuryCreditEnabled() {
			problems = append(problems, "no deposit credit path enabled in production: enable PROXYHUB_DEPOSIT_VAULT_CREDIT_ENABLED or PROXYHUB_DEPOSIT_LEGACY_TREASURY_CREDIT")
		}
		// Settlement stalls rather than mis-price (P0-7); the emergency
		// price is the tier-3 fallback and must exist in production.
		if v := strings.TrimSpace(os.Getenv("EMERGENCY_SOL_PRICE_USD")); v == "" {
			problems = append(problems, "EMERGENCY_SOL_PRICE_USD must be set in production (tier-3 SOL price fallback)")
		} else if f, err := strconv.ParseFloat(v, 64); err != nil || f <= 0 {
			problems = append(problems, "EMERGENCY_SOL_PRICE_USD must be a positive number in production")
		}
		// main.go historically only enforced this when set; production
		// must assert it.
		if lease, set, err := StrictEnvBool("REQUIRE_PROVIDER_LEASE"); err != nil {
			problems = append(problems, err.Error())
		} else if !set || !lease {
			problems = append(problems, "REQUIRE_PROVIDER_LEASE must be true in production")
		}
	}

	if len(problems) > 0 {
		return fmt.Errorf("security posture validation failed:\n - %s", strings.Join(problems, "\n - "))
	}
	return nil
}

// EffectivePosture returns the resolved wallet-relevant posture for the
// boot log and ops surfaces — what is actually enforced, not what was
// intended.
func EffectivePosture() map[string]interface{} {
	return map[string]interface{}{
		"app_env":                        strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV"))),
		"full_decentralization":          FullModeEnabled(),
		"deposit_require_finalized":      DepositRequireFinalized(),
		"deposit_vault_credit":           DepositVaultCreditEnabled(),
		"deposit_legacy_treasury":        DepositLegacyTreasuryCreditEnabled(),
		"require_escrow_pda":             RequireEscrowPDAEnabled(),
		"require_session_pda":            RequireSessionPDAEnabled(),
		"require_usage_proof":            RequireUsageProofBeforeSettle(),
		"journal_as_sot":                 JournalAsSoTEnabled(),
		"admin_dispute_force_resolve":    AllowAdminDisputeForceResolve(),
		"emergency_sol_price_configured": strings.TrimSpace(os.Getenv("EMERGENCY_SOL_PRICE_USD")) != "",
	}
}

// EffectiveCaps returns the resolved money caps for posture reporting.
func EffectiveCaps() map[string]interface{} {
	caps, err := MoneyCaps()
	if err != nil {
		return map[string]interface{}{"error": err.Error()}
	}
	return map[string]interface{}{
		"max_single_transfer_sol": caps.MaxSingleTransferSOL,
		"max_hourly_outflow_sol":  caps.MaxHourlyOutflowSOL,
		"withdraw_api_cap_sol":    caps.WithdrawAPICapSOL,
	}
}
