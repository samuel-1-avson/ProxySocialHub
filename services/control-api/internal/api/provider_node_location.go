package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/geo"
	"github.com/proxyhubb/control-api/internal/models"
)

type setNodeLocationRequest struct {
	Country string `json:"country" binding:"required"`
	City    string `json:"city" binding:"required"`
}

// resolveNodeCity maps a picked city to its canonical map name: a regional hub
// (aliases like "central region" → Cape Coast) or a known city centroid.
func resolveNodeCity(country, city string) (string, bool) {
	if hub, _, _, ok := geo.ApplyRegionalHubCoords(country, city, "", 0, 0); ok {
		return hub, true
	}
	if _, _, ok := geo.CityCentroid(city, country); ok {
		return strings.TrimSpace(city), true
	}
	return "", false
}

// setNodeLocation lets the owner pick the node's city. Only the city is stored;
// the map pins the city centre. The choice is sticky: gateway IP geo no longer
// overwrites country/city/region (see upsertProviderNodeFromGateway).
// PUT /v1/provider/nodes/:id/location
func setNodeLocation(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node ID"})
		return
	}

	var req setNodeLocationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "country and city are required"})
		return
	}
	country := geo.NormalizeCountryCode(req.Country)
	if len(country) != 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown country"})
		return
	}
	city, ok := resolveNodeCity(country, req.City)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown city for this country"})
		return
	}

	var node models.ProviderNode
	if err := db.DB.Where("id = ? AND user_id = ?", nodeID, userID).First(&node).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
		return
	}

	updates := map[string]interface{}{
		"country":           country,
		"city":              city,
		"region":            "", // an old IP-derived region must not compete with the chosen city
		"location_user_set": true,
	}
	if err := db.DB.Model(&node).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save location"})
		return
	}
	node.Country, node.City, node.Region, node.LocationUserSet = country, city, "", true
	invalidateMarketplaceReadModels()
	scheduleNodeGeoEnrich(nodeID.String())

	c.JSON(http.StatusOK, node)
}
