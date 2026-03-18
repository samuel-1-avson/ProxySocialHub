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
			Description:          l.Description,
			PricePerGB:           l.PricePerGB,
			AvailableBandwidthGB: l.AvailableBandwidthGB,
			ProxyType:            domain.ProxyType(l.ProxyType),
			Protocol:             l.Protocol,
			Status:               domain.ListingStatus(l.Status),
			QualityScore:         l.QualityScore,
			Country:              l.Country,
			ISP:                  l.ISP,
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
		Description:          entity.Description,
		PricePerGB:           entity.PricePerGB,
		AvailableBandwidthGB: entity.AvailableBandwidthGB,
		ProxyType:            models.ProxyType(entity.ProxyType),
		Protocol:             entity.Protocol,
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

func (r *marketplaceRepository) GetLast24HoursChecks(ctx context.Context, nodeID uuid.UUID) ([]domain.UptimeCheck, error) {
	var checks []models.UptimeCheck
	cutoff := time.Now().Add(-24 * time.Hour)

	if err := DB.Where("node_id = ? AND checked_at > ?", nodeID, cutoff).Find(&checks).Error; err != nil {
		return nil, err
	}

	domainChecks := make([]domain.UptimeCheck, len(checks))
	for i, c := range checks {
		domainChecks[i] = domain.UptimeCheck{
			IsUp:      c.IsUp,
			LatencyMs: c.LatencyMs,
			CheckedAt: c.CheckedAt,
		}
	}
	return domainChecks, nil
}

func (r *marketplaceRepository) UpdateQualityScore(ctx context.Context, nodeID uuid.UUID, score float64) error {
	// Update Node score
	if err := DB.Model(&models.Node{}).Where("id = ?", nodeID).Update("quality_score", score).Error; err != nil {
		return err
	}

	// Update active listings score for visibility
	// Assuming Node is linked to a Seller (User), and Listings belong to Seller.
	// Since we strictly link Node -> Provider, and Listing -> Provider.
	// We first get the node to find the provider (UserID).
	var node models.Node
	if err := DB.Select("user_id").First(&node, "id = ?", nodeID).Error; err != nil {
		return err
	}

	return DB.Model(&models.ProxyListing{}).
		Where("seller_id = ? AND status = ?", node.ProviderUserID, models.ListingStatusActive).
		Update("quality_score", score).Error
}
