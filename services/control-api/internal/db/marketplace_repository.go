package db

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/core/domain"
	"github.com/proxyhubb/control-api/internal/core/ports"
	"github.com/proxyhubb/control-api/internal/models"
)

type marketplaceRepository struct{}

// NewMarketplaceRepository creates a GORM-based adapter for the marketplace Port
func NewMarketplaceRepository() ports.MarketplaceRepository {
	return &marketplaceRepository{}
}

func (r *marketplaceRepository) GetListings(ctx context.Context, filters map[string]interface{}) ([]domain.ListingEntity, int64, error) {
	var listings []models.ProxyListing
	var total int64

	query := DB.Model(&models.ProxyListing{}).Where("status = ?", models.ListingStatusActive)

	// In a real implementation, we would map the filters to GORM queries here.
	// For the initial refactor, we keep it simple to establish the pattern.

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Find(&listings).Error; err != nil {
		return nil, 0, err
	}

	// Map models to domain entities
	entities := make([]domain.ListingEntity, len(listings))
	for i, l := range listings {
		entities[i] = domain.ListingEntity{
			ID:                   l.ID,
			SellerID:             l.SellerID,
			Title:                l.Title,
			PricePerGB:           l.PricePerGB,
			AvailableBandwidthGB: l.AvailableBandwidthGB,
			Status:               domain.ListingStatus(l.Status),
			QualityScore:         l.QualityScore,
		}
	}

	return entities, total, nil
}

func (r *marketplaceRepository) GetListingByID(ctx context.Context, id uuid.UUID) (*domain.ListingEntity, error) {
	var l models.ProxyListing
	if err := DB.First(&l, "id = ?", id).Error; err != nil {
		return nil, err
	}

	return &domain.ListingEntity{
		ID:       l.ID,
		SellerID: l.SellerID,
		Title:    l.Title,
		Status:   domain.ListingStatus(l.Status),
	}, nil
}

func (r *marketplaceRepository) CreateListing(ctx context.Context, entity *domain.ListingEntity) error {
	m := models.ProxyListing{
		ID:                   entity.ID,
		SellerID:             entity.SellerID,
		Title:                entity.Title,
		PricePerGB:           entity.PricePerGB,
		AvailableBandwidthGB: entity.AvailableBandwidthGB,
		Status:               models.ListingStatus(entity.Status),
	}
	return DB.Create(&m).Error
}

func (r *marketplaceRepository) UpdateListing(ctx context.Context, entity *domain.ListingEntity) error {
	return DB.Model(&models.ProxyListing{}).Where("id = ?", entity.ID).Updates(map[string]interface{}{
		"title":  entity.Title,
		"status": models.ListingStatus(entity.Status),
	}).Error
}

func (r *marketplaceRepository) GetNodeByID(ctx context.Context, id uuid.UUID) (*domain.NodeEntity, error) {
	var n models.Node
	if err := DB.First(&n, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &domain.NodeEntity{
		ID:           n.ID,
		QualityScore: n.QualityScore,
		IsHealthy:    n.IsHealthy,
	}, nil
}

func (r *marketplaceRepository) UpdateNodeStatus(ctx context.Context, nodeID uuid.UUID, isHealthy bool, latency int) error {
	return DB.Model(&models.Node{}).Where("id = ?", nodeID).Updates(map[string]interface{}{
		"is_healthy": isHealthy,
		"latency_ms": latency,
	}).Error
}

func (r *marketplaceRepository) RecordUptimeCheck(ctx context.Context, nodeID uuid.UUID, isUp bool, latency int) error {
	check := models.UptimeCheck{
		NodeID:    nodeID,
		IsUp:      isUp,
		LatencyMs: latency,
		CheckedAt: time.Now(),
	}
	return DB.Create(&check).Error
}
