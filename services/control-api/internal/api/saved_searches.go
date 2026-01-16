package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterSavedSearchRoutes registers saved search routes
func RegisterSavedSearchRoutes(rg *gin.RouterGroup) {
	rg.GET("/saved-searches", getMySavedSearches)
	rg.POST("/saved-searches", createSavedSearch)
	rg.PUT("/saved-searches/:id", updateSavedSearch)
	rg.DELETE("/saved-searches/:id", deleteSavedSearch)
}

// getMySavedSearches returns user's saved searches
func getMySavedSearches(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var searches []models.SavedSearch
	db.DB.Where("user_id = ?", userID).Order("created_at DESC").Find(&searches)

	c.JSON(http.StatusOK, gin.H{"saved_searches": searches})
}

type CreateSavedSearchRequest struct {
	Name          string               `json:"name" binding:"required"`
	Filters       models.SearchFilters `json:"filters" binding:"required"`
	NotifyOnMatch bool                 `json:"notify_on_match"`
}

// createSavedSearch creates a new saved search
func createSavedSearch(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var req CreateSavedSearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	search := models.SavedSearch{
		UserID:        userID,
		Name:          req.Name,
		Filters:       req.Filters,
		NotifyOnMatch: req.NotifyOnMatch,
	}

	if err := db.DB.Create(&search).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create saved search"})
		return
	}

	c.JSON(http.StatusCreated, search)
}

// updateSavedSearch updates a saved search
func updateSavedSearch(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	searchID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid search ID"})
		return
	}

	var search models.SavedSearch
	if err := db.DB.Where("id = ? AND user_id = ?", searchID, userID).First(&search).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Saved search not found"})
		return
	}

	var req CreateSavedSearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	db.DB.Model(&search).Updates(map[string]interface{}{
		"name":            req.Name,
		"filters":         req.Filters,
		"notify_on_match": req.NotifyOnMatch,
	})

	c.JSON(http.StatusOK, search)
}

// deleteSavedSearch deletes a saved search
func deleteSavedSearch(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	searchID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid search ID"})
		return
	}

	result := db.DB.Where("id = ? AND user_id = ?", searchID, userID).Delete(&models.SavedSearch{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Saved search not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Saved search deleted"})
}

// CheckSavedSearchMatches checks if new listings match saved searches
func CheckSavedSearchMatches(listing *models.ProxyListing) {
	var searches []models.SavedSearch
	db.DB.Where("notify_on_match = ?", true).Find(&searches)

	for _, search := range searches {
		if matchesFilters(listing, search.Filters) {
			// Notify user
			BroadcastToUser(search.UserID.String(), MsgTypeNotification, gin.H{
				"type":         "saved_search_match",
				"search_name":  search.Name,
				"listing_id":   listing.ID,
				"listing_name": listing.Title,
				"message":      "New listing matches your saved search: " + search.Name,
			})
		}
	}
}

func matchesFilters(listing *models.ProxyListing, filters models.SearchFilters) bool {
	if filters.MinPrice != nil && listing.PricePerGB < *filters.MinPrice {
		return false
	}
	if filters.MaxPrice != nil && listing.PricePerGB > *filters.MaxPrice {
		return false
	}
	if filters.ProxyType != "" && string(listing.ProxyType) != filters.ProxyType {
		return false
	}
	return true
}
