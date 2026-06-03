package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	governanceexec "github.com/proxyhubb/control-api/internal/governance"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

type impactPreviewRequest struct {
	Type          string          `json:"type" binding:"required"`
	ExecutionData json.RawMessage `json:"execution_data,omitempty"`
}

// RegisterGovernanceImpactRoutes exposes read-only impact previews (no auth).
func RegisterGovernanceImpactRoutes(r *gin.RouterGroup) {
	r.GET("/governance/proposals/:id/impact", getProposalImpactPreview)
	r.POST("/governance/impact-preview", postGovernanceImpactPreview)
}

func getProposalImpactPreview(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid proposal ID"})
		return
	}

	var proposal models.Proposal
	if err := db.DB.First(&proposal, "id = ?", id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Proposal not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load proposal"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 12*time.Second)
	defer cancel()

	preview, err := governanceexec.BuildImpactPreviewFromProposal(ctx, proposal)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"impact": preview})
}

func postGovernanceImpactPreview(c *gin.Context) {
	var req impactPreviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	proposalType := mapFrontendProposalType(req.Type)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 12*time.Second)
	defer cancel()

	preview, err := governanceexec.BuildImpactPreview(ctx, proposalType, req.ExecutionData)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"impact": preview})
}
