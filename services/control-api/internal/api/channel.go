package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/billing"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

type ChannelHandler struct {
	service *billing.StateChannelService
}

func NewChannelHandler() *ChannelHandler {
	return &ChannelHandler{
		service: billing.NewStateChannelService(),
	}
}

type OpenChannelRequest struct {
	SessionID string `json:"session_id" binding:"required"`
	Amount    uint64 `json:"amount" binding:"required"` // Lamports
}

type UpdateStateRequest struct {
	ChannelID   string `json:"channel_id" binding:"required"`
	Nonce       uint64 `json:"nonce" binding:"required"`
	TotalAmount uint64 `json:"total_amount" binding:"required"`
	TotalBytes  uint64 `json:"total_bytes" binding:"required"`
	Signature   string `json:"signature" binding:"required"`
}

// OpenChannel initializes a high-frequency payment channel
func (h *ChannelHandler) OpenChannel(c *gin.Context) {
	var req OpenChannelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	sessionID, err := uuid.Parse(req.SessionID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid session ID"})
		return
	}

	// Get authenticated user ID (Buyer)
	buyerID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Fetch real ProviderID from Session
	var session models.Session
	if err := db.DB.Where("id = ?", sessionID).First(&session).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
		return
	}
	providerID := *session.NodeID // Simplified: Node owner is the provider

	channel, err := h.service.OpenChannel(sessionID, buyerID, providerID, req.Amount)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"channel": channel})
}

// UpdateState processes an off-chain signed state update
func (h *ChannelHandler) UpdateState(c *gin.Context) {
	var req UpdateStateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	channelID, err := uuid.Parse(req.ChannelID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid channel ID"})
		return
	}

	state := models.ChannelState{
		Nonce:       req.Nonce,
		TotalAmount: req.TotalAmount,
		TotalBytes:  req.TotalBytes,
		Signature:   req.Signature,
	}

	if err := h.service.UpdateState(channelID, state); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// RegisterChannelRoutes registers the channel endpoints
func RegisterChannelRoutes(r *gin.RouterGroup) {
	h := NewChannelHandler()
	channels := r.Group("/channels")
	{
		channels.POST("/open", h.OpenChannel)
		channels.POST("/update", h.UpdateState)
	}
}
