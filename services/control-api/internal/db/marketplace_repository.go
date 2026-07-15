package db

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/core/domain"
	"github.com/proxyhubb/control-api/internal/core/ports"
	"github.com/proxyhubb/control-api/internal/marketplace/discovery"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

type marketplaceRepository struct{}

// NewMarketplaceRepository creates a GORM-based adapter for the marketplace Port
func NewMarketplaceRepository() ports.MarketplaceRepository {
	return &marketplaceRepository{}
}

func (r *marketplaceRepository) GetListings(ctx context.Context, filters map[string]interface{}) ([]domain.ListingEntity, int64, error) {
	var listings []models.ProxyListing
	var total int64

	q := discovery.FromListingFilterMap(filters)
	query := discovery.Apply(discovery.BaseQuery(GetReadDB().WithContext(ctx)), q).Preload("Seller")

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	query = discovery.ApplySort(query, q).
		Offset(discovery.Offset(q.Page, q.Limit)).
		Limit(q.Limit)

	if err := query.Find(&listings).Error; err != nil {
		return nil, 0, err
	}

	entities := make([]domain.ListingEntity, len(listings))
	for i, l := range listings {
		entities[i] = listingModelToEntity(l)
	}

	return entities, total, nil
}

func (r *marketplaceRepository) GetListingByID(ctx context.Context, id uuid.UUID) (*domain.ListingEntity, error) {
	var l models.ProxyListing
	if err := GetReadDB().WithContext(ctx).First(&l, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.ErrListingNotFound
		}
		return nil, err
	}

	return &domain.ListingEntity{
		ID:                   l.ID,
		SellerID:             l.SellerID,
		ProviderNodeID:       l.ProviderNodeID,
		ListingOfferHash:     l.ListingOfferHash,
		ListingOfferSignature: l.ListingOfferSignature,
		ListingOfferSigner:   l.ListingOfferSigner,
		ListingOfferSignedAt: l.ListingOfferSignedAt,
		ListingOfferVerified: l.ListingOfferVerified,
		ListingOfferVerificationError: l.ListingOfferVerificationError,
		ListingOfferNonce:    l.ListingOfferNonce,
		Title:                l.Title,
		Description:          l.Description,
		PricePerGB:           l.PricePerGB,
		MinPurchaseGB:        l.MinPurchaseGB,
		AvailableBandwidthGB: l.AvailableBandwidthGB,
		MaxConcurrency:       l.MaxConcurrency,
		ProxyType:            domain.ProxyType(l.ProxyType),
		Protocol:             l.Protocol,
		RotationType:         l.RotationType,
		Country:              l.Country,
		ISP:                  l.ISP,
		Status:               domain.ListingStatus(l.Status),
		QualityScore:         l.QualityScore,
		AvgLatencyMs:         l.AvgLatencyMs,
		UptimePercent:        l.UptimePercent,
		SuccessRate:          l.SuccessRate,
		CurrentTier:          l.CurrentTier,
		ViewsCount:           l.ViewsCount,
		SavesCount:           l.SavesCount,
		OrdersCount:          l.OrdersCount,
		ActiveSessionsCount:  l.ActiveSessionsCount,
		AllowDirectMessage:   l.AllowDirectMessage,
		CreatedAt:            l.CreatedAt,
		UpdatedAt:            l.UpdatedAt,
	}, nil
}

func (r *marketplaceRepository) CreateListing(ctx context.Context, entity *domain.ListingEntity) error {
	m := models.ProxyListing{
		ID:                   entity.ID,
		SellerID:             entity.SellerID,
		ProviderNodeID:       entity.ProviderNodeID,
		ListingOfferHash:     entity.ListingOfferHash,
		ListingOfferSignature: entity.ListingOfferSignature,
		ListingOfferSigner:   entity.ListingOfferSigner,
		ListingOfferSignedAt: entity.ListingOfferSignedAt,
		ListingOfferVerified: entity.ListingOfferVerified,
		ListingOfferVerificationError: entity.ListingOfferVerificationError,
		ListingOfferNonce:    entity.ListingOfferNonce,
		Title:                entity.Title,
		Description:          entity.Description,
		PricePerGB:           entity.PricePerGB,
		MinPurchaseGB:        entity.MinPurchaseGB,
		AvailableBandwidthGB: entity.AvailableBandwidthGB,
		MaxConcurrency:       entity.MaxConcurrency,
		ProxyType:            models.ProxyType(entity.ProxyType),
		Protocol:             entity.Protocol,
		RotationType:         entity.RotationType,
		Country:              entity.Country,
		ISP:                  entity.ISP,
		Status:               models.ListingStatus(entity.Status),
	}
	return DB.Create(&m).Error
}

