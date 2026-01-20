package api

import (
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/datatypes"
)

func RegisterAgentRegistryRoutes(r *gin.RouterGroup) {
	registry := r.Group("/registry/agents")
	{
		registry.POST("/register", registerAgent)
		registry.POST("/verify/output", verifyAgentOutput)
		registry.GET("/:id/verified-outputs", getAgentVerifiedOutputs)
	}
}

type RegisterAgentRequest struct {
	Name         string   `json:"name" binding:"required"`
	PublicKey    string   `json:"public_key" binding:"required"` // Hex encoded Ed25519 public key
	Capabilities []string `json:"capabilities"`
}

type VerifyOutputRequest struct {
	AgentID     string         `json:"agent_id" binding:"required"`
	ContentHash string         `json:"content_hash" binding:"required"` // Hex encoded SHA256 hash
	Signature   string         `json:"signature" binding:"required"`    // Hex encoded Ed25519 signature
	Metadata    map[string]any `json:"metadata"`
}

// registerAgent allows a user to register a new AI Agent identity
func registerAgent(c *gin.Context) {
	userID := c.GetString("userID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
		return
	}

	var req RegisterAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	// Validate Public Key format
	_, err := hex.DecodeString(req.PublicKey)
	if err != nil || len(req.PublicKey) != 64 { // Ed25519 public key is 32 bytes (64 hex chars)
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Invalid public key format. Must be 32-byte hex string."})
		return
	}

	uid, _ := uuid.Parse(userID)

	// Convert capabilities to JSONB
	capabilitiesJSON, _ := json.Marshal(req.Capabilities)

	agent := models.Agent{
		OwnerID:      uid,
		Name:         req.Name,
		PublicKey:    req.PublicKey,
		Capabilities: datatypes.JSON(capabilitiesJSON),
		Verified:     true, // Self-registered agents are initially verified as identities
	}

	if err := db.DB.Create(&agent).Error; err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to register agent"})
		return
	}

	c.JSON(http.StatusCreated, agent)
}

// verifyAgentOutput cryptographically verifies a unit of work
func verifyAgentOutput(c *gin.Context) {
	var req VerifyOutputRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: err.Error()})
		return
	}

	// 1. Fetch Agent
	var agent models.Agent
	if err := db.DB.Where("id = ?", req.AgentID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, ErrorResponse{Error: "Agent not found"})
		return
	}

	// 2. Verify Signature
	pubKeyBytes, _ := hex.DecodeString(agent.PublicKey)
	sigBytes, err := hex.DecodeString(req.Signature)
	if err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Invalid signature format"})
		return
	}
	hashBytes, err := hex.DecodeString(req.ContentHash)
	if err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "Invalid content hash format"})
		return
	}

	valid := ed25519.Verify(pubKeyBytes, hashBytes, sigBytes)
	if !valid {
		c.JSON(http.StatusForbidden, ErrorResponse{Error: "Signature verification failed"})
		return
	}

	// 3. Log Verified Output
	metadataJSON, _ := json.Marshal(req.Metadata)
	agentID, _ := uuid.Parse(req.AgentID)

	output := models.AgentOutput{
		AgentID:     agentID,
		ContentHash: req.ContentHash,
		Signature:   req.Signature,
		Metadata:    datatypes.JSON(metadataJSON),
		Verified:    true,
	}

	if err := db.DB.Create(&output).Error; err != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to log verification"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"verified":   true,
		"output_id":  output.ID,
		"agent_name": agent.Name,
	})
}

func getAgentVerifiedOutputs(c *gin.Context) {
	agentID := c.Param("id")

	var outputs []models.AgentOutput
	result := db.DB.Where("agent_id = ? AND verified = ?", agentID, true).Order("created_at desc").Limit(50).Find(&outputs)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Failed to fetch history"})
		return
	}

	c.JSON(http.StatusOK, outputs)
}
