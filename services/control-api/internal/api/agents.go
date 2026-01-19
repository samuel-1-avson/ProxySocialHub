package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterAgentRoutes registers the agent marketplace routes
func RegisterAgentRoutes(r *gin.RouterGroup) {
	agents := r.Group("/agents")
	{
		agents.GET("", ListMarketAgents)
		agents.POST("/rent", RentAgentInstance)
		agents.GET("/instances", ListUserInstances)
		agents.POST("/instances/:id/execute", ExecuteAgentJob)
	}
}

func parseUUID(s string) uuid.UUID {
	id, _ := uuid.Parse(s)
	return id
}

// ListMarketAgents returns all available agents in the marketplace
func ListMarketAgents(c *gin.Context) {
	var agents []models.MarketAgent
	if err := db.DB.Find(&agents).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch agents"})
		return
	}
	c.JSON(http.StatusOK, agents)
}

// RentAgentInstance creates a new instance of an agent for the user
func RentAgentInstance(c *gin.Context) {
	userID := c.GetString("userID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req struct {
		MarketAgentID string                 `json:"market_agent_id" binding:"required"`
		Name          string                 `json:"name"`
		Config        map[string]interface{} `json:"config"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify agent exists
	var agent models.MarketAgent
	if err := db.DB.Where("id = ?", req.MarketAgentID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agent not found"})
		return
	}

	// Create instance
	instance := models.AgentInstance{
		UserID:        parseUUID(userID),
		MarketAgentID: agent.ID,
		Name:          req.Name,
		Config:        req.Config,
		Status:        "active",
	}

	if err := db.DB.Create(&instance).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to rent agent"})
		return
	}

	c.JSON(http.StatusCreated, instance)
}

// ListUserInstances returns the user's rented agents
func ListUserInstances(c *gin.Context) {
	userID := c.GetString("userID")
	var instances []models.AgentInstance

	if err := db.DB.Preload("MarketAgent").Where("user_id = ?", userID).Find(&instances).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch instances"})
		return
	}

	c.JSON(http.StatusOK, instances)
}

// ExecuteAgentJob triggers a run for an agent instance
func ExecuteAgentJob(c *gin.Context) {
	userID := c.GetString("userID")
	instanceID := c.Param("id")

	// Verify ownership
	var instance models.AgentInstance
	if err := db.DB.Where("id = ? AND user_id = ?", instanceID, userID).First(&instance).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Instance not found or access denied"})
		return
	}

	// Create Job
	job := models.AgentJob{
		AgentInstanceID: instance.ID,
		Status:          "pending",
	}

	if err := db.DB.Create(&job).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to queue job"})
		return
	}

	// TODO: Dispatch to worker queue (Redis/Asynq)
	// For now, we just acknowledge the queueing
	c.JSON(http.StatusAccepted, gin.H{"message": "Job queued", "job_id": job.ID})
}
