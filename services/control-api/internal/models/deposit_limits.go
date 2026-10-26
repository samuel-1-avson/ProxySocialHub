package models

import (
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	DefaultMaxSingleDepositSOL = 10000.0
	DefaultMaxDailyDepositSOL  = 50000.0
)

// DepositLedgerTypes are ledger entry types that count toward deposit caps.
var DepositLedgerTypes = []string{LedgerKindDeposit, LedgerKindDepositAuto}

func envFloatPositive(key string, fallback float64) float64 {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || v <= 0 {
		return fallback
	}
	return v
}

// MaxSingleDepositSOL returns the per-tx deposit cap (env MAX_SINGLE_DEPOSIT_SOL).
func MaxSingleDepositSOL() float64 {
	return envFloatPositive("MAX_SINGLE_DEPOSIT_SOL", DefaultMaxSingleDepositSOL)
}

// MaxDailyDepositSOL returns the rolling 24h deposit cap (env MAX_DAILY_DEPOSIT_SOL).
func MaxDailyDepositSOL() float64 {
	return envFloatPositive("MAX_DAILY_DEPOSIT_SOL", DefaultMaxDailyDepositSOL)
}

// SumDepositsSince totals deposit + deposit_auto ledger credits since the cutoff.
func SumDepositsSince(tx *gorm.DB, walletID uuid.UUID, since time.Time) (float64, error) {
	var total float64
	err := tx.Model(&WalletLedgerEntry{}).
		Where("wallet_id = ? AND type IN ? AND created_at >= ?", walletID, DepositLedgerTypes, since).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&total).Error
	return total, err
}

// DepositCapsForTier returns per-tier deposit ceilings (W-34), never
// above the global env caps. KYC-approved users get one tier lift
// (new+KYC -> verified caps). Deposit ceilings sit above the matching
// spending ceilings so users can always fund what they may spend.
func DepositCapsForTier(tier TrustTier, kyc KYCStatus) (single, daily float64) {
	single, daily = MaxSingleDepositSOL(), MaxDailyDepositSOL()
	var tSingle, tDaily float64
	switch tier {
	case TrustTierPremium:
		return single, daily
	case TrustTierVerified:
		tSingle, tDaily = 250, 500
	default: // new / unknown
		tSingle, tDaily = 25, 50
		if kyc == KYCStatusApproved {
			tSingle, tDaily = 250, 500
		}
	}
	if tSingle < single {
		single = tSingle
	}
	if tDaily < daily {
		daily = tDaily
	}
	return single, daily
}

// DepositCapsForUser resolves tier+KYC for a user. On lookup failure it
// fails closed to the lowest (new) tier caps.
func DepositCapsForUser(tx *gorm.DB, userID uuid.UUID) (single, daily float64) {
	var user User
	if err := tx.Select("trust_tier, kyc_status").Where("id = ?", userID).First(&user).Error; err != nil {
		return DepositCapsForTier(TrustTierNew, KYCStatusNone)
	}
	return DepositCapsForTier(user.TrustTier, user.KYCStatus)
}

// AddressBlocked reports whether a Solana address is on the operator
// deny-list (W-34 screening). Config: BLOCKED_SOLANA_ADDRESSES
// (comma-separated base58). This is a real config-driven hook: an
// external screening provider can replace the env source behind this
// function without touching call sites.
func AddressBlocked(address string) bool {
	address = strings.TrimSpace(address)
	if address == "" {
		return false
	}
	for _, a := range strings.Split(os.Getenv("BLOCKED_SOLANA_ADDRESSES"), ",") {
		if strings.TrimSpace(a) == address {
			return true
		}
	}
	return false
}
