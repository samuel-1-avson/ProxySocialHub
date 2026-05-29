package treasury

import (
	"os"
	"strconv"

	sol "github.com/gagliardetto/solana-go"
)

// LargeTreasuryWithdrawalSOL is the amount above which admin withdrawals require 2-of-3 approval.
const LargeTreasuryWithdrawalSOL = 100.0

// Hot wallet tuning (SOL). Override via env for each deployment.
const (
	defaultHotMinSOL      = 100.0
	defaultHotMaxSOL      = 500.0
	defaultReplenishSOL   = 200.0
)

// GetHotTreasuryPubkey returns the operational hot treasury address.
// Falls back to SOLANA_TREASURY_ADDRESS, then the oracle pubkey.
func GetHotTreasuryPubkey() sol.PublicKey {
	if pk := pubkeyFromEnv("SOLANA_TREASURY_HOT_ADDRESS"); !pk.IsZero() {
		return pk
	}
	return getLegacyTreasuryPubkey()
}

// GetColdTreasuryPubkey returns the cold storage address when configured.
func GetColdTreasuryPubkey() sol.PublicKey {
	return pubkeyFromEnv("SOLANA_TREASURY_COLD_ADDRESS")
}

// HotMinBalanceSOL returns the minimum hot-wallet balance before replenish is recommended.
func HotMinBalanceSOL() float64 {
	return envFloatSOL("SOLANA_TREASURY_HOT_MIN_BALANCE", defaultHotMinSOL)
}

// HotMaxBalanceSOL returns the target ceiling for hot-wallet balance after replenish.
func HotMaxBalanceSOL() float64 {
	return envFloatSOL("SOLANA_TREASURY_HOT_MAX_BALANCE", defaultHotMaxSOL)
}

// HotReplenishAmountSOL is the suggested cold→hot transfer size (requires multi-sig in 4.2).
func HotReplenishAmountSOL() float64 {
	return envFloatSOL("SOLANA_TREASURY_REPLENISH_AMOUNT", defaultReplenishSOL)
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
