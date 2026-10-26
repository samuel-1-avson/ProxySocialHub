package models

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// SpendingType represents the type of spending transaction
type SpendingType string

const (
	SpendingUsage    SpendingType = "usage"     // Bandwidth usage charges
	SpendingTransfer SpendingType = "transfer"  // P2P transfers
	SpendingWithdraw SpendingType = "withdraw"  // SOL withdrawals
	SpendingEscrow   SpendingType = "escrow"    // Escrow deposits
)

// SpendingRecord tracks individual spending transactions for limit enforcement
type SpendingRecord struct {
	ID        uuid.UUID    `gorm:"type:uuid;primary_key" json:"id"`
	UserID    uuid.UUID    `gorm:"type:uuid;not null;index:idx_spending_user_time" json:"user_id"`
	WalletID  uuid.UUID    `gorm:"type:uuid;not null" json:"wallet_id"`
	Amount    float64      `gorm:"type:numeric(20,9);not null" json:"amount"` // Always positive (spent amount)
	Type      SpendingType `gorm:"type:varchar(20);not null" json:"type"`
	Reference string       `gorm:"type:varchar(128)" json:"reference"` // Related tx/ledger ID
	CreatedAt time.Time    `gorm:"index:idx_spending_user_time" json:"created_at"`
}

// BeforeCreate generates UUID if not set
func (s *SpendingRecord) BeforeCreate(tx *gorm.DB) (err error) {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return
}

// SpendingWindow represents aggregated spending for a time window
type SpendingWindow struct {
	DailySpent   float64   `json:"daily_spent"`
	WeeklySpent  float64   `json:"weekly_spent"`
	MonthlySpent float64   `json:"monthly_spent"`
	WindowStart  time.Time `json:"window_start"`
}

// EffectiveLimits returns the limits actually enforced at spend time:
// the stored per-wallet limits clamped to the user's trust-tier ceilings
// (GetDefaultLimits doubles as the tier maximum, matching the settings
// API). A stored 0 stays 0 (zero allowed). When the user row cannot be
// loaded (e.g. unit tests with synthetic wallets), stored limits apply
// unclamped.
func (w *Wallet) EffectiveLimits(db *gorm.DB) DefaultSpendingLimits {
	eff := DefaultSpendingLimits{Daily: w.DailyLimit, Weekly: w.WeeklyLimit, Monthly: w.MonthlyLimit}
	if db == nil || w.UserID == uuid.Nil {
		return eff
	}
	var user User
	if err := db.Select("trust_tier").Where("id = ?", w.UserID).First(&user).Error; err != nil {
		return eff
	}
	max := GetDefaultLimits(user.TrustTier)
	// Uninitialized-wallet guard: an enabled wallet with NO window ever
	// configured (legacy/bare creation paths) gets tier defaults — the
	// same normalization migration 000158 applies to stored rows. A
	// single zero window alongside configured ones still blocks.
	if eff.Daily <= 0 && eff.Weekly <= 0 && eff.Monthly <= 0 {
		return max
	}
	if eff.Daily > max.Daily {
		eff.Daily = max.Daily
	}
	if eff.Weekly > max.Weekly {
		eff.Weekly = max.Weekly
	}
	if eff.Monthly > max.Monthly {
		eff.Monthly = max.Monthly
	}
	return eff
}

// CheckSpendingLimit checks if a transaction would exceed spending limits
// Returns nil if allowed, error if limit would be exceeded
func (w *Wallet) CheckSpendingLimit(db *gorm.DB, amount float64, txType SpendingType) error {
	// P2-17 + P0-5 (W-06): Limits only apply when explicitly enabled.
	// When enabled, a limit value of 0 means "zero spending allowed" —
	// it must never skip the check (that inverted guard made 0 unlimited
	// and defeated trust-tier ceilings). Enforcement uses the effective
	// (tier-clamped) limits, never raw stored values above the ceiling.
	if !w.LimitsEnabled {
		return nil
	}

	limits := w.EffectiveLimits(db)

	// Get current spending in each window
	spending, err := w.GetSpendingForWindow(db)
	if err != nil {
		return fmt.Errorf("failed to check spending: %w", err)
	}

	if spending.DailySpent+amount > limits.Daily {
		return &SpendingLimitError{
			LimitType:    "daily",
			Limit:        limits.Daily,
			CurrentSpend: spending.DailySpent,
			Attempted:    amount,
		}
	}
	if spending.WeeklySpent+amount > limits.Weekly {
		return &SpendingLimitError{
			LimitType:    "weekly",
			Limit:        limits.Weekly,
			CurrentSpend: spending.WeeklySpent,
			Attempted:    amount,
		}
	}
	if spending.MonthlySpent+amount > limits.Monthly {
		return &SpendingLimitError{
			LimitType:    "monthly",
			Limit:        limits.Monthly,
			CurrentSpend: spending.MonthlySpent,
			Attempted:    amount,
		}
	}

	return nil
}

