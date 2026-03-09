package domain

import (
	"time"
)

type SessionStatus string

const (
	SessionPending    SessionStatus = "pending"
	SessionActive     SessionStatus = "active"
	SessionCompleted  SessionStatus = "completed"
	SessionTerminated SessionStatus = "terminated"
	SessionDisputed   SessionStatus = "disputed"
)

// SessionEntity represents the core business entity for a proxy connection
type SessionEntity struct {
	ID              string
	BuyerID         string
	ProviderID      string
	ListingID       string
	Status          SessionStatus
	BytesUsed       int64
	BandwidthLimit  int64
	PricePerHour    float64
	StartTime       time.Time
	EndTime         *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
	CredentialsUser string
	CredentialsPass string
}

// IsExhausted checks if the session has reached its data limit
func (s *SessionEntity) IsExhausted() bool {
	return s.BandwidthLimit > 0 && s.BytesUsed >= s.BandwidthLimit
}

// CalculateVestedAmount computes the current cost accrued so far
func (s *SessionEntity) CalculateVestedAmount() float64 {
	if s.StartTime.IsZero() {
		return 0
	}
	duration := time.Since(s.StartTime).Hours()
	return duration * s.PricePerHour
}