func (r *marketplaceRepository) UpdateListing(ctx context.Context, id uuid.UUID, updates domain.ListingUpdate) (*domain.ListingEntity, error) {
	values := make(map[string]interface{})
	if updates.Title != nil {
		values["title"] = *updates.Title
	}
	if updates.Description != nil {
		values["description"] = *updates.Description
	}
	if updates.PricePerGB != nil {
		values["price_per_gb"] = *updates.PricePerGB
	}
	if updates.MinPurchaseGB != nil {
		values["min_purchase_gb"] = *updates.MinPurchaseGB
	}
	if updates.AvailableBandwidthGB != nil {
		values["available_bandwidth_gb"] = *updates.AvailableBandwidthGB
	}
	if updates.MaxConcurrency != nil {
		values["max_concurrency"] = *updates.MaxConcurrency
	}
	if updates.Status != nil {
		values["status"] = models.ListingStatus(*updates.Status)
	}
	if updates.BulkDiscountsJSON != nil {
		values["bulk_discounts"] = updates.BulkDiscountsJSON
	}
	if updates.ListingOfferHash != nil {
		values["listing_offer_hash"] = *updates.ListingOfferHash
	}
	if updates.ListingOfferSignature != nil {
		values["listing_offer_signature"] = *updates.ListingOfferSignature
	}
	if updates.ListingOfferSigner != nil {
		values["listing_offer_signer"] = *updates.ListingOfferSigner
	}
	if updates.ListingOfferSignedAt != nil {
		values["listing_offer_signed_at"] = *updates.ListingOfferSignedAt
	}
	if updates.ListingOfferVerified != nil {
		values["listing_offer_verified"] = *updates.ListingOfferVerified
	}
	if updates.ListingOfferVerificationError != nil {
		values["listing_offer_verification_error"] = *updates.ListingOfferVerificationError
	}
	if updates.ListingOfferNonce != nil {
		values["listing_offer_nonce"] = *updates.ListingOfferNonce
	}

	if len(values) > 0 {
		if err := DB.WithContext(ctx).Model(&models.ProxyListing{}).Where("id = ?", id).Updates(values).Error; err != nil {
			return nil, err
		}
	}

	return r.GetListingByID(ctx, id)
}

func (r *marketplaceRepository) DeleteListing(ctx context.Context, id uuid.UUID) error {
	result := DB.WithContext(ctx).
		Model(&models.ProxyListing{}).
		Where("id = ?", id).
		Update("status", models.ListingStatusDeleted)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrListingNotFound
	}
	return nil
}

func (r *marketplaceRepository) SaveListing(ctx context.Context, userID, listingID uuid.UUID) error {
	return DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing models.SavedListing
		if err := tx.Where("user_id = ? AND listing_id = ?", userID, listingID).First(&existing).Error; err == nil {
			return domain.ErrListingAlreadySaved
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		if err := tx.Create(&models.SavedListing{UserID: userID, ListingID: listingID}).Error; err != nil {
			return err
		}
		return tx.Model(&models.ProxyListing{}).
			Where("id = ?", listingID).
			UpdateColumn("saves_count", gorm.Expr("saves_count + 1")).Error
	})
}

func (r *marketplaceRepository) UnsaveListing(ctx context.Context, userID, listingID uuid.UUID) error {
	return DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Where("user_id = ? AND listing_id = ?", userID, listingID).Delete(&models.SavedListing{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return domain.ErrListingNotSaved
		}
		return tx.Model(&models.ProxyListing{}).
			Where("id = ?", listingID).
			UpdateColumn("saves_count", gorm.Expr("GREATEST(saves_count - 1, 0)")).Error
	})
}

