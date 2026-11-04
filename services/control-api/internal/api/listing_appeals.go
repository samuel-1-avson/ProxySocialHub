package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/audit"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/decentralization"
	"github.com/proxyhubb/control-api/internal/models"
)

type appealListingRequest struct {
	Reason   string `json:"reason" binding:"required,min=8,max=4000"`
	Evidence string `json:"evidence" binding:"max=8000"`
}

type resolveAppealRequest struct {
	Decision string `json:"decision" binding:"required,oneof=uphold deny"`
	Notes    string `json:"notes" binding:"max=4000"`
}

// RegisterListingAppealRoutes wires seller appeal endpoints (protected JWT group).
func RegisterListingAppealRoutes(rg *gin.RouterGroup) {
	rg.POST("/listings/:id/appeal", createListingAppeal)
	rg.GET("/listings/:id/appeals", listListingAppealsForSeller)
	rg.GET("/appeals/mine", listMyListingAppeals)
}

// RegisterModerationAppealRoutes wires moderator appeal queue + resolve.
func RegisterModerationAppealRoutes(rg *gin.RouterGroup) {
	rg.GET("/appeals", listOpenListingAppeals)
	rg.POST("/appeals/:id/resolve", resolveListingAppeal)
}

func createListingAppeal(c *gin.Context) {
	sellerID, err := parseUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}
	var body appealListingRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var listing models.ProxyListing
	if err := db.DB.Select("id", "seller_id", "status", "listing_offer_hash", "title").
		First(&listing, "id = ?", listingID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
		return
	}
	if listing.SellerID != sellerID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the listing seller may appeal"})
		return
	}
	if listing.Status != models.ListingStatusDelisted {
		c.JSON(http.StatusConflict, gin.H{
			"error":  "Only delisted listings can be appealed",
			"status": listing.Status,
		})
		return
	}
	if err := models.ValidateListingStatusTransition(listing.Status, models.ListingStatusUnderAppeal); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	var openCount int64
	_ = db.DB.Model(&models.ListingModerationAppeal{}).
		Where("listing_id = ? AND status = ?", listingID, models.ListingAppealOpen).
		Count(&openCount).Error
	if openCount > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "An open appeal already exists for this listing"})
		return
	}

	now := time.Now().UTC()
	appeal := models.ListingModerationAppeal{
		ListingID:        listingID,
		SellerID:         sellerID,
		Status:           models.ListingAppealOpen,
		Reason:           strings.TrimSpace(body.Reason),
		Evidence:         strings.TrimSpace(body.Evidence),
		ListingOfferHash: listing.ListingOfferHash,
		AppealDeadlineAt: now.Add(time.Duration(decentralization.ListingAppealDays()) * 24 * time.Hour),
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	tx := db.DB.Begin()
	if err := tx.Create(&appeal).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create appeal"})
		return
	}
	if err := tx.Model(&listing).Update("status", models.ListingStatusUnderAppeal).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to mark listing under appeal"})
		return
	}
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to commit appeal"})
		return
	}

	invalidateMarketplaceReadModels()
	audit.Log(c, models.AuditListingAppealOpened, "listing", listingID.String(),
		"Seller opened moderation appeal", map[string]interface{}{
			"appeal_id": appeal.ID.String(),
		})

	c.JSON(http.StatusCreated, gin.H{
		"message":        "Appeal opened",
		"appeal":         appeal,
		"listing_status": models.ListingStatusUnderAppeal,
	})
}

func listListingAppealsForSeller(c *gin.Context) {
	sellerID, err := parseUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	listingID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}
	var listing models.ProxyListing
	if err := db.DB.Select("id", "seller_id").First(&listing, "id = ?", listingID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
		return
	}
	if listing.SellerID != sellerID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}
	var appeals []models.ListingModerationAppeal
	if err := db.DB.Where("listing_id = ?", listingID).Order("created_at DESC").Find(&appeals).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load appeals"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"appeals": appeals, "total": len(appeals)})
}

func listMyListingAppeals(c *gin.Context) {
	sellerID, err := parseUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var appeals []models.ListingModerationAppeal
	if err := db.DB.Where("seller_id = ?", sellerID).Order("created_at DESC").Limit(100).Find(&appeals).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load appeals"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"appeals": appeals, "total": len(appeals)})
}

func listOpenListingAppeals(c *gin.Context) {
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
	_ = db.DB.Model(&models.ListingModerationAppeal{}).
		Where("status = ?", models.ListingAppealOpen).
		Count(&total).Error
	var appeals []models.ListingModerationAppeal
	if err := db.DB.Where("status = ?", models.ListingAppealOpen).
		Order("created_at ASC").Offset(offset).Limit(limit).Find(&appeals).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load appeals"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"appeals": appeals, "total": total, "page": page, "limit": limit})
}

func resolveListingAppeal(c *gin.Context) {
	moderatorID, err := parseUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	appealID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid appeal ID"})
		return
	}
	var body resolveAppealRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if body.Decision == "deny" && decentralization.FullModeEnabled() && !decentralization.AllowAdminDisputeForceResolve() {
		// Under full decentralization, deny still allowed for moderators via this
		// dedicated appeal resolve path (not silent delete). Force-delete without
		// appeal remains gated separately.
	}

	var appeal models.ListingModerationAppeal
	if err := db.DB.First(&appeal, "id = ?", appealID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Appeal not found"})
		return
	}
	if appeal.Status != models.ListingAppealOpen {
		c.JSON(http.StatusConflict, gin.H{"error": "Appeal is not open", "status": appeal.Status})
		return
	}

	var listing models.ProxyListing
	if err := db.DB.First(&listing, "id = ?", appeal.ListingID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
		return
	}

	now := time.Now().UTC()
	nextListing := models.ListingStatusActive
	appealStatus := models.ListingAppealUpheld
	auditType := models.AuditListingAppealUpheld
	if body.Decision == "deny" {
		nextListing = models.ListingStatusDeleted
		appealStatus = models.ListingAppealDenied
		auditType = models.AuditListingAppealDenied
	}
	if err := models.ValidateListingStatusTransition(listing.Status, nextListing); err != nil {
		// under_appeal → active|deleted is valid; if listing drifted, fail closed
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "listing_status": listing.Status})
		return
	}

	if nextListing == models.ListingStatusActive {
		if err := db.ValidateAcceptedListingQuality(db.DB, listing); err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
	}
	tx := db.DB.Begin()
	updates := map[string]interface{}{
		"status":           appealStatus,
		"resolution":       body.Decision,
		"resolution_notes": strings.TrimSpace(body.Notes),
		"resolved_by":      moderatorID,
		"resolved_at":      now,
		"updated_at":       now,
	}
	if err := tx.Model(&appeal).Updates(updates).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to resolve appeal"})
		return
	}
	if err := tx.Model(&listing).Update("status", nextListing).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update listing status"})
		return
	}
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to commit resolution"})
		return
	}

	invalidateMarketplaceReadModels()
	appeal.Status = appealStatus
	appeal.Resolution = body.Decision
	appeal.ResolutionNotes = strings.TrimSpace(body.Notes)
	appeal.ResolvedBy = &moderatorID
	appeal.ResolvedAt = &now
	listing.Status = nextListing

	audit.Log(c, auditType, "listing", listing.ID.String(),
		"Moderation appeal resolved", map[string]interface{}{
			"appeal_id": appeal.ID.String(),
			"decision":  body.Decision,
		})

	c.JSON(http.StatusOK, gin.H{
		"message":        "Appeal resolved",
		"appeal":         appeal,
		"listing_status": nextListing,
	})
}
