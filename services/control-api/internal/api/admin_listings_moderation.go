package api

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/audit"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/marketplace/moderation"
	"github.com/proxyhubb/control-api/internal/middleware"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterAdminListingModerationRoutes registers listing moderation for admin JWT sessions.
func RegisterAdminListingModerationRoutes(rg *gin.RouterGroup) {
	listings := rg.Group("/listings")
	{
		listings.GET("/pending", getPendingListingsForModeration)
		listings.POST("/:id/approve", approvePendingListing)
		listings.POST("/:id/reject", rejectPendingListing)
	}
}

// RegisterPlatformListingModerationRoutes registers the same handlers for dashboard users (Supabase JWT).
func RegisterPlatformListingModerationRoutes(rg *gin.RouterGroup) {
	mod := rg.Group("/moderation")
	mod.Use(middleware.RequirePlatformModerator())
	{
		mod.GET("/listings/pending", getPendingListingsForModeration)
		mod.POST("/listings/:id/approve", approvePendingListing)
		mod.POST("/listings/:id/reject", rejectPendingListing)
	}
	RegisterPlatformForumModerationRoutes(rg)
}

type pendingListingsResponse struct {
	Listings []models.ProxyListing `json:"listings"`
	Total    int64                 `json:"total"`
	Page     int                   `json:"page"`
	Limit    int                   `json:"limit"`
}

func getPendingListingsForModeration(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	var total int64
	if err := db.DB.Model(&models.ProxyListing{}).
		Where("status = ?", models.ListingStatusPendingReview).
		Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count pending listings"})
		return
	}

	var listings []models.ProxyListing
	if err := db.DB.Preload("Seller").
		Where("status = ?", models.ListingStatusPendingReview).
		Order("created_at ASC").
		Offset(offset).
		Limit(limit).
		Find(&listings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load pending listings"})
		return
	}

	c.JSON(http.StatusOK, pendingListingsResponse{
		Listings: listings,
		Total:    total,
		Page:     page,
		Limit:    limit,
	})
}

func approvePendingListing(c *gin.Context) {
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
	if listing.Status != models.ListingStatusPendingReview {
		c.JSON(http.StatusConflict, gin.H{"error": "Listing is not pending review"})
		return
	}
	if err := models.ValidateListingStatusTransition(listing.Status, models.ListingStatusActive); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	if err := db.DB.Model(&listing).Update("status", models.ListingStatusActive).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to approve listing"})
		return
	}

	invalidateMarketplaceReadModels()
	listing.Status = models.ListingStatusActive
	audit.Log(c, models.AuditAdminListingApproved, "listing", listingID.String(),
		"Listing approved for marketplace", map[string]interface{}{
			"moderation_enforced": moderation.ListingModerationEnforced(),
		})

	c.JSON(http.StatusOK, gin.H{
		"message": "Listing approved",
		"listing": listing,
	})
}

type rejectListingRequest struct {
	Reason string `json:"reason"`
}

func rejectPendingListing(c *gin.Context) {
	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	var body rejectListingRequest
	_ = c.ShouldBindJSON(&body)

	var listing models.ProxyListing
	if err := db.DB.First(&listing, "id = ?", listingID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
		return
	}
	if listing.Status != models.ListingStatusPendingReview {
		c.JSON(http.StatusConflict, gin.H{"error": "Listing is not pending review"})
		return
	}
	if err := models.ValidateListingStatusTransition(listing.Status, models.ListingStatusDeleted); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	if err := db.DB.Model(&listing).Update("status", models.ListingStatusDeleted).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reject listing"})
		return
	}

	invalidateMarketplaceReadModels()
	listing.Status = models.ListingStatusDeleted
	audit.Log(c, models.AuditAdminListingRejected, "listing", listingID.String(),
		"Listing rejected from moderation queue", map[string]interface{}{
			"reason": body.Reason,
		})

	c.JSON(http.StatusOK, gin.H{
		"message": "Listing rejected",
		"listing": listing,
	})
}
