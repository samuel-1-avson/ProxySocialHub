package domain

import (
	"time"

	"github.com/google/uuid"
)

// ListingStatus represents the state of a listing
type ListingStatus string

const (
	ListingActive  ListingStatus = "active"
	ListingPaused  ListingStatus = "paused"
	ListingSoldOut ListingStatus = "sold_out"
	ListingDeleted ListingStatus = "deleted"
)

// ProxyType represents the network type
type ProxyType string

const (
	Residential ProxyType = "residential"
	Mobile      ProxyType = "mobile"
	Datacenter  ProxyType = "datacenter"
)

// ListingEntity represents the core marketplace product
type ListingEntity struct {
	ID                   uuid.UUID
	SellerID             uuid.UUID
	Title                string
	Description          string
	ProxyType            ProxyType
	Protocol             string
	Country              string
	ISP                  string
	PricePerGB           float64
	MinPurchaseGB        float64
	AvailableBandwidthGB float64
	Status               ListingStatus
	QualityScore         float64
	AvgLatencyMs         int
	UptimePercent        float64
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// NodeEntity represents physical infrastructure
type NodeEntity struct {
	ID             uuid.UUID
	ProviderUserID uuid.UUID
	IPAddress      string
	Port           int
	Country        string
	Region         string
	City           string
	ISP            string
	ConnectionType string
	IsHealthy      bool
	QualityScore   float64
	LastSeenAt     time.Time
}
