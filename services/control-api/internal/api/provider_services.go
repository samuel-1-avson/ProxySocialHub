package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	redisClient "github.com/proxyhubb/control-api/internal/redis"
)

// RegisterProviderServicesRoutes registers provider service configuration routes
func RegisterProviderServicesRoutes(r *gin.RouterGroup) {
	services := r.Group("/provider/services")
	{
		services.GET("", listMyServiceConfigs)
		services.GET("/templates", getServiceTemplates)
		services.GET("/templates/community", getCommunityTemplates) // User shared
		services.POST("/templates/share", shareServiceTemplate)     // Share my config
		services.GET("/:nodeId", getServiceConfig)
		services.POST("", createServiceConfig)
		services.PUT("/:nodeId", updateServiceConfig)
		services.DELETE("/:nodeId", deleteServiceConfig)
		services.POST("/bulk", bulkUpdateServiceConfigs)
	}
}

// @Summary List my service configurations
// @Tags provider-services
// @Produce json
// @Success 200 {array} models.ServiceConfiguration
// @Router /v1/provider/services [get]
func listMyServiceConfigs(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var configs []models.ServiceConfiguration
	if err := db.DB.Where("user_id = ?", userID).
		Preload("Node").
		Order("created_at DESC").
		Find(&configs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch configurations"})
		return
	}

	c.JSON(http.StatusOK, configs)
}

// @Summary Get service templates
// @Tags provider-services
// @Produce json
// @Success 200 {array} models.ServiceConfigTemplate
// @Router /v1/provider/services/templates [get]
func getServiceTemplates(c *gin.Context) {
	templates := models.GetDefaultTemplates()
	c.JSON(http.StatusOK, gin.H{"templates": templates})
}

// @Summary Get service configuration for a node
// @Tags provider-services
// @Param nodeId path string true "Node ID"
// @Produce json
// @Success 200 {object} models.ServiceConfiguration
// @Router /v1/provider/services/{nodeId} [get]
func getServiceConfig(c *gin.Context) {
	userID, _ := c.Get("user_id")
	nodeID := c.Param("nodeId")

	var config models.ServiceConfiguration
	if err := db.DB.Where("node_id = ? AND user_id = ?", nodeID, userID).
		Preload("Node").
		First(&config).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Configuration not found"})
		return
	}

	c.JSON(http.StatusOK, config)
}

// @Summary Create service configuration
// @Tags provider-services
// @Accept json
// @Produce json
// @Param request body models.CreateServiceConfigRequest true "Configuration"
// @Success 201 {object} models.ServiceConfiguration
// @Router /v1/provider/services [post]
func createServiceConfig(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var req models.CreateServiceConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify node ownership
	var node models.Node
	if err := db.DB.Where("id = ? AND provider_user_id = ?", req.NodeID, userID).First(&node).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Node not found or not owned by you"})
		return
	}

	// Check if config already exists
	var existing models.ServiceConfiguration
	if err := db.DB.Where("node_id = ?", req.NodeID).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Configuration already exists for this node"})
		return
	}

	config := models.ServiceConfiguration{
		NodeID: req.NodeID,
		UserID: userID.(uuid.UUID),
	}

	// Apply request values
	if req.EnableHTTP != nil {
		config.EnableHTTP = *req.EnableHTTP
	}
	if req.EnableHTTPS != nil {
		config.EnableHTTPS = *req.EnableHTTPS
	}
	if req.EnableSOCKS5 != nil {
		config.EnableSOCKS5 = *req.EnableSOCKS5
	}
	if req.EnableSSHTunnel != nil {
		config.EnableSSHTunnel = *req.EnableSSHTunnel
	}
	if req.MaxBandwidthMbps != nil {
		config.MaxBandwidthMbps = *req.MaxBandwidthMbps
	}
	if req.PriorityTier != nil {
		config.PriorityTier = *req.PriorityTier
	}
	if req.AllowedCountries != nil {
		config.AllowedCountries = req.AllowedCountries
	}
	if req.BlockedCountries != nil {
		config.BlockedCountries = req.BlockedCountries
	}
	if req.MaxConcurrentConnections != nil {
		config.MaxConcurrentConnections = *req.MaxConcurrentConnections
	}
	if req.MaxDailyBandwidthGB != nil {
		config.MaxDailyBandwidthGB = *req.MaxDailyBandwidthGB
	}
	if req.CaptchaSolvingEnabled != nil {
		config.CaptchaSolvingEnabled = *req.CaptchaSolvingEnabled
	}
	if req.JavascriptRenderEnabled != nil {
		config.JavascriptRenderEnabled = *req.JavascriptRenderEnabled
	}

	if err := db.DB.Create(&config).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create configuration"})
		return
	}

	c.JSON(http.StatusCreated, config)
}

