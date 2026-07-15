package catalog

import (
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// ListSellerProducts returns paginated products for a seller with offers preloaded.
func ListSellerProducts(sellerID uuid.UUID, page, limit int) ([]models.CatalogProduct, int64, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	var total int64
	if err := db.DB.Model(&models.CatalogProduct{}).Where("seller_id = ?", sellerID).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var products []models.CatalogProduct
	err := db.DB.Preload("Offers", func(tx *gorm.DB) *gorm.DB {
		return tx.Order("sort_order ASC, created_at ASC")
	}).
		Where("seller_id = ?", sellerID).
		Order("updated_at DESC").
		Offset(offset).
		Limit(limit).
		Find(&products).Error
	return products, total, err
}

// GetProductByID loads a product; draft/archived hidden from public viewers.
func GetProductByID(productID uuid.UUID, viewerSellerID *uuid.UUID) (*models.CatalogProductView, error) {
	var product models.CatalogProduct
	if err := db.DB.Where("id = ?", productID).First(&product).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrProductNotFound
		}
		return nil, err
	}
	if !canViewProduct(product, viewerSellerID) {
		return nil, ErrProductNotFound
	}
	return productView(&product)
}

// GetProductBySellerSlug resolves an active product by seller + slug.
func GetProductBySellerSlug(sellerID uuid.UUID, slug string) (*models.CatalogProductView, error) {
	slug = NormalizeSlug(slug)
	if slug == "" {
		return nil, ErrProductNotFound
	}
	var product models.CatalogProduct
	err := db.DB.Where("seller_id = ? AND slug = ?", sellerID, slug).First(&product).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrProductNotFound
		}
		return nil, err
	}
	if product.Status != models.CatalogProductStatusActive {
		return nil, ErrProductNotFound
	}
	return productView(&product)
}

func canViewProduct(p models.CatalogProduct, viewerSellerID *uuid.UUID) bool {
	if p.Status == models.CatalogProductStatusActive {
		return true
	}
	if viewerSellerID != nil && *viewerSellerID == p.SellerID {
		return true
	}
	return false
}

func productView(product *models.CatalogProduct) (*models.CatalogProductView, error) {
	var offers []models.CatalogOffer
	if err := db.DB.Where("product_id = ?", product.ID).
		Order("sort_order ASC, created_at ASC").
		Find(&offers).Error; err != nil {
		return nil, err
	}
	views := make([]models.CatalogOfferView, len(offers))
	for i, o := range offers {
		views[i] = models.CatalogOfferView{CatalogOffer: o}
	}
	return &models.CatalogProductView{
		Product: *product,
		Offers:  views,
	}, nil
}

// CreateProduct inserts a new catalog product for the seller.
func CreateProduct(sellerID uuid.UUID, req models.CreateCatalogProductRequest) (*models.CatalogProduct, error) {
	status := req.Status
	if status == "" {
		status = models.CatalogProductStatusDraft
	}
	if !validProductStatus(status) {
		return nil, ErrInvalidStatus
	}

	id := uuid.New()
	slug := NormalizeSlug(req.Slug)
	if slug == "" {
		slug = Slugify(req.Title, id)
	}
	if err := assertSlugAvailable(sellerID, slug, uuid.Nil); err != nil {
		return nil, err
	}

	media := datatypes.JSON([]byte("[]"))
	if len(req.Media) > 0 {
		media = datatypes.JSON(req.Media)
	}

	product := models.CatalogProduct{
		ID:          id,
		SellerID:    sellerID,
		Slug:        slug,
		Title:       strings.TrimSpace(req.Title),
		Description: req.Description,
		Media:       media,
		Status:      status,
	}
	if err := db.DB.Create(&product).Error; err != nil {
		return nil, err
	}
	return &product, nil
}

