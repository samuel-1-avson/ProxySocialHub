package db

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/core/domain"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

func (r *marketplaceRepository) GetListingDetail(ctx context.Context, id uuid.UUID) (*domain.ListingEntity, *domain.SellerPublicProfile, error) {
	var listing models.ProxyListing
	if err := GetReadDB().WithContext(ctx).Preload("Seller").First(&listing, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, domain.ErrListingNotFound
		}
		return nil, nil, err
	}
	entity := listingModelToEntity(listing)
	var seller *domain.SellerPublicProfile
	if listing.Seller != nil {
		seller = sellerProfileFromUser(listing.Seller)
	}
	return &entity, seller, nil
}

func (r *marketplaceRepository) IncrementListingViews(ctx context.Context, id uuid.UUID) error {
	return DB.WithContext(ctx).
		Model(&models.ProxyListing{}).
		Where("id = ?", id).
		UpdateColumn("views_count", gorm.Expr("views_count + 1")).Error
}

func (r *marketplaceRepository) IsListingSaved(ctx context.Context, userID, listingID uuid.UUID) (bool, error) {
	var saved models.SavedListing
	err := GetReadDB().WithContext(ctx).
		Where("user_id = ? AND listing_id = ?", userID, listingID).
		First(&saved).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (r *marketplaceRepository) SearchListings(ctx context.Context, query string, limit int) ([]domain.ListingEntity, error) {
	if limit <= 0 || limit > 50 {
		limit = 50
	}

	var listings []models.ProxyListing
	ftsErr := GetReadDB().WithContext(ctx).Raw(`
		SELECT proxy_listings.* FROM proxy_listings
		WHERE status = ?
		  AND search_vector @@ plainto_tsquery('english', ?)
		ORDER BY ts_rank(search_vector, plainto_tsquery('english', ?)) DESC,
		         quality_score DESC
		LIMIT ?`,
		models.ListingStatusActive, query, query, limit).
		Scan(&listings).Error

	if ftsErr != nil {
		like := "%" + query + "%"
		if err := GetReadDB().WithContext(ctx).
			Preload("Seller").
			Where("status = ? AND (title ILIKE ? OR description ILIKE ? OR country ILIKE ? OR isp ILIKE ?)",
				models.ListingStatusActive, like, like, like, like).
			Order("quality_score DESC").
			Limit(limit).
			Find(&listings).Error; err != nil {
			return nil, err
		}
	} else if len(listings) > 0 {
		ids := make([]uuid.UUID, len(listings))
		for i, l := range listings {
			ids[i] = l.ID
		}
		listings = nil
		if err := GetReadDB().WithContext(ctx).Preload("Seller").Where("id IN ?", ids).Find(&listings).Error; err != nil {
			return nil, err
		}
	}

	return listingModelsToEntities(listings), nil
}

func (r *marketplaceRepository) GetFeaturedListings(ctx context.Context, limit int) ([]domain.ListingEntity, error) {
	if limit <= 0 || limit > 50 {
		limit = 12
	}
	var listings []models.ProxyListing
	if err := GetReadDB().WithContext(ctx).
		Preload("Seller").
		Where("status = ? AND quality_score > ?", models.ListingStatusActive, 70).
		Order("quality_score DESC, orders_count DESC, created_at DESC").
		Limit(limit).
		Find(&listings).Error; err != nil {
		return nil, err
	}
	return listingModelsToEntities(listings), nil
}

func (r *marketplaceRepository) GetSellerListings(ctx context.Context, sellerID uuid.UUID, page, limit int) ([]domain.ListingEntity, int64, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	var total int64
	base := GetReadDB().WithContext(ctx).Model(&models.ProxyListing{}).
		Where("seller_id = ? AND status != ?", sellerID, models.ListingStatusDeleted)
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var listings []models.ProxyListing
	if err := base.Order("created_at DESC").Offset(offset).Limit(limit).Find(&listings).Error; err != nil {
		return nil, 0, err
	}
	return listingModelsToEntities(listings), total, nil
}

func (r *marketplaceRepository) GetSavedListings(ctx context.Context, userID uuid.UUID, page, limit int) ([]domain.SavedListingEntry, int64, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	var total int64
	if err := GetReadDB().WithContext(ctx).Model(&models.SavedListing{}).Where("user_id = ?", userID).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var saved []models.SavedListing
	if err := GetReadDB().WithContext(ctx).
		Preload("Listing").
		Preload("Listing.Seller").
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Offset(offset).
		Limit(limit).
		Find(&saved).Error; err != nil {
		return nil, 0, err
	}

	entries := make([]domain.SavedListingEntry, 0, len(saved))
	for _, row := range saved {
		if row.Listing == nil {
			continue
		}
		entity := listingModelToEntity(*row.Listing)
		var seller *domain.SellerPublicProfile
		if row.Listing.Seller != nil {
			seller = sellerProfileFromUser(row.Listing.Seller)
		}
		entries = append(entries, domain.SavedListingEntry{
			UserID:    row.UserID,
			ListingID: row.ListingID,
			Listing:   entity,
			Seller:    seller,
			CreatedAt: row.CreatedAt,
		})
	}
	return entries, total, nil
}

func listingModelsToEntities(listings []models.ProxyListing) []domain.ListingEntity {
	out := make([]domain.ListingEntity, len(listings))
	for i, l := range listings {
		out[i] = listingModelToEntity(l)
	}
	return out
}

func sellerProfileFromUser(u *models.User) *domain.SellerPublicProfile {
	if u == nil {
		return nil
	}
	return &domain.SellerPublicProfile{
		ID:          u.ID,
		DisplayName: u.DisplayName,
		Username:    u.Username,
		AvatarURL:   u.AvatarURL,
		TrustTier:   string(u.TrustTier),
		Role:        u.Role,
	}
}
