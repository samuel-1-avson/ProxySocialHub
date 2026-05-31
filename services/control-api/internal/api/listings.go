package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/cache"
	"github.com/proxyhubb/control-api/internal/core/domain"
	"github.com/proxyhubb/control-api/internal/core/services"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/privacy"
)

// RegisterListingRoutes registers marketplace listing routes
func RegisterListingRoutes(rg *gin.RouterGroup) {
	rg.GET("/listings", getListings)
	rg.GET("/listings/featured", getFeaturedListings)
	rg.GET("/listings/search", searchListings)
	rg.GET("/listings/:id", getListing)
	rg.POST("/listings", createListing)
	rg.PATCH("/listings/:id", updateListing)
	rg.DELETE("/listings/:id", deleteListing)
	rg.POST("/listings/:id/save", saveListing)
	rg.DELETE("/listings/:id/save", unsaveListing)
	rg.GET("/saved", getSavedListings)
	rg.GET("/my", getMyListings)
	rg.GET("/suggest-price", suggestPrice)
}

// ListingsResponse is the cached response structure
type ListingsResponse struct {
	Listings []models.ProxyListing `json:"listings"`
	Total    int64                 `json:"total"`
	Page     int                   `json:"page"`
	Limit    int                   `json:"limit"`
}

// getListings returns marketplace listings with filters
func getListings(c *gin.Context) {
	// Try cache first
	cacheKey := fmt.Sprintf("listings:sla:v1:p:%s:l:%s:pt:%s:pr:%s:min:%s:max:%s:sid:%s:c:%s:i:%s:r:%s:sort:%s",
		c.DefaultQuery("page", "1"),
		c.DefaultQuery("limit", "20"),
		c.Query("proxy_type"),
		c.Query("protocol"),
		c.Query("min_price"),
		c.Query("max_price"),
		c.Query("seller_id"),
		c.Query("country"),
		c.Query("isp"),
		c.Query("rotation_type"),
		c.Query("sort_by"),
	)

	var cachedResponse ListingsResponse
	if found, _ := cache.Get(cacheKey, &cachedResponse); found {
		c.JSON(http.StatusOK, cachedResponse)
		return
	}

	// Map query params to filters map
	filters := make(map[string]interface{})
	if pt := c.Query("proxy_type"); pt != "" {
		filters["proxy_type"] = pt
	}
	// ... add other filters as needed by the service implementation ...

	entities, total, err := GetMarketplaceService().BrowseMarket(c.Request.Context(), filters)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to browse marketplace"})
		return
	}

	// Map domain entities back to API response models
	apiListings := make([]models.ProxyListing, len(entities))
	for i, e := range entities {
		listingModel := models.ProxyListing{
			ID:                   e.ID,
			SellerID:             e.SellerID,
			Title:                e.Title,
			Description:          e.Description,
			PricePerGB:           e.PricePerGB,
			AvailableBandwidthGB: e.AvailableBandwidthGB,
			ProxyType:            models.ProxyType(e.ProxyType),
			Protocol:             e.Protocol,
			Country:              e.Country,
			ISP:                  e.ISP,
			Status:               models.ListingStatus(e.Status),
			QualityScore:         e.QualityScore,
			UptimePercent:        e.UptimePercent,
			AvgLatencyMs:         e.AvgLatencyMs,
		}

		// Apply Elastic Pricing adjustment
		listingModel.PricePerGB = CalculateFairPrice(listingModel)

		// Apply ZK-Privacy Obfuscation (Security Audit Sweep)
		sentry := privacy.NewZKMetadataSentry()
		sentry.SanitizeListing(&listingModel)

		apiListings[i] = listingModel
	}

	enrichListingsSLA(apiListings)

	response := ListingsResponse{
		Listings: apiListings,
		Total:    total,
		Page:     getPageParam(c, 1),
		Limit:    getLimitParam(c, 20),
	}

	// Cache result (60 seconds)
	cache.Set(cacheKey, response, 60*time.Second)

	c.JSON(http.StatusOK, response)
}

