package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterFavoriteRoutes registers favorite/watchlist routes
func RegisterFavoriteRoutes(rg *gin.RouterGroup) {
	rg.GET("/favorites", getMyFavorites)
	rg.POST("/favorites/:listingId", addFavorite)
	rg.DELETE("/favorites/:listingId", removeFavorite)
	rg.GET("/favorites/:listingId/check", checkFavorite)
}

// getMyFavorites returns user's favorited listings
func getMyFavorites(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var favorites []models.Favorite
	db.DB.Preload("Listing").Preload("Listing.Seller").
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Find(&favorites)

	c.JSON(http.StatusOK, gin.H{"favorites": favorites})
}

// addFavorite adds a listing to favorites
func addFavorite(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	listingID, err := uuid.Parse(c.Param("listingId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	// Check if listing exists
	var listing models.ProxyListing
	if err := db.DB.First(&listing, "id = ?", listingID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Listing not found"})
		return
	}

	// Check if already favorited
	var existing models.Favorite
	if db.DB.Where("user_id = ? AND listing_id = ?", userID, listingID).First(&existing).Error == nil {
		c.JSON(http.StatusOK, gin.H{"message": "Already in favorites"})
		return
	}

	favorite := models.Favorite{
		UserID:    userID,
		ListingID: listingID,
	}

	if err := db.DB.Create(&favorite).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add favorite"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Added to favorites", "favorite": favorite})
}

// removeFavorite removes a listing from favorites
func removeFavorite(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	listingID, err := uuid.Parse(c.Param("listingId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	result := db.DB.Where("user_id = ? AND listing_id = ?", userID, listingID).Delete(&models.Favorite{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Not in favorites"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Removed from favorites"})
}

// checkFavorite checks if listing is favorited
func checkFavorite(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	listingID, err := uuid.Parse(c.Param("listingId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid listing ID"})
		return
	}

	var favorite models.Favorite
	isFavorited := db.DB.Where("user_id = ? AND listing_id = ?", userID, listingID).First(&favorite).Error == nil

	c.JSON(http.StatusOK, gin.H{"is_favorited": isFavorited})
}