// GetSpendingForWindow calculates current spending in daily, weekly, monthly windows
func (w *Wallet) GetSpendingForWindow(db *gorm.DB) (*SpendingWindow, error) {
	// P1-18: use UTC so window boundaries are consistent regardless of server timezone.
	now := time.Now().UTC()

	// Calculate window start times in UTC
	dayStart := now.Truncate(24 * time.Hour)
	weekStart := now.AddDate(0, 0, -int(now.Weekday())).Truncate(24 * time.Hour) // Sunday-based ISO week
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)

	var dailySpent, weeklySpent, monthlySpent float64

	// Query daily spending
	if err := db.Model(&SpendingRecord{}).
		Where("user_id = ? AND created_at >= ?", w.UserID, dayStart).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&dailySpent).Error; err != nil {
		return nil, err
	}

	// Query weekly spending
	if err := db.Model(&SpendingRecord{}).
		Where("user_id = ? AND created_at >= ?", w.UserID, weekStart).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&weeklySpent).Error; err != nil {
		return nil, err
	}

	// Query monthly spending
	if err := db.Model(&SpendingRecord{}).
		Where("user_id = ? AND created_at >= ?", w.UserID, monthStart).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&monthlySpent).Error; err != nil {
		return nil, err
	}

	return &SpendingWindow{
		DailySpent:   dailySpent,
		WeeklySpent:  weeklySpent,
		MonthlySpent: monthlySpent,
		WindowStart:  w.LimitWindowStart,
	}, nil
}

// RecordSpending creates a spending record for limit tracking
func (w *Wallet) RecordSpending(db *gorm.DB, amount float64, txType SpendingType, reference string) error {
	record := SpendingRecord{
		UserID:    w.UserID,
		WalletID:  w.ID,
		Amount:    amount,
		Type:      txType,
		Reference: reference,
	}
	return db.Create(&record).Error
}

// SpendingLimitError is returned when a spending limit would be exceeded
type SpendingLimitError struct {
	LimitType    string
	Limit        float64
	CurrentSpend float64
	Attempted    float64
}

func (e *SpendingLimitError) Error() string {
	return fmt.Sprintf("%s spending limit exceeded: limit=%.6f SOL, current=%.6f SOL, attempted=%.6f SOL",
		e.LimitType, e.Limit, e.CurrentSpend, e.Attempted)
}

// Remaining returns how much can still be spent in this window
func (e *SpendingLimitError) Remaining() float64 {
	remaining := e.Limit - e.CurrentSpend
	if remaining < 0 {
		return 0
	}
	return remaining
}

// DefaultSpendingLimits provides recommended default limits
type DefaultSpendingLimits struct {
	Daily   float64
	Weekly  float64
	Monthly float64
}

// GetDefaultLimits returns recommended default limits based on trust tier
func GetDefaultLimits(trustTier TrustTier) DefaultSpendingLimits {
	switch trustTier {
	case TrustTierVerified:
		return DefaultSpendingLimits{
			Daily:   50.0,  // 50 SOL per day
			Weekly:  200.0, // 200 SOL per week
			Monthly: 500.0, // 500 SOL per month
		}
	case TrustTierPremium:
		return DefaultSpendingLimits{
			Daily:   100.0,
			Weekly:  500.0,
			Monthly: 2000.0,
		}
	case TrustTierNew:
		fallthrough
	default:
		return DefaultSpendingLimits{
			Daily:   10.0,  // Conservative for new users
			Weekly:  50.0,
			Monthly: 100.0,
		}
	}
}

// InitializeWithDefaultLimits stores the recommended limits for the trust tier
// and enables them immediately. Limits are active by default to protect new
// accounts; users may raise or disable them via the settings API.
func (w *Wallet) InitializeWithDefaultLimits(trustTier TrustTier) {
	limits := GetDefaultLimits(trustTier)
	w.DailyLimit = limits.Daily
	w.WeeklyLimit = limits.Weekly
	w.MonthlyLimit = limits.Monthly
	w.LimitWindowStart = time.Now()
	w.LimitsEnabled = true
}