// getListing returns a single listing by ID
func getListing(c *gin.Context) {
	id := strings.ToLower(strings.TrimSpace(c.Param("id")))
	switch id {
	case "geo":
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "endpoint_not_found",
			"message": "Use GET /v1/listings/geo or GET /v1/marketplace/geo",
		})
		return
	case "featured", "search":
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "endpoint_not_found",
			"message": "Use GET /v1/listings/" + id,
		})
		return
	}

	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	var listing models.ProxyListing
	if err := db.DB.Preload("Seller").First(&listing, "id = ?", listingID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
		return
	}

	enrichListingsSLA([]models.ProxyListing{listing})

	// Increment view count
	db.DB.Model(&listing).Update("views_count", listing.ViewsCount+1)

	// Check if current user has saved this listing
	// Manually check both keys for safety
	var currentUserID interface{}
	exists := false
	if uid, ok := c.Get("user_id"); ok {
		currentUserID = uid
		exists = true
	} else if uidStr := c.GetString("userID"); uidStr != "" {
		currentUserID, _ = uuid.Parse(uidStr)
		exists = true
	}

	isSaved := false
	if exists {
		// Ensure currentUserID is uuid
		var uID uuid.UUID
		if id, ok := currentUserID.(uuid.UUID); ok {
			uID = id
		} else if idStr, ok := currentUserID.(string); ok {
			uID, _ = uuid.Parse(idStr)
		}

		var saved models.SavedListing
		if err := db.DB.Where("user_id = ? AND listing_id = ?", uID, listingID).First(&saved).Error; err == nil {
			isSaved = true
		}
	}

	// Apply ZK-Privacy Obfuscation (Security Audit Sweep)
	sentry := privacy.NewZKMetadataSentry()
	sentry.SanitizeListing(&listing)

	c.JSON(http.StatusOK, gin.H{
		"listing":  listing,
		"is_saved": isSaved,
	})
}

// createListing creates a new proxy listing
func createListing(c *gin.Context) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	var req models.CreateListingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	providerNodeID, err := resolveListingProviderNode(userID, req.ProviderNodeID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	country := req.Country
	isp := req.ISP
	if providerNodeID != nil && (country == "" || isp == "") {
		var pn models.ProviderNode
		if db.DB.Select("country", "city").First(&pn, "id = ?", *providerNodeID).Error == nil {
			if country == "" {
				country = pn.Country
			}
		}
	}

	rotationType := req.RotationType
	if rotationType == "" {
		rotationType = "static"
	}
	maxConcurrency := req.MaxConcurrency
	if maxConcurrency <= 0 {
		maxConcurrency = 5
	}

	entity := domain.ListingEntity{
		ProviderNodeID:       providerNodeID,
		Title:                req.Title,
		Description:          req.Description,
		PricePerGB:           req.PricePerGB,
		MinPurchaseGB:        req.MinPurchaseGB,
		AvailableBandwidthGB: req.AvailableBandwidthGB,
		MaxConcurrency:       maxConcurrency,
		ProxyType:            domain.ProxyType(req.ProxyType),
		Protocol:             req.Protocol,
		RotationType:         rotationType,
		Country:              country,
		ISP:                  isp,
	}

	published, err := GetMarketplaceService().PublishListing(c.Request.Context(), userID, entity)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, published)
}

