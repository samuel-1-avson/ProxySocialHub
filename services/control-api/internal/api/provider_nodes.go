package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterProviderNodeRoutes registers provider node management routes
func RegisterProviderNodeRoutes(rg *gin.RouterGroup) {
	rg.GET("/provider/nodes", getMyNodes)
	rg.POST("/provider/nodes", createNode)
	rg.PUT("/provider/nodes/:id", updateNode)
	rg.DELETE("/provider/nodes/:id", deleteNode)
	rg.GET("/provider/nodes/:id/uptime", getNodeUptime)
}

// getMyNodes returns user's provider nodes
func getMyNodes(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var nodes []models.ProviderNode
	db.DB.Where("user_id = ?", userID).Order("created_at DESC").Find(&nodes)

	c.JSON(http.StatusOK, gin.H{"nodes": nodes})
}

type CreateNodeRequest struct {
	Name      string `json:"name" binding:"required"`
	IPAddress string `json:"ip_address"`
	Country   string `json:"country"`
	City      string `json:"city"`
}

// createNode creates a new provider node
func createNode(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var req CreateNodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	node := models.ProviderNode{
		UserID:    userID,
		Name:      req.Name,
		IPAddress: req.IPAddress,
		Country:   req.Country,
		City:      req.City,
		Status:    models.NodeOffline,
	}

	if err := db.DB.Create(&node).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create node"})
		return
	}

	c.JSON(http.StatusCreated, node)
}

// updateNode updates a provider node
func updateNode(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node ID"})
		return
	}

	var node models.ProviderNode
	if err := db.DB.Where("id = ? AND user_id = ?", nodeID, userID).First(&node).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
		return
	}

	var req CreateNodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	db.DB.Model(&node).Updates(map[string]interface{}{
		"name":       req.Name,
		"ip_address": req.IPAddress,
		"country":    req.Country,
		"city":       req.City,
	})

	c.JSON(http.StatusOK, node)
}

// deleteNode deletes a provider node
func deleteNode(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node ID"})
		return
	}

	result := db.DB.Where("id = ? AND user_id = ?", nodeID, userID).Delete(&models.ProviderNode{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Node deleted"})
}

// getNodeUptime returns uptime statistics for a node
func getNodeUptime(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	nodeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node ID"})
		return
	}

	// Verify ownership
	var node models.ProviderNode
	if err := db.DB.Where("id = ? AND user_id = ?", nodeID, userID).First(&node).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
		return
	}

	// Get uptime stats (last 24 hours)
	since := time.Now().Add(-24 * time.Hour)
	var checks []models.UptimeCheck
	db.DB.Where("node_id = ? AND checked_at > ?", nodeID, since).Order("checked_at DESC").Find(&checks)

	var totalChecks, upChecks int
	var avgLatency float64
	for _, check := range checks {
		totalChecks++
		if check.IsUp {
			upChecks++
			avgLatency += float64(check.LatencyMs)
		}
	}

	uptimePercent := float64(0)
	if totalChecks > 0 {
		uptimePercent = (float64(upChecks) / float64(totalChecks)) * 100
		if upChecks > 0 {
			avgLatency = avgLatency / float64(upChecks)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"node_id":        nodeID,
		"uptime_percent": uptimePercent,
		"avg_latency_ms": avgLatency,
		"checks_24h":     totalChecks,
		"current_status": node.Status,
		"last_seen":      node.LastSeenAt,
	})
}

// UpdateNodeStatus updates a node's online status (called by gateway)
func UpdateNodeStatus(nodeID uuid.UUID, isOnline bool, latencyMs int) {
	status := models.NodeOffline
	if isOnline {
		status = models.NodeOnline
	}

	now := time.Now()
	db.DB.Model(&models.ProviderNode{}).Where("id = ?", nodeID).Updates(map[string]interface{}{
		"status":       status,
		"last_seen_at": now,
	})

	// Record uptime check
	check := models.UptimeCheck{
		NodeID:    nodeID,
		IsUp:      isOnline,
		LatencyMs: latencyMs,
		CheckedAt: now,
	}
	db.DB.Create(&check)
}