func (r *marketplaceRepository) GetNodeByID(ctx context.Context, id uuid.UUID) (*domain.NodeEntity, error) {
	var n models.Node
	if err := GetReadDB().First(&n, "id = ?", id).Error; err != nil {
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

	if err := GetReadDB().Where("node_id = ? AND checked_at > ?", nodeID, cutoff).Find(&checks).Error; err != nil {
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
	if err := GetReadDB().Select("user_id").First(&node, "id = ?", nodeID).Error; err != nil {
		return err
	}

	return DB.Model(&models.ProxyListing{}).
		Where("seller_id = ? AND status = ?", node.ProviderUserID, models.ListingStatusActive).
		Update("quality_score", score).Error
}

func listingModelToEntity(l models.ProxyListing) domain.ListingEntity {
	entity := domain.ListingEntity{
		ID:                   l.ID,
		SellerID:             l.SellerID,
		ProviderNodeID:       l.ProviderNodeID,
		ListingOfferHash:     l.ListingOfferHash,
		ListingOfferSignature: l.ListingOfferSignature,
		ListingOfferSigner:   l.ListingOfferSigner,
		ListingOfferSignedAt: l.ListingOfferSignedAt,
		ListingOfferVerified: l.ListingOfferVerified,
		ListingOfferVerificationError: l.ListingOfferVerificationError,
		ListingOfferNonce:    l.ListingOfferNonce,
		Title:                l.Title,
		Description:          l.Description,
		PricePerGB:           l.PricePerGB,
		MinPurchaseGB:        l.MinPurchaseGB,
		AvailableBandwidthGB: l.AvailableBandwidthGB,
		MaxConcurrency:       l.MaxConcurrency,
		ProxyType:            domain.ProxyType(l.ProxyType),
		Protocol:             l.Protocol,
		RotationType:         l.RotationType,
		Country:              l.Country,
		ISP:                  l.ISP,
		Status:               domain.ListingStatus(l.Status),
		QualityScore:         l.QualityScore,
		AvgLatencyMs:         l.AvgLatencyMs,
		UptimePercent:        l.UptimePercent,
		SuccessRate:          l.SuccessRate,
		CurrentTier:          l.CurrentTier,
		ViewsCount:           l.ViewsCount,
		SavesCount:           l.SavesCount,
		OrdersCount:          l.OrdersCount,
		ActiveSessionsCount:  l.ActiveSessionsCount,
		AllowDirectMessage:   l.AllowDirectMessage,
		CreatedAt:            l.CreatedAt,
		UpdatedAt:            l.UpdatedAt,
	}
	if l.Seller != nil {
		entity.Seller = sellerProfileFromUser(l.Seller)
	}
	return entity
}

func stringFilter(filters map[string]interface{}, key string) string {
	value, ok := filters[key]
	if !ok || value == nil {
		return ""
	}
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case uuid.UUID:
		if v == uuid.Nil {
			return ""
		}
		return v.String()
	default:
		return ""
	}
}

func uuidFilter(filters map[string]interface{}, key string) uuid.UUID {
	value := stringFilter(filters, key)
	if value == "" {
		return uuid.Nil
	}
	parsed, err := uuid.Parse(value)
	if err != nil {
		return uuid.Nil
	}
	return parsed
}

func floatFilter(filters map[string]interface{}, key string) (float64, bool) {
	value, ok := filters[key]
	if !ok || value == nil {
		return 0, false
	}
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func intFilter(filters map[string]interface{}, key string, fallback int) int {
	value, ok := filters[key]
	if !ok || value == nil {
		return fallback
	}
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(v))
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func normalizeSortOrder(order string, fallback string) string {
	switch strings.ToLower(strings.TrimSpace(order)) {
	case "asc":
		return "ASC"
	case "desc":
		return "DESC"
	}
	if strings.ToLower(fallback) == "asc" {
		return "ASC"
	}
	return "DESC"
}
