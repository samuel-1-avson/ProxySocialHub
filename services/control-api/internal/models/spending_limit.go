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

// CheckSpendingLimit checks if a transaction would exceed spending limits
// Returns nil if allowed, error if limit would be exceeded
func (w *Wallet) CheckSpendingLimit(db *gorm.DB, amount float64, txType SpendingType) error {
	// P2-17: Limits only apply when explicitly enabled by the user.
	// A limit value of 0 means "zero spending allowed", not "unlimited".
	if !w.LimitsEnabled {
		return nil
	}

	// Get current spending in each window
	spending, err := w.GetSpendingForWindow(db)
	if err != nil {
		return fmt.Errorf("failed to check spending: %w", err)
	}

	// Check daily limit
	if w.DailyLimit > 0 {
		if spending.DailySpent+amount > w.DailyLimit {
			return &SpendingLimitError{
				LimitType:    "daily",
				Limit:        w.DailyLimit,
				CurrentSpend: spending.DailySpent,
				Attempted:    amount,
			}
		}
	}

	// Check weekly limit
	if w.WeeklyLimit > 0 {
		if spending.WeeklySpent+amount > w.WeeklyLimit {
			return &SpendingLimitError{
				LimitType:    "weekly",
				Limit:        w.WeeklyLimit,
				CurrentSpend: spending.WeeklySpent,
				Attempted:    amount,
			}
		}
	}

	// Check monthly limit
	if w.MonthlyLimit > 0 {
		if spending.MonthlySpent+amount > w.MonthlyLimit {
			return &SpendingLimitError{
				LimitType:    "monthly",
				Limit:        w.MonthlyLimit,
				CurrentSpend: spending.MonthlySpent,
				Attempted:    amount,
			}
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
// but does NOT enable them — the user must opt in via the settings API.
// This preserves the invariant that LimitsEnabled=false means "no restriction".
func (w *Wallet) InitializeWithDefaultLimits(trustTier TrustTier) {
	limits := GetDefaultLimits(trustTier)
	w.DailyLimit = limits.Daily
	w.WeeklyLimit = limits.Weekly
	w.MonthlyLimit = limits.Monthly
	w.LimitWindowStart = time.Now()
	// LimitsEnabled intentionally left false — user must opt in.
}
