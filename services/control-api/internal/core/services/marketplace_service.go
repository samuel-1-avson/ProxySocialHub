package services

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/core/domain"
	"github.com/proxyhubb/control-api/internal/core/ports"
	"github.com/proxyhubb/control-api/internal/logging"
)

type marketplaceService struct {
	repo ports.MarketplaceRepository
}

// NewMarketplaceService creates a new instance of the core marketplace logic
func NewMarketplaceService(repo ports.MarketplaceRepository) ports.MarketplaceService {
	return &marketplaceService{
		repo: repo,
	}
}

func (s *marketplaceService) BrowseMarket(ctx context.Context, filters map[string]interface{}) ([]domain.ListingEntity, int64, error) {
	logging.Info().Msg("MarketplaceService: Browsing market with filters")
	return s.repo.GetListings(ctx, filters)
}

func (s *marketplaceService) PublishListing(ctx context.Context, sellerID uuid.UUID, listing domain.ListingEntity) (*domain.ListingEntity, error) {
	logging.Info().Str("seller_id", sellerID.String()).Msg("MarketplaceService: Publishing new listing")

	// Business Rules
	listing.ID = uuid.New()
	listing.SellerID = sellerID
	listing.Status = domain.ListingActive

	if listing.PricePerGB <= 0 {
		return nil, fmt.Errorf("invalid pricing: must be greater than zero")
	}

	if err := s.repo.CreateListing(ctx, &listing); err != nil {
		return nil, fmt.Errorf("failed to persist listing: %w", err)
	}

	return &listing, nil
}

func (s *marketplaceService) GetProviderHealth(ctx context.Context, nodeID uuid.UUID) (float64, error) {
	node, err := s.repo.GetNodeByID(ctx, nodeID)
	if err != nil {
		return 0, err
	}

	// Logic extracted from models.Node.CalculateQualityScore
	return node.QualityScore, nil
}

func (s *marketplaceService) UpdateNodeStatus(ctx context.Context, nodeID uuid.UUID, isHealthy bool, latency int) error {
	logging.Info().Str("node_id", nodeID.String()).Bool("healthy", isHealthy).Int("latency", latency).Msg("MarketplaceService: Updating node status")

	// Record the status update
	if err := s.repo.UpdateNodeStatus(ctx, nodeID, isHealthy, latency); err != nil {
		return err
	}

	// Also record history for uptime scoring
	return s.repo.RecordUptimeCheck(ctx, nodeID, isHealthy, latency)
}