// @Summary Update service configuration
// @Tags provider-services
// @Accept json
// @Produce json
// @Param nodeId path string true "Node ID"
// @Param request body models.UpdateServiceConfigRequest true "Updates"
// @Success 200 {object} models.ServiceConfiguration
// @Router /v1/provider/services/{nodeId} [put]
func updateServiceConfig(c *gin.Context) {
	userID, _ := c.Get("user_id")
	nodeID := c.Param("nodeId")

	var req models.UpdateServiceConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var config models.ServiceConfiguration
	if err := db.DB.Where("node_id = ? AND user_id = ?", nodeID, userID).First(&config).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Configuration not found"})
		return
	}

	// Update fields
	updates := make(map[string]interface{})
	if req.EnableHTTP != nil {
		updates["enable_http"] = *req.EnableHTTP
	}
	if req.EnableHTTPS != nil {
		updates["enable_https"] = *req.EnableHTTPS
	}
	if req.EnableSOCKS5 != nil {
		updates["enable_socks5"] = *req.EnableSOCKS5
	}
	if req.EnableSSHTunnel != nil {
		updates["enable_ssh_tunnel"] = *req.EnableSSHTunnel
	}
	if req.MaxBandwidthMbps != nil {
		updates["max_bandwidth_mbps"] = *req.MaxBandwidthMbps
	}
	if req.PriorityTier != nil {
		updates["priority_tier"] = *req.PriorityTier
	}
	if req.AllowedCountries != nil {
		updates["allowed_countries"] = req.AllowedCountries
	}
	if req.BlockedCountries != nil {
		updates["blocked_countries"] = req.BlockedCountries
	}
	if req.MaxConcurrentConnections != nil {
		updates["max_concurrent_connections"] = *req.MaxConcurrentConnections
	}
	if req.MaxDailyBandwidthGB != nil {
		updates["max_daily_bandwidth_gb"] = *req.MaxDailyBandwidthGB
	}
	if req.CaptchaSolvingEnabled != nil {
		updates["captcha_solving_enabled"] = *req.CaptchaSolvingEnabled
	}
	if req.JavascriptRenderEnabled != nil {
		updates["javascript_render_enabled"] = *req.JavascriptRenderEnabled
	}
	if req.ScreenshotEnabled != nil {
		updates["screenshot_enabled"] = *req.ScreenshotEnabled
	}
	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}

	if req.IsActive != nil {
		updates["is_active"] = *req.IsActive
	}

	// 1. Versioning: Archive old config
	// Capture current state before update? Or capture what we are changing to?
	// Usually history tracks "what it was before" or "what it became".
	// Let's track "what it became" (Snapshot) or just the diff.
	// Simplest: Snapshot the *previous* state before overwriting.
	oldConfigJSON, _ := json.Marshal(config)
	history := models.ServiceConfigHistory{
		ServiceConfigID: config.ID,
		ChangedBy:       userID.(uuid.UUID),
		ChangeReason:    "API Update",
		ConfigSnapshot:  string(oldConfigJSON),
	}
	db.DB.Create(&history)

	if err := db.DB.Model(&config).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update configuration"})
		return
	}

	// Reload to get fresh state including DB defaults and relations
	db.DB.Preload("Node").Where("id = ?", config.ID).First(&config)

	// 2. Redis Sync (Push to Edge)
	if redisClient.Client != nil {
		ctx := c.Request.Context()
		redisKey := "node:config:" + config.NodeID.String()
		newConfigJSON, _ := json.Marshal(config)
		// Cache for 1 hour approx, Gateway should cache locally too
		redisClient.Client.Set(ctx, redisKey, newConfigJSON, 3600*time.Second)
	}

	c.JSON(http.StatusOK, config)
}

