package ports

import (
	"context"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/core/domain"
)

// ListingViewer identifies who is requesting a listing read.
type ListingViewer struct {
	UserID      *uuid.UUID
	IsModerator bool
}

// MarketplaceRepository defines persistence for listings and nodes
type MarketplaceRepository interface {
	GetListings(ctx context.Context, filters map[string]interface{}) ([]domain.ListingEntity, int64, error)
	GetListingByID(ctx context.Context, id uuid.UUID) (*domain.ListingEntity, error)
	GetListingDetail(ctx context.Context, id uuid.UUID) (*domain.ListingEntity, *domain.SellerPublicProfile, error)
	IncrementListingViews(ctx context.Context, id uuid.UUID) error
	IsListingSaved(ctx context.Context, userID, listingID uuid.UUID) (bool, error)
	SearchListings(ctx context.Context, query string, limit int) ([]domain.ListingEntity, error)
	GetFeaturedListings(ctx context.Context, limit int) ([]domain.ListingEntity, error)
	GetSellerListings(ctx context.Context, sellerID uuid.UUID, page, limit int) ([]domain.ListingEntity, int64, error)
	GetSavedListings(ctx context.Context, userID uuid.UUID, page, limit int) ([]domain.SavedListingEntry, int64, error)
	CreateListing(ctx context.Context, listing *domain.ListingEntity) error
	UpdateListing(ctx context.Context, id uuid.UUID, updates domain.ListingUpdate) (*domain.ListingEntity, error)
	DeleteListing(ctx context.Context, id uuid.UUID) error
	SaveListing(ctx context.Context, userID, listingID uuid.UUID) error
	UnsaveListing(ctx context.Context, userID, listingID uuid.UUID) error

	GetNodeByID(ctx context.Context, id uuid.UUID) (*domain.NodeEntity, error)
	UpdateNodeStatus(ctx context.Context, nodeID uuid.UUID, isHealthy bool, latency int) error
	RecordUptimeCheck(ctx context.Context, nodeID uuid.UUID, isUp bool, latency int) error
	GetLast24HoursChecks(ctx context.Context, nodeID uuid.UUID) ([]domain.UptimeCheck, error)
	UpdateQualityScore(ctx context.Context, nodeID uuid.UUID, score float64) error
}

// MarketplaceService defines the primary use cases for the node market
type MarketplaceService interface {
	BrowseMarket(ctx context.Context, filters map[string]interface{}) ([]domain.ListingEntity, int64, error)
	GetListingForViewer(ctx context.Context, listingID uuid.UUID, viewer ListingViewer) (*domain.ListingDetail, error)
	SearchListings(ctx context.Context, query string) ([]domain.ListingEntity, error)
	GetFeaturedListings(ctx context.Context, limit int) ([]domain.ListingEntity, error)
	GetSellerListings(ctx context.Context, sellerID uuid.UUID, page, limit int) ([]domain.ListingEntity, int64, error)
	GetSavedListings(ctx context.Context, userID uuid.UUID, page, limit int) ([]domain.SavedListingEntry, int64, error)
	PublishListing(ctx context.Context, sellerID uuid.UUID, listing domain.ListingEntity) (*domain.ListingEntity, error)
	UpdateListing(ctx context.Context, sellerID, listingID uuid.UUID, updates domain.ListingUpdate) (*domain.ListingEntity, error)
	DeleteListing(ctx context.Context, sellerID, listingID uuid.UUID) error
	SaveListing(ctx context.Context, userID, listingID uuid.UUID) error
	UnsaveListing(ctx context.Context, userID, listingID uuid.UUID) error
	GetProviderHealth(ctx context.Context, nodeID uuid.UUID) (float64, error)
	UpdateNodeStatus(ctx context.Context, nodeID uuid.UUID, isHealthy bool, latency int) error
}
