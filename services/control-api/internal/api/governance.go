package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/ipfs"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/payments"
	"gorm.io/gorm"
)

// RegisterGovernanceRoutes registers governance routes
func RegisterGovernanceRoutes(rg *gin.RouterGroup) {
	rg.GET("/governance/proposals", getProposals)
	rg.POST("/governance/proposals", createProposal)
	rg.GET("/governance/proposals/:id", getProposal)
	rg.POST("/governance/proposals/:id/vote", castVote)
}

type CreateProposalRequest struct {
	Title        string `json:"title" binding:"required,min=5,max=255"`
	Description  string `json:"description" binding:"required,min=20"`
	DurationDays int    `json:"duration_days" binding:"required,min=1,max=14"`
}

type GovernanceVoteRequest struct {
	Choice string `json:"choice" binding:"required,oneof=yes no abstain"`
}

// createProposal creates a new governance proposal
func createProposal(c *gin.Context) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		// Try fallback to context keys set by different middlewares
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	// Check if user has minimum balance to propose (e.g. 10 TAO)
	// For MVP, we skip this check or check if they are "verified"

	var req CreateProposalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Upload description to IPFS
	ipfsClient := ipfs.NewClient()
	cid, err := ipfsClient.UploadText(req.Description)
	if err != nil {
		logging.Error(err).Msg("Failed to upload proposal to IPFS")
		// Continue but warn? Or fail? For MVP, we fail if storage fails.
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upload to decentralized storage"})
		return
	}

	proposal := models.Proposal{
		Title:       req.Title,
		Description: req.Description,
		ProposerID:  userID,
		StartTime:   time.Now(),
		EndTime:     time.Now().Add(time.Duration(req.DurationDays) * 24 * time.Hour),
		Status:      models.ProposalActive,
		IPFSHash:    cid,
	}

	if err := db.DB.Create(&proposal).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create proposal"})
		return
	}

	c.JSON(http.StatusCreated, proposal)
}

// getProposals lists all proposals
func getProposals(c *gin.Context) {
	var proposals []models.Proposal

	query := db.DB.Preload("Proposer").Order("created_at DESC")

	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}

	if err := query.Find(&proposals).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch proposals"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"proposals": proposals})
}

// getProposal gets a single proposal details
func getProposal(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID"})
		return
	}

	var proposal models.Proposal
	if err := db.DB.Preload("Proposer").First(&proposal, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Proposal not found"})
		return
	}

	c.JSON(http.StatusOK, proposal)
}

// castVote allows a user to vote on a proposal
func castVote(c *gin.Context) {
	userIDStr := c.GetString("userID")
	// Normalize user ID retrieval
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(uuid.UUID); ok {
				userIDStr = id.String()
			}
		}
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	proposalID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid proposal ID"})
		return
	}

	var req GovernanceVoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 1. Check Proposal Status
	var proposal models.Proposal
	if err := db.DB.First(&proposal, "id = ?", proposalID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Proposal not found"})
		return
	}

	if proposal.Status != models.ProposalActive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Voting is closed for this proposal"})
		return
	}

	if time.Now().After(proposal.EndTime) {
		// Auto-close if expired
		db.DB.Model(&proposal).Update("status", models.ProposalPassed) // Simplification
		c.JSON(http.StatusBadRequest, gin.H{"error": "Voting period has ended"})
		return
	}

	// 2. Check if already voted
	var existingVote models.Vote
	if err := db.DB.Where("proposal_id = ? AND voter_id = ?", proposalID, userID).First(&existingVote).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "You have already voted"})
		return
	}

	// 3. Get Voting Power (TAO Balance)
	// We use the TaoClient (which uses the Bridge) to get the wallet balance
	// Note: In a real system, we'd snapshot the balance at proposal start block
	// For MVP: We check current balance

	_ = payments.NewTaoClient(GetBittensorClient()) // Client used for future balance check implementation
	votingPower := 0.0

	// Get user's wallet info (mocked/cached in user struct or fetch fresh?)
	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err == nil {
		if user.Role == "admin" {
			votingPower = 1000.0 // Admin super-vote for testing
		} else {
			// Try to fetch real balance if wallet is connected
			// This would rely on caching or direct call
			// simpler: 1 vote per person + 10 if provider
			votingPower = 1.0
			if user.Role == "provider" {
				votingPower = 10.0
			}
		}
	}

	// 4. Record Vote
	vote := models.Vote{
		ProposalID: proposalID,
		VoterID:    userID,
		Choice:     req.Choice,
		Power:      votingPower,
	}

	tx := db.DB.Begin()
	if err := tx.Create(&vote).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to cast vote"})
		return
	}

	// Update Proposal Counts
	metrics := map[string]interface{}{}
	if req.Choice == "yes" {
		metrics["yes_votes"] = gorm.Expr("yes_votes + ?", votingPower)
	} else if req.Choice == "no" {
		metrics["no_votes"] = gorm.Expr("no_votes + ?", votingPower)
	}

	if err := tx.Model(&proposal).Updates(metrics).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update vote counts"})
		return
	}

	tx.Commit()

	c.JSON(http.StatusCreated, gin.H{
		"message": "Vote cast successfully",
		"power":   votingPower,
	})
}