// resolveListingProviderNode picks or validates the provider_nodes row for a listing.
func resolveListingProviderNode(sellerID uuid.UUID, requested *uuid.UUID) (*uuid.UUID, error) {
	if requested != nil && *requested != uuid.Nil {
		var count int64
		if err := db.DB.Model(&models.ProviderNode{}).
			Where("id = ? AND user_id = ?", *requested, sellerID).
			Count(&count).Error; err != nil {
			return nil, err
		}
		if count == 0 {
			return nil, fmt.Errorf("provider node not found or not owned by you")
		}
		return requested, nil
	}

	var pn models.ProviderNode
	err := db.DB.Where("user_id = ?", sellerID).
		Order("CASE WHEN status = 'online' THEN 0 ELSE 1 END, last_seen_at DESC NULLS LAST, created_at DESC").
		First(&pn).Error
	if err != nil {
		return nil, nil
	}
	return &pn.ID, nil
}

// updateListing updates an existing listing
func updateListing(c *gin.Context) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	var listing models.ProxyListing
	if err := db.DB.First(&listing, "id = ?", listingID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
		return
	}

	// Check ownership
	if listing.SellerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can only update your own listings"})
		return
	}

	var req models.UpdateListingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := make(map[string]interface{})
	if req.Title != nil {
		updates["title"] = *req.Title
	}
	if req.Description != nil {
		updates["description"] = *req.Description
	}
	if req.PricePerGB != nil {
		updates["price_per_gb"] = *req.PricePerGB
	}
	if req.MinPurchaseGB != nil {
		updates["min_purchase_gb"] = *req.MinPurchaseGB
	}
	if req.AvailableBandwidthGB != nil {
		updates["available_bandwidth_gb"] = *req.AvailableBandwidthGB
	}
	if req.MaxConcurrency != nil {
		updates["max_concurrency"] = *req.MaxConcurrency
	}
	if req.Status != nil {
		updates["status"] = *req.Status
	}
	if len(req.BulkDiscounts) > 0 {
		discountsJSON, _ := json.Marshal(req.BulkDiscounts)
		updates["bulk_discounts"] = discountsJSON
	}

	if len(updates) > 0 {
		if err := db.DB.Model(&listing).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update listing"})
			return
		}
	}

	db.DB.Preload("Seller").First(&listing, "id = ?", listingID)
	c.JSON(http.StatusOK, listing)
}

// deleteListing soft-deletes a listing
func deleteListing(c *gin.Context) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	var listing models.ProxyListing
	if err := db.DB.First(&listing, "id = ?", listingID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
		return
	}

	if listing.SellerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can only delete your own listings"})
		return
	}

	db.DB.Model(&listing).Update("status", models.ListingStatusDeleted)
	c.JSON(http.StatusOK, gin.H{"message": "Listing deleted"})
}

// saveListing bookmarks a listing
func saveListing(c *gin.Context) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	// Check listing exists
	var listing models.ProxyListing
	if err := db.DB.First(&listing, "id = ?", listingID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
		return
	}

	// Check if already saved
	var existing models.SavedListing
	if err := db.DB.Where("user_id = ? AND listing_id = ?", userID, listingID).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Listing already saved"})
		return
	}

	saved := models.SavedListing{
		UserID:    userID,
		ListingID: listingID,
	}

	tx := db.DB.Begin()
	if err := tx.Create(&saved).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save listing"})
		return
	}

	// Update saves count
	tx.Model(&listing).Update("saves_count", listing.SavesCount+1)
	tx.Commit()

	c.JSON(http.StatusOK, gin.H{"message": "Listing saved"})
}

// unsaveListing removes a bookmark
func unsaveListing(c *gin.Context) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	var saved models.SavedListing
	if err := db.DB.Where("user_id = ? AND listing_id = ?", userID, listingID).First(&saved).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not saved"})
		return
	}

	tx := db.DB.Begin()
	tx.Delete(&saved)
	tx.Model(&models.ProxyListing{}).Where("id = ?", listingID).Update("saves_count", db.DB.Raw("GREATEST(saves_count - 1, 0)"))
	tx.Commit()

	c.JSON(http.StatusOK, gin.H{"message": "Listing unsaved"})
}

