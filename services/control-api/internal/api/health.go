package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/health"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterHealthRoutes registers node health monitoring endpoints
func RegisterHealthRoutes(r *gin.RouterGroup) {
	h := r.Group("/health")
	{
		h.GET("/nodes", getNodesHealth)
		h.GET("/nodes/:id", getNodeHealth)
		h.POST("/nodes/:id/check", triggerNodeHealthCheck)
		h.POST("/nodes/:id/reactivate", reactivateNode)
		h.GET("/stats", getHealthStats)
		h.GET("/system", getSystemHealth)
	}
}

// getNodesHealth returns health status for all nodes
func getNodesHealth(c *gin.Context) {
	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}

	status := c.Query("status") // Filter: healthy, unhealthy

	query := db.DB.Model(&models.Node{})

	switch status {
	case "healthy":
		query = query.Where("is_healthy = ?", true)
	case "unhealthy":
		query = query.Where("is_healthy = ?", false)
	}

	var nodes []models.Node
	if result := query.Order("last_seen_at DESC").Find(&nodes); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch nodes"})
		return
	}

	// Add health summary
	stats := health.GetNodeHealthStats()

	c.JSON(http.StatusOK, gin.H{
		"nodes": nodes,
		"count": len(nodes),
		"stats": stats,
	})
}

// getNodeHealth returns detailed health info for a specific node
func getNodeHealth(c *gin.Context) {
	nodeID := c.Param("id")

	if db.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}

	var node models.Node
	if result := db.DB.First(&node, "id = ?", nodeID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
		return
	}

	// Get recent health history from audit logs
	var recentEvents []models.AuditLog
	db.DB.Where("entity_type = ? AND entity_id = ?", models.EntityNode, nodeID).
		Order("created_at DESC").
		Limit(10).
		Find(&recentEvents)

	c.JSON(http.StatusOK, gin.H{
		"node":          node,
		"is_healthy":    node.IsHealthy,
		"last_seen_at":  node.LastSeenAt,
		"latency_ms":    node.LatencyMs,
		"recent_events": recentEvents,
	})
}

// triggerNodeHealthCheck manually triggers a health check for a node
func triggerNodeHealthCheck(c *gin.Context) {
	nodeID := c.Param("id")

	node, err := health.ManualHealthCheck(nodeID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      "Health check completed",
		"node_id":      nodeID,
		"is_healthy":   node.IsHealthy,
		"latency_ms":   node.LatencyMs,
		"last_seen_at": node.LastSeenAt,
	})
}

// reactivateNode manually reactivates a node
func reactivateNode(c *gin.Context) {
	nodeID := c.Param("id")

	node, err := health.ReactivateNode(nodeID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      "Node reactivated",
		"node_id":      nodeID,
		"is_healthy":   node.IsHealthy,
		"last_seen_at": node.LastSeenAt,
	})
}

// getHealthStats returns aggregate health statistics
func getHealthStats(c *gin.Context) {
	stats := health.GetNodeHealthStats()
	c.JSON(http.StatusOK, stats)
}

// getSystemHealth returns system-level dependency health
// @Summary      Get system health
// @Description  Checks health of DB, Redis, and other dependencies
// @Tags         health
// @Produce      json
// @Success      200  {object} health.SystemHealth
// @Failure      503  {object} health.SystemHealth
// @Router       /health/system [get]
func getSystemHealth(c *gin.Context) {
	status := health.CheckSystem()
	httpStatus := http.StatusOK
	if !status.Healthy {
		httpStatus = http.StatusServiceUnavailable
	}
	c.JSON(httpStatus, status)
}
