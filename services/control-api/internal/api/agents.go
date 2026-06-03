package api

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterAgentPublicRoutes registers read-only agent marketplace routes.
func RegisterAgentPublicRoutes(r *gin.RouterGroup) {
	agents := r.Group("/agents")
	{
		agents.GET("", ListMarketAgents)
	}
}

// RegisterAgentProtectedRoutes registers authenticated agent actions.
func RegisterAgentProtectedRoutes(r *gin.RouterGroup) {
	agents := r.Group("/agents")
	{
		agents.POST("/rent", RentAgentInstance)
		agents.GET("/instances", ListUserInstances)
		agents.POST("/instances/:id/execute", ExecuteAgentJob)
	}
}

// RegisterAgentRoutes registers all agent marketplace routes on the given group.
// Prefer RegisterAgentPublicRoutes and RegisterAgentProtectedRoutes in app setup
// so public browse and authenticated actions stay explicit.
func RegisterAgentRoutes(r *gin.RouterGroup) {
	RegisterAgentPublicRoutes(r)
	RegisterAgentProtectedRoutes(r)
}

func parseUUID(s string) uuid.UUID {
	id, _ := uuid.Parse(s)
	return id
}

// ListMarketAgents returns all available agents in the marketplace
func ListMarketAgents(c *gin.Context) {
	var agents []models.MarketAgent
	if err := db.Social().Find(&agents).Error; err != nil {
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
	if err := db.Social().Where("id = ?", req.MarketAgentID).First(&agent).Error; err != nil {
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

	if err := db.Social().Create(&instance).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to rent agent"})
		return
	}

	c.JSON(http.StatusCreated, instance)
}

// ListUserInstances returns the user's rented agents
func ListUserInstances(c *gin.Context) {
	userID := c.GetString("userID")
	var instances []models.AgentInstance

	if err := db.Social().Preload("MarketAgent").Where("user_id = ?", userID).Find(&instances).Error; err != nil {
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
	if err := db.Social().Where("id = ? AND user_id = ?", instanceID, userID).First(&instance).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Instance not found or access denied"})
		return
	}

	// Create Job
	job := models.AgentJob{
		AgentInstanceID: instance.ID,
		Status:          "pending",
	}

	if err := db.Social().Create(&job).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to queue job"})
		return
	}

	// 3. Dispatch to Redis Queue (Phase 13 Orchestration)
	dispatcher := GetAgentDispatcher()
	if dispatcher != nil {
		if err := dispatcher.DispatchJob(c.Request.Context(), job.ID); err != nil {
			log.Printf("[API] Failed to dispatch AgentJob=%s: %v", job.ID, err)
			// Don't fail the request if it's in DB, but notify of queue delay
			c.JSON(http.StatusAccepted, gin.H{
				"message": "Job created but queue dispatch delayed",
				"job_id":  job.ID,
				"status":  "pending",
			})
			return
		}
	}

	c.JSON(http.StatusAccepted, gin.H{
		"message": "Job queued for autonomous execution",
		"job_id":  job.ID,
		"status":  "queued",
	})
}
