package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterGovernanceTreasuryPublicRoutes exposes read-only treasury audit rows for a proposal.
func RegisterGovernanceTreasuryPublicRoutes(r *gin.RouterGroup) {
	r.GET("/governance/proposals/:id/treasury-transactions", getProposalTreasuryTransactions)
}

func getProposalTreasuryTransactions(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid proposal ID"})
		return
	}

	var proposal models.Proposal
	if err := db.Social().Select("id").First(&proposal, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Proposal not found"})
		return
	}

	var txs []models.TreasuryTransaction
	if err := db.Social().
		Where("proposal_id = ?", id).
		Order("created_at ASC").
		Find(&txs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load treasury transactions"})
		return
	}

	if txs == nil {
		txs = []models.TreasuryTransaction{}
	}

	c.JSON(http.StatusOK, gin.H{
		"proposal_id":            id,
		"treasury_transactions": txs,
	})
}