// UpdateProduct updates seller-owned product fields.
func UpdateProduct(sellerID, productID uuid.UUID, req models.UpdateCatalogProductRequest) (*models.CatalogProduct, error) {
	var product models.CatalogProduct
	if err := db.DB.Where("id = ? AND seller_id = ?", productID, sellerID).First(&product).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrProductNotFound
		}
		return nil, err
	}

	updates := map[string]interface{}{}
	if req.Title != nil {
		updates["title"] = strings.TrimSpace(*req.Title)
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.Slug != nil {
		slug := NormalizeSlug(*req.Slug)
		if slug == "" {
			return nil, fmt.Errorf("slug cannot be empty")
		}
		if err := assertSlugAvailable(sellerID, slug, product.ID); err != nil {
			return nil, err
		}
		updates["slug"] = slug
	}
	if req.Media != nil {
		updates["media"] = datatypes.JSON(req.Media)
	}
	if req.Status != nil {
		if !validProductStatus(*req.Status) {
			return nil, ErrInvalidStatus
		}
		updates["status"] = *req.Status
	}
	if len(updates) == 0 {
		return &product, nil
	}

	if err := db.DB.Model(&product).Updates(updates).Error; err != nil {
		return nil, err
	}
	if err := db.DB.First(&product, "id = ?", product.ID).Error; err != nil {
		return nil, err
	}
	return &product, nil
}

// LinkOffer attaches a seller listing to a product.
func LinkOffer(sellerID, productID uuid.UUID, req models.LinkCatalogOfferRequest) (*models.CatalogOffer, error) {
	var product models.CatalogProduct
	if err := db.DB.Where("id = ? AND seller_id = ?", productID, sellerID).First(&product).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrProductNotFound
		}
		return nil, err
	}

	var listing models.ProxyListing
	if err := db.DB.Where("id = ? AND seller_id = ?", req.ListingID, sellerID).First(&listing).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrListingNotOwned
		}
		return nil, err
	}
	if listing.Status == models.ListingStatusDeleted {
		return nil, ErrListingDeleted
	}

	var existing models.CatalogOffer
	if err := db.DB.Where("listing_id = ?", req.ListingID).First(&existing).Error; err == nil {
		if existing.ProductID != productID {
			return nil, ErrListingLinked
		}
		return &existing, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	isPrimary := true
	if req.IsPrimary != nil {
		isPrimary = *req.IsPrimary
	}
	sortOrder := 0
	if req.SortOrder != nil {
		sortOrder = *req.SortOrder
	}

	var offer models.CatalogOffer
	err := db.DB.Transaction(func(tx *gorm.DB) error {
		if isPrimary {
			if err := tx.Model(&models.CatalogOffer{}).
				Where("product_id = ? AND is_primary = TRUE", productID).
				Update("is_primary", false).Error; err != nil {
				return err
			}
		} else {
			var primaryCount int64
			if err := tx.Model(&models.CatalogOffer{}).
				Where("product_id = ? AND is_primary = TRUE", productID).
				Count(&primaryCount).Error; err != nil {
				return err
			}
			if primaryCount == 0 {
				isPrimary = true
			}
		}

		offer = models.CatalogOffer{
			ProductID:   productID,
			ListingID:   req.ListingID,
			SKU:         req.SKU,
			DisplayName: req.DisplayName,
			IsPrimary:   isPrimary,
			SortOrder:   sortOrder,
		}
		return tx.Create(&offer).Error
	})
	if err != nil {
		return nil, err
	}
	return &offer, nil
}

// UnlinkOffer removes an offer row; listing is unchanged.
func UnlinkOffer(sellerID, productID, offerID uuid.UUID) error {
	var product models.CatalogProduct
	if err := db.DB.Where("id = ? AND seller_id = ?", productID, sellerID).First(&product).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrProductNotFound
		}
		return err
	}
	res := db.DB.Where("id = ? AND product_id = ?", offerID, productID).Delete(&models.CatalogOffer{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrOfferNotFound
	}
	return nil
}

func assertSlugAvailable(sellerID uuid.UUID, slug string, excludeProductID uuid.UUID) error {
	q := db.DB.Model(&models.CatalogProduct{}).Where("seller_id = ? AND slug = ?", sellerID, slug)
	if excludeProductID != uuid.Nil {
		q = q.Where("id <> ?", excludeProductID)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrSlugTaken
	}
	return nil
}

func validProductStatus(s models.CatalogProductStatus) bool {
	switch s {
	case models.CatalogProductStatusDraft, models.CatalogProductStatusActive, models.CatalogProductStatusArchived:
		return true
	default:
		return false
	}
}