// getSavedListings returns user's saved listings
func getSavedListings(c *gin.Context) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	var saved []models.SavedListing
	var total int64

	db.DB.Model(&models.SavedListing{}).Where("user_id = ?", userID).Count(&total)

	if err := db.DB.Preload("Listing").Preload("Listing.Seller").
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&saved).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch saved listings"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"saved": saved,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

// getMyListings returns the current user's listings
func getMyListings(c *gin.Context) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			} else if idStr, ok := uid.(string); ok {
				userIDStr = idStr
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	var listings []models.ProxyListing
	var total int64

	query := db.DB.Model(&models.ProxyListing{}).Where("seller_id = ? AND status != ?", userID, models.ListingStatusDeleted)
	query.Count(&total)

	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&listings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch listings"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"listings": listings,
		"total":    total,
		"page":     page,
		"limit":    limit,
	})
}

// suggestPrice returns a recommended price based on node attributes
func suggestPrice(c *gin.Context) {
	country := c.Query("country")
	proxyType := c.Query("proxy_type")

	if country == "" || proxyType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "country and proxy_type are required"})
		return
	}

	oracle := services.NewPricingOracle()
	suggestion, err := oracle.SuggestPrice(c.Request.Context(), country, proxyType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate price suggestion"})
		return
	}

	c.JSON(http.StatusOK, suggestion)
}

// getFeaturedListings returns top-ranked active listings (high quality score, priority)
func getFeaturedListings(c *gin.Context) {
	var listings []models.ProxyListing
	if err := db.DB.
		Preload("Seller").
		Where("status = ? AND quality_score > ?", models.ListingStatusActive, 70).
		Order("is_priority DESC, priority_rank ASC, quality_score DESC").
		Limit(12).
		Find(&listings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch featured listings"})
		return
	}

	sentry := privacy.NewZKMetadataSentry()
	for i := range listings {
		sentry.SanitizeListing(&listings[i])
	}

	c.JSON(http.StatusOK, gin.H{"listings": listings, "total": len(listings)})
}

// searchListings searches listings using PostgreSQL full-text search (E4).
// Falls back to ILIKE if the search_vector column does not yet exist (pre-migration).
func searchListings(c *gin.Context) {
	q := c.Query("q")
	if q == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "query parameter 'q' is required"})
		return
	}

	var listings []models.ProxyListing

	// Try FTS first (requires migration 000036_listing_fulltext_search to have been applied).
	// Uses plainto_tsquery which safely tokenises user input — no injection risk.
	// Routes to read replica when available (GetReadDB falls back to primary if not configured).
	ftsErr := db.GetReadDB().Raw(`
		SELECT proxy_listings.* FROM proxy_listings
		WHERE status = ?
		  AND search_vector @@ plainto_tsquery('english', ?)
		ORDER BY ts_rank(search_vector, plainto_tsquery('english', ?)) DESC,
		         quality_score DESC
		LIMIT 50`,
		models.ListingStatusActive, q, q).
		Scan(&listings).Error

	if ftsErr != nil {
		// Graceful fallback: search_vector column not yet present — use ILIKE.
		like := "%" + q + "%"
		if err := db.DB.
			Preload("Seller").
			Where("status = ? AND (title ILIKE ? OR description ILIKE ? OR country ILIKE ? OR isp ILIKE ?)",
				models.ListingStatusActive, like, like, like, like).
			Order("quality_score DESC").
			Limit(50).
			Find(&listings).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to search listings"})
			return
		}
	} else if len(listings) > 0 {
		// Raw scan does not preload associations — re-fetch with Seller preloaded.
		ids := make([]string, len(listings))
		for i, l := range listings {
			ids[i] = l.ID.String()
		}
		db.DB.Preload("Seller").Where("id IN ?", ids).Find(&listings)
	}

	sentry := privacy.NewZKMetadataSentry()
	for i := range listings {
		sentry.SanitizeListing(&listings[i])
	}

	c.JSON(http.StatusOK, gin.H{"listings": listings, "total": len(listings)})
}