// @Summary Delete service configuration
// @Tags provider-services
// @Param nodeId path string true "Node ID"
// @Success 204
// @Router /v1/provider/services/{nodeId} [delete]
func deleteServiceConfig(c *gin.Context) {
	userID, _ := c.Get("user_id")
	nodeID := c.Param("nodeId")

	var config models.ServiceConfiguration
	if err := db.DB.Where("node_id = ? AND user_id = ?", nodeID, userID).First(&config).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Configuration not found"})
		return
	}

	if err := db.DB.Delete(&config).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete configuration"})
		return
	}

	c.Status(http.StatusNoContent)
}

// BulkUpdateRequest for multiple nodes
type BulkUpdateRequest struct {
	NodeIDs []uuid.UUID                       `json:"node_ids" binding:"required"`
	Config  models.UpdateServiceConfigRequest `json:"config" binding:"required"`
}

// @Summary Bulk update service configurations
// @Tags provider-services
// @Accept json
// @Produce json
// @Param request body BulkUpdateRequest true "Bulk update"
// @Success 200 {object} gin.H
// @Router /v1/provider/services/bulk [post]
func bulkUpdateServiceConfigs(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var req BulkUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updated := 0
	for _, nodeID := range req.NodeIDs {
		var config models.ServiceConfiguration
		if err := db.DB.Where("node_id = ? AND user_id = ?", nodeID, userID).First(&config).Error; err != nil {
			continue // Skip nodes not found
		}

		updates := make(map[string]interface{})
		if req.Config.EnableHTTP != nil {
			updates["enable_http"] = *req.Config.EnableHTTP
		}
		if req.Config.EnableSOCKS5 != nil {
			updates["enable_socks5"] = *req.Config.EnableSOCKS5
		}
		if req.Config.MaxBandwidthMbps != nil {
			updates["max_bandwidth_mbps"] = *req.Config.MaxBandwidthMbps
		}
		if req.Config.IsActive != nil {
			updates["is_active"] = *req.Config.IsActive
		}

		if err := db.DB.Model(&config).Updates(updates).Error; err == nil {
			updated++
		}
	}

	c.JSON(http.StatusOK, gin.H{"updated": updated, "total": len(req.NodeIDs)})
}

// ShareTemplateRequest
type ShareTemplateRequest struct {
	NodeID      uuid.UUID `json:"node_id" binding:"required"`
	Name        string    `json:"name" binding:"required"`
	Description string    `json:"description"`
	Price       float64   `json:"price"`
}

// shareServiceTemplate creates a public template from a node config
func shareServiceTemplate(c *gin.Context) {
	userID, _ := c.Get("user_id")
	uID := userID.(uuid.UUID)

	var req ShareTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Fetch Config
	var config models.ServiceConfiguration
	if err := db.DB.Where("node_id = ? AND user_id = ?", req.NodeID, uID).First(&config).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Configuration not found"})
		return
	}

	// Serialize Config
	configJSON, _ := json.Marshal(config)

	template := models.SharedServiceTemplate{
		UserID:         uID,
		Name:           req.Name,
		Description:    req.Description,
		Price:          req.Price,
		ConfigSnapshot: string(configJSON),
	}

	if err := db.DB.Create(&template).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to share template"})
		return
	}

	c.JSON(http.StatusCreated, template)
}

// getCommunityTemplates returns shared templates
func getCommunityTemplates(c *gin.Context) {
	var templates []models.SharedServiceTemplate
	db.DB.Preload("Author").Order("downloads DESC, created_at DESC").Limit(50).Find(&templates)
	c.JSON(http.StatusOK, gin.H{"templates": templates})
}
