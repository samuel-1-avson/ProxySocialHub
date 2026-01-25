package ports

import (
	"context"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/core/domain"
)

// MarketplaceRepository defines persistence for listings and nodes
type MarketplaceRepository interface {
	GetListings(ctx context.Context, filters map[string]interface{}) ([]domain.ListingEntity, int64, error)
	GetListingByID(ctx context.Context, id uuid.UUID) (*domain.ListingEntity, error)
	CreateListing(ctx context.Context, listing *domain.ListingEntity) error
	UpdateListing(ctx context.Context, listing *domain.ListingEntity) error

	GetNodeByID(ctx context.Context, id uuid.UUID) (*domain.NodeEntity, error)
	UpdateNodeStatus(ctx context.Context, nodeID uuid.UUID, isHealthy bool, latency int) error
	RecordUptimeCheck(ctx context.Context, nodeID uuid.UUID, isUp bool, latency int) error
}

// MarketplaceService defines the primary use cases for the node market
type MarketplaceService interface {
	BrowseMarket(ctx context.Context, filters map[string]interface{}) ([]domain.ListingEntity, int64, error)
	PublishListing(ctx context.Context, sellerID uuid.UUID, listing domain.ListingEntity) (*domain.ListingEntity, error)
	GetProviderHealth(ctx context.Context, nodeID uuid.UUID) (float64, error)
	UpdateNodeStatus(ctx context.Context, nodeID uuid.UUID, isHealthy bool, latency int) error
}
