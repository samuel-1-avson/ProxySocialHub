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
	if err := s.repo.RecordUptimeCheck(ctx, nodeID, isHealthy, latency); err != nil {
		return err
	}

	// Recalculate Quality Score (The "Oracle")
	checks, err := s.repo.GetLast24HoursChecks(ctx, nodeID)
	if err != nil {
		logging.Error(err).Msg("Failed to retrieve metrics for scoring")
		return nil // Don't fail the heartbeat if scoring fails
	}

	if len(checks) > 0 {
		var upCount int
		var totalLatency int

		for _, c := range checks {
			if c.IsUp {
				upCount++
			}
			totalLatency += c.LatencyMs
		}

		uptimePct := float64(upCount) / float64(len(checks)) * 100.0
		avgLatency := float64(totalLatency) / float64(len(checks))

		// Score Formula: 70% Uptime + 30% Latency Performance
		// Latency Score: 100 points for 0ms, 0 points for >1000ms
		latencyScore := 100.0 - (avgLatency / 10.0)
		if latencyScore < 0 {
			latencyScore = 0
		}

		finalScore := (uptimePct * 0.7) + (latencyScore * 0.3)

		logging.Info().
			Str("node_id", nodeID.String()).
			Float64("score", finalScore).
			Float64("uptime", uptimePct).
			Float64("latency", avgLatency).
			Msg("MarketplaceService: Updated Quality Score")

		return s.repo.UpdateQualityScore(ctx, nodeID, finalScore)
	}

	return nil
}
