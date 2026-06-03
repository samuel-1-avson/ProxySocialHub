package services

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/core/domain"
	"github.com/proxyhubb/control-api/internal/core/ports"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/marketplace/moderation"
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

func (s *marketplaceService) GetListingForViewer(ctx context.Context, listingID uuid.UUID, viewer ports.ListingViewer) (*domain.ListingDetail, error) {
	entity, seller, err := s.repo.GetListingDetail(ctx, listingID)
	if err != nil {
		return nil, err
	}
	if entity.Status == domain.ListingPendingReview {
		if viewer.UserID == nil || (!viewer.IsModerator && *viewer.UserID != entity.SellerID) {
			return nil, domain.ErrListingNotFound
		}
	}
	if err := s.repo.IncrementListingViews(ctx, listingID); err != nil {
		logging.Warn().Err(err).Str("listing_id", listingID.String()).Msg("Failed to increment listing views")
	}
	isSaved := false
	if viewer.UserID != nil {
		isSaved, err = s.repo.IsListingSaved(ctx, *viewer.UserID, listingID)
		if err != nil {
			logging.Warn().Err(err).Msg("Failed to check saved listing state")
		}
	}
	return &domain.ListingDetail{
		Listing: *entity,
		Seller:  seller,
		IsSaved: isSaved,
	}, nil
}

func (s *marketplaceService) SearchListings(ctx context.Context, query string) ([]domain.ListingEntity, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("search query is required")
	}
	return s.repo.SearchListings(ctx, query, 50)
}

func (s *marketplaceService) GetFeaturedListings(ctx context.Context, limit int) ([]domain.ListingEntity, error) {
	return s.repo.GetFeaturedListings(ctx, limit)
}

func (s *marketplaceService) GetSellerListings(ctx context.Context, sellerID uuid.UUID, page, limit int) ([]domain.ListingEntity, int64, error) {
	return s.repo.GetSellerListings(ctx, sellerID, page, limit)
}

func (s *marketplaceService) GetSavedListings(ctx context.Context, userID uuid.UUID, page, limit int) ([]domain.SavedListingEntry, int64, error) {
	return s.repo.GetSavedListings(ctx, userID, page, limit)
}

func (s *marketplaceService) PublishListing(ctx context.Context, sellerID uuid.UUID, listing domain.ListingEntity) (*domain.ListingEntity, error) {
	logging.Info().Str("seller_id", sellerID.String()).Msg("MarketplaceService: Publishing new listing")

	// Business Rules
	listing.ID = uuid.New()
	listing.SellerID = sellerID
	listing.Status = domain.ListingActive
	if moderation.ListingModerationEnforced() {
		listing.Status = domain.ListingPendingReview
	}

	if listing.PricePerGB <= 0 {
		return nil, fmt.Errorf("invalid pricing: must be greater than zero")
	}

	if err := s.repo.CreateListing(ctx, &listing); err != nil {
		return nil, fmt.Errorf("failed to persist listing: %w", err)
	}

	return &listing, nil
}

func (s *marketplaceService) UpdateListing(ctx context.Context, sellerID, listingID uuid.UUID, updates domain.ListingUpdate) (*domain.ListingEntity, error) {
	listing, err := s.repo.GetListingByID(ctx, listingID)
	if err != nil {
		return nil, err
	}
	if listing.SellerID != sellerID {
		return nil, domain.ErrListingForbidden
	}
	if listing.Status == domain.ListingPendingReview {
		if updates.PricePerGB != nil || updates.Title != nil || updates.Description != nil ||
			updates.MinPurchaseGB != nil || updates.AvailableBandwidthGB != nil || updates.MaxConcurrency != nil {
			return nil, fmt.Errorf("listing is pending review: price and content cannot be changed until approved")
		}
		if updates.Status != nil && *updates.Status != domain.ListingDeleted {
			return nil, fmt.Errorf("listing is pending review: only deletion is allowed until approved")
		}
	}
	if updates.Status != nil {
		if !canTransitionListingStatus(listing.Status, *updates.Status) {
			return nil, fmt.Errorf("invalid listing status transition: %s -> %s", listing.Status, *updates.Status)
		}
	}
	return s.repo.UpdateListing(ctx, listingID, updates)
}

func (s *marketplaceService) DeleteListing(ctx context.Context, sellerID, listingID uuid.UUID) error {
	listing, err := s.repo.GetListingByID(ctx, listingID)
	if err != nil {
		return err
	}
	if listing.SellerID != sellerID {
		return domain.ErrListingForbidden
	}
	deleted := domain.ListingDeleted
	if !canTransitionListingStatus(listing.Status, deleted) {
		return fmt.Errorf("invalid listing status transition: %s -> %s", listing.Status, deleted)
	}
	return s.repo.DeleteListing(ctx, listingID)
}

func (s *marketplaceService) SaveListing(ctx context.Context, userID, listingID uuid.UUID) error {
	listing, err := s.repo.GetListingByID(ctx, listingID)
	if err != nil {
		return err
	}
	if listing.Status != domain.ListingActive {
		return fmt.Errorf("%w: status %s", domain.ErrListingUnavailable, listing.Status)
	}
	return s.repo.SaveListing(ctx, userID, listingID)
}

func (s *marketplaceService) UnsaveListing(ctx context.Context, userID, listingID uuid.UUID) error {
	if _, err := s.repo.GetListingByID(ctx, listingID); err != nil {
		if errors.Is(err, domain.ErrListingNotFound) {
			return domain.ErrListingNotSaved
		}
		return err
	}
	return s.repo.UnsaveListing(ctx, userID, listingID)
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

func canTransitionListingStatus(from, to domain.ListingStatus) bool {
	if from == to {
		return from != domain.ListingDeleted
	}
	switch from {
	case "":
		return to == domain.ListingActive || to == domain.ListingPendingReview || to == domain.ListingPaused
	case domain.ListingPendingReview:
		return to == domain.ListingActive || to == domain.ListingDeleted
	case domain.ListingActive:
		return to == domain.ListingPaused || to == domain.ListingSoldOut || to == domain.ListingDeleted
	case domain.ListingPaused:
		return to == domain.ListingActive || to == domain.ListingDeleted
	case domain.ListingSoldOut:
		return to == domain.ListingActive || to == domain.ListingDeleted
	default:
		return false
	}
}
