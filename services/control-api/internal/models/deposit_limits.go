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
var DepositLedgerTypes = []string{"deposit", "deposit_auto"}

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
