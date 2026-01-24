package domain

import "time"

// Usage represents a unit of bandwidth consumption
type Usage struct {
	SessionID string
	BytesUp   int64
	BytesDown int64
	Timestamp time.Time
}

// Session represents the minimal session data needed for billing
type Session struct {
	ID         string
	ProviderID string
	BuyerID    string
	Status     string
}
