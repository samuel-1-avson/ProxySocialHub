package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrListingNotFound     = errors.New("listing not found")
	ErrListingForbidden    = errors.New("listing operation forbidden")
	ErrListingUnavailable  = errors.New("listing is not available")
	ErrListingAlreadySaved = errors.New("listing already saved")
	ErrListingNotSaved     = errors.New("listing not saved")
)

// ListingStatus represents the state of a listing
type ListingStatus string

const (
	ListingActive        ListingStatus = "active"
	ListingPendingReview ListingStatus = "pending_review"
	ListingPaused        ListingStatus = "paused"
	ListingSoldOut       ListingStatus = "sold_out"
	ListingDeleted       ListingStatus = "deleted"
)

// ProxyType represents the network type
type ProxyType string

const (
	Residential ProxyType = "residential"
	Mobile      ProxyType = "mobile"
	Datacenter  ProxyType = "datacenter"
)

// SellerPublicProfile is the seller subset exposed on listing reads.
type SellerPublicProfile struct {
	ID            uuid.UUID
	DisplayName   *string
	Username      *string
	AvatarURL     *string
	TrustTier     string
	Role          string
}

// ListingDetail is a single listing read model for buyers.
type ListingDetail struct {
	Listing ListingEntity
	Seller  *SellerPublicProfile
	IsSaved bool
}

// SavedListingEntry is a user's bookmark with listing snapshot.
type SavedListingEntry struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	ListingID uuid.UUID
	Listing   ListingEntity
	Seller    *SellerPublicProfile
	CreatedAt time.Time
}

// ListingEntity represents the core marketplace product
type ListingEntity struct {
	ID                   uuid.UUID
	SellerID             uuid.UUID
	ProviderNodeID       *uuid.UUID
	ListingOfferHash     string
	ListingOfferSignature string
	ListingOfferSigner   string
	ListingOfferSignedAt *time.Time
	ListingOfferVerified bool
	ListingOfferVerificationError string
	ListingOfferNonce    string
	Title                string
	Description          string
	ProxyType            ProxyType
	Protocol             string
	RotationType         string
	Country              string
	ISP                  string
	PricePerGB           float64
	MinPurchaseGB        float64
	AvailableBandwidthGB float64
	MaxConcurrency       int
	Status               ListingStatus
	QualityScore         float64
	AvgLatencyMs         int
	UptimePercent        float64
	SuccessRate          float64
	CurrentTier          string
	ViewsCount           int
	SavesCount           int
	OrdersCount          int
	ActiveSessionsCount  int
	AllowDirectMessage   bool
	CreatedAt            time.Time
	UpdatedAt            time.Time
	Seller               *SellerPublicProfile `json:"-"`
}

type ListingUpdate struct {
	Title                *string
	Description          *string
	PricePerGB           *float64
	MinPurchaseGB        *float64
	AvailableBandwidthGB *float64
	MaxConcurrency       *int
	Status               *ListingStatus
	BulkDiscountsJSON    []byte
	ListingOfferHash     *string
	ListingOfferSignature *string
	ListingOfferSigner   *string
	ListingOfferSignedAt *time.Time
	ListingOfferVerified *bool
	ListingOfferVerificationError *string
	ListingOfferNonce    *string
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

type UptimeCheck struct {
	IsUp      bool
	LatencyMs int
	CheckedAt time.Time
}
