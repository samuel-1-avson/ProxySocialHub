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
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterListingRoutes registers marketplace listing routes
func RegisterListingRoutes(rg *gin.RouterGroup) {
	rg.GET("/listings", getListings)
	rg.GET("/listings/:id", getListing)
	rg.POST("/listings", createListing)
	rg.PATCH("/listings/:id", updateListing)
	rg.DELETE("/listings/:id", deleteListing)
	rg.POST("/listings/:id/save", saveListing)
	rg.DELETE("/listings/:id/save", unsaveListing)
	rg.GET("/listings/saved", getSavedListings)
	rg.GET("/listings/my", getMyListings)
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
	cacheKey := fmt.Sprintf("listings:p:%s:l:%s:pt:%s:pr:%s:min:%s:max:%s:sid:%s:sort:%s",
		c.DefaultQuery("page", "1"),
		c.DefaultQuery("limit", "20"),
		c.Query("proxy_type"),
		c.Query("protocol"),
		c.Query("min_price"),
		c.Query("max_price"),
		c.Query("seller_id"),
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

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	query := db.DB.Model(&models.ProxyListing{}).
		Where("status = ?", models.ListingStatusActive).
		Preload("Seller")

	// Apply filters
	if proxyType := c.Query("proxy_type"); proxyType != "" {
		query = query.Where("proxy_type = ?", proxyType)
	}
	if protocol := c.Query("protocol"); protocol != "" {
		query = query.Where("protocol = ?", protocol)
	}
	if minPrice := c.Query("min_price"); minPrice != "" {
		query = query.Where("price_per_gb >= ?", minPrice)
	}
	if maxPrice := c.Query("max_price"); maxPrice != "" {
		query = query.Where("price_per_gb <= ?", maxPrice)
	}
	if sellerID := c.Query("seller_id"); sellerID != "" {
		query = query.Where("seller_id = ?", sellerID)
	}
	if country := c.Query("country"); country != "" {
		query = query.Where("country = ?", country)
	}
	if isp := c.Query("isp"); isp != "" {
		query = query.Where("isp ILIKE ?", "%"+isp+"%") // Case-insensitive search
	}
	if rotation := c.Query("rotation_type"); rotation != "" {
		query = query.Where("rotation_type = ?", rotation)
	}

	// Sorting
	switch c.Query("sort_by") {
	case "price_asc":
		query = query.Order("price_per_gb ASC")
	case "price_desc":
		query = query.Order("price_per_gb DESC")
	case "popular":
		query = query.Order("orders_count DESC")
	case "newest":
		query = query.Order("created_at DESC")
	default:
		query = query.Order("created_at DESC")
	}

	var total int64
	db.DB.Model(&models.ProxyListing{}).Where("status = ?", models.ListingStatusActive).Count(&total)

	var listings []models.ProxyListing
	if err := query.Offset(offset).Limit(limit).Find(&listings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch listings"})
		return
	}

	response := ListingsResponse{
		Listings: listings,
		Total:    total,
		Page:     page,
		Limit:    limit,
	}

	// Cache result (60 seconds)
	cache.Set(cacheKey, response, 60*time.Second)

	c.JSON(http.StatusOK, response)
}

// getListing returns a single listing by ID
func getListing(c *gin.Context) {
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

	// Check if user is a provider
	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	if user.Role != "provider" && user.Role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only providers can create listings"})
		return
	}

	var req models.CreateListingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Manual normalization and validation
	req.Protocol = strings.ToUpper(req.Protocol)
	if req.Protocol != "HTTP" && req.Protocol != "HTTPS" && req.Protocol != "SOCKS5" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid protocol"})
		return
	}
	if req.ProxyType != "residential" && req.ProxyType != "mobile" && req.ProxyType != "datacenter" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid proxy type"})
		return
	}

	// Set provider_since if not already set
	if user.ProviderSince == nil {
		now := time.Now()
		db.DB.Model(&user).Update("provider_since", now)
	}

	// Marshal bulk discounts
	discountsJSON, _ := json.Marshal(req.BulkDiscounts)

	listing := models.ProxyListing{
		SellerID:             userID,
		Title:                req.Title,
		Description:          req.Description,
		ProxyType:            req.ProxyType,
		Protocol:             req.Protocol,
		RotationType:         req.RotationType,
		Country:              req.Country,
		ISP:                  req.ISP,
		PricePerGB:           req.PricePerGB,
		MinPurchaseGB:        req.MinPurchaseGB,
		BulkDiscounts:        discountsJSON,
		AvailableBandwidthGB: req.AvailableBandwidthGB,
		MaxConcurrency:       req.MaxConcurrency,
		Status:               models.ListingStatusActive,
	}

	if listing.MinPurchaseGB == 0 {
		listing.MinPurchaseGB = 1
	}
	if listing.MaxConcurrency == 0 {
		listing.MaxConcurrency = 5
	}

	tx := db.DB.Begin()

	if err := tx.Create(&listing).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create listing"})
		return
	}

	// Create feed event
	feedEvent := models.FeedEvent{
		ActorID:    &userID,
		EventType:  models.FeedEventNewListing,
		TargetType: "listing",
		TargetID:   &listing.ID,
		Content:    listing.Title,
	}
	tx.Create(&feedEvent)

	tx.Commit()

	// Reload with seller
	db.DB.Preload("Seller").First(&listing, "id = ?", listing.ID)

	c.JSON(http.StatusCreated, listing)
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
