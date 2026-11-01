package treasury

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	sol "github.com/gagliardetto/solana-go"
)

// LargeTreasuryWithdrawalSOL is the amount above which admin withdrawals require 2-of-3 approval.
const LargeTreasuryWithdrawalSOL = 100.0

// Hot wallet tuning defaults (SOL). Override via env for each deployment.
// Non-mainnet defaults stay small so testnet/staging capital does not false-CRITICAL.
const (
	defaultHotMinMainnet    = 100.0
	defaultHotMaxMainnet    = 500.0
	defaultReplenishMainnet = 200.0

	defaultHotMinStaging    = 5.0
	defaultHotMaxStaging    = 50.0
	defaultReplenishStaging = 15.0

	defaultHotMinDev    = 0.1
	defaultHotMaxDev    = 10.0
	defaultReplenishDev = 2.0

	defaultVaultReserveFloorSOL = 0.01
)

// GetHotTreasuryPubkey returns the operational hot treasury address.
// Falls back to SOLANA_TREASURY_ADDRESS. Does NOT fall back to the oracle
// pubkey — callers that need a last-resort oracle fallback must do so explicitly
// (treasury_manager still does for legacy deploys).
func GetHotTreasuryPubkey() sol.PublicKey {
	if pk := pubkeyFromEnv("SOLANA_TREASURY_HOT_ADDRESS"); !pk.IsZero() {
		return pk
	}
	return getLegacyTreasuryPubkey()
}

// RequireHotDistinctFromOracle returns an error when hot treasury equals oracle
// in production (BC-08). Soft-warns in non-production.
func RequireHotDistinctFromOracle(oraclePK sol.PublicKey) error {
	hot := GetHotTreasuryPubkey()
	if hot.IsZero() || oraclePK.IsZero() {
		return nil
	}
	if !hot.Equals(oraclePK) {
		return nil
	}
	env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if env == "production" || env == "prod" {
		return fmt.Errorf("BC-08: hot treasury address equals oracle pubkey — custody not split")
	}
	return nil
}

// GetColdTreasuryPubkey returns the cold storage address when configured.
func GetColdTreasuryPubkey() sol.PublicKey {
	return pubkeyFromEnv("SOLANA_TREASURY_COLD_ADDRESS")
}

// GetDepositVaultPubkey returns the program deposit vault PDA when configured.
func GetDepositVaultPubkey() sol.PublicKey {
	return pubkeyFromEnv("SOLANA_DEPOSIT_VAULT_ADDRESS")
}

// HotMinBalanceSOL returns the minimum hot-wallet balance before replenish is recommended.
func HotMinBalanceSOL() float64 {
	return envFloatSOL("SOLANA_TREASURY_HOT_MIN_BALANCE", defaultHotMinSOL())
}

// HotMaxBalanceSOL returns the target ceiling for hot-wallet balance after replenish.
func HotMaxBalanceSOL() float64 {
	return envFloatSOL("SOLANA_TREASURY_HOT_MAX_BALANCE", defaultHotMaxSOL())
}

// HotReplenishAmountSOL is the suggested vault→hot (or cold→hot proposal) transfer size.
func HotReplenishAmountSOL() float64 {
	return envFloatSOL("SOLANA_TREASURY_REPLENISH_AMOUNT", defaultReplenishSOL())
}

// VaultReserveFloorSOL is the SOL that must remain in the deposit vault (rent + ops buffer).
func VaultReserveFloorSOL() float64 {
	return envFloatSOL("SOLANA_VAULT_RESERVE_FLOOR_SOL", defaultVaultReserveFloorSOL)
}

// VaultTopUpMaxSOL caps a single vault→hot auto top-up.
func VaultTopUpMaxSOL() float64 {
	return envFloatSOL("SOLANA_VAULT_TOPUP_MAX_SOL", HotReplenishAmountSOL())
}

// VaultDailyTopUpCapSOL caps aggregate vault→hot auto top-ups per UTC day.
func VaultDailyTopUpCapSOL() float64 {
	fallback := 200.0
	if isMainnetEnv() {
		fallback = 2000.0
	} else if isDevEnv() {
		fallback = 50.0
	}
	return envFloatSOL("SOLANA_VAULT_DAILY_TOPUP_CAP_SOL", fallback)
}

func defaultHotMinSOL() float64 {
	if isMainnetEnv() {
		return defaultHotMinMainnet
	}
	if isStagingEnv() {
		return defaultHotMinStaging
	}
	return defaultHotMinDev
}

func defaultHotMaxSOL() float64 {
	if isMainnetEnv() {
		return defaultHotMaxMainnet
	}
	if isStagingEnv() {
		return defaultHotMaxStaging
	}
	return defaultHotMaxDev
}

func defaultReplenishSOL() float64 {
	if isMainnetEnv() {
		return defaultReplenishMainnet
	}
	if isStagingEnv() {
		return defaultReplenishStaging
	}
	return defaultReplenishDev
}

func isMainnetEnv() bool {
	network := strings.ToLower(strings.TrimSpace(os.Getenv("SOLANA_NETWORK")))
	appEnv := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	return network == "mainnet-beta" || network == "mainnet" || appEnv == "production" || appEnv == "prod"
}

func isStagingEnv() bool {
	network := strings.ToLower(strings.TrimSpace(os.Getenv("SOLANA_NETWORK")))
	appEnv := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	// testnet shares the staging treasury tier (APP_ENV=testnet flip).
	return network == "staging" || appEnv == "staging" || appEnv == "testnet"
}

func isDevEnv() bool {
	return !isMainnetEnv() && !isStagingEnv()
}

func getLegacyTreasuryPubkey() sol.PublicKey {
	return pubkeyFromEnv("SOLANA_TREASURY_ADDRESS")
}

func pubkeyFromEnv(key string) sol.PublicKey {
	addr := os.Getenv(key)
	if addr == "" {
		return sol.PublicKey{}
	}
	pk, err := sol.PublicKeyFromBase58(addr)
	if err != nil {
		return sol.PublicKey{}
	}
	return pk
}

func envFloatSOL(key string, fallback float64) float64 {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || v <= 0 {
		return fallback
	}
	return v
}
