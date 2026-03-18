package api

import (
	"crypto/ed25519"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/ipfs"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// RegisterGovernanceRoutes registers governance routes
func RegisterGovernanceRoutes(rg *gin.RouterGroup) {
	rg.GET("/governance/proposals", getProposals)
	rg.POST("/governance/proposals", createProposal)
	rg.GET("/governance/proposals/:id", getProposal)
	rg.POST("/governance/proposals/:id/vote", castVote)
	rg.POST("/governance/proposals/:id/execute", executeProposal) // automated/manual trigger
}

type CreateProposalRequest struct {
	Title        string `json:"title" binding:"required,min=5,max=255"`
	Description  string `json:"description" binding:"required,min=20"`
	DurationDays int    `json:"duration_days" binding:"required,min=1,max=14"`
}

type GovernanceVoteRequest struct {
	Choice        string `json:"choice" binding:"required,oneof=yes no abstain"`
	Signature     string `json:"signature" binding:"required"`      // Cryptographic signature
	WalletAddress string `json:"wallet_address" binding:"required"` // Address that signed
}

// verifyVoteSignature checks if the signature is valid for the vote using Ed25519.
func verifyVoteSignature(address, message, signature string) bool {
	pubKeyBytes, err := base58.Decode(address)
	if err != nil || len(pubKeyBytes) != ed25519.PublicKeySize {
		return false
	}
	sigBytes, err := base58.Decode(signature)
	if err != nil || len(sigBytes) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(pubKeyBytes, []byte(message), sigBytes)
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

	// 1. Ensure Governance Forum Category exists
	var govCat models.ForumCategory
	if err := db.Social().Where("name = ?", "Governance").First(&govCat).Error; err != nil {
		govCat = models.ForumCategory{
			Name:        "Governance",
			Slug:        "governance",
			Description: "Official DAO Proposal Discussions",
			SortOrder:   0,
		}
		db.Social().Create(&govCat)
	}

	// 2. Create Forum Thread
	thread := models.ForumThread{
		CategoryID: govCat.ID,
		AuthorID:   userID,
		Title:      "Proposal: " + req.Title,
		Slug:       slugify("proposal-" + req.Title),
		Content:    req.Description + "\n\n[System] Proposal created automatically.",
	}

	if err := db.Social().Create(&thread).Error; err != nil {
		logging.Warn().Err(err).Msg("Failed to auto-create governance thread")
		// Non-blocking, continue
	}

	proposal := models.Proposal{
		Title:       req.Title,
		Description: req.Description,
		ProposerID:  userID,
		StartTime:   time.Now(),
		EndTime:     time.Now().Add(time.Duration(req.DurationDays) * 24 * time.Hour),
		Status:      models.ProposalActive,
		IPFSHash:    cid,
		ThreadID:    &thread.ID, // Link
	}

	if err := db.Social().Create(&proposal).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create proposal"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"proposal": proposal, "thread_slug": thread.Slug})
}

// getProposals lists all proposals
func getProposals(c *gin.Context) {
	var proposals []models.Proposal

	query := db.Social().Preload("Proposer").Order("created_at DESC")

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
	if err := db.Social().Preload("Proposer").First(&proposal, "id = ?", id).Error; err != nil {
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

	// 1. Verify Signature (Decentralization Enforcement)
	voteMsg := fmt.Sprintf("vote:%s:%s", proposalID.String(), req.Choice)
	if !verifyVoteSignature(req.WalletAddress, voteMsg, req.Signature) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
		return
	}

	// 2. Check Proposal Status
	var proposal models.Proposal
	if err := db.Social().First(&proposal, "id = ?", proposalID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Proposal not found"})
		return
	}

	if proposal.Status != models.ProposalActive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Voting is closed for this proposal"})
		return
	}

	if time.Now().After(proposal.EndTime) {
		// Auto-close if expired
		db.Social().Model(&proposal).Update("status", models.ProposalPassed) // Simplification
		c.JSON(http.StatusBadRequest, gin.H{"error": "Voting period has ended"})
		return
	}

	// 2. Check if already voted
	var existingVote models.Vote
	if err := db.Social().Where("proposal_id = ? AND voter_id = ?", proposalID, userID).First(&existingVote).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "You have already voted"})
		return
	}

	// 3. Get Voting Power (TAO Balance)
	// We use the TaoClient (which uses the Bridge) to get the wallet balance
	// Note: In a real system, we'd snapshot the balance at proposal start block
	// For MVP: We check current balance

	// Calculate voting power based on user role and wallet balance
	votingPower := 0.0

	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err == nil {
		// Base voting power
		votingPower = 1.0
		
		// Additional power for providers
		if user.Role == "provider" {
			votingPower += 9.0 // 10 total for providers
		}
		
		// Additional power based on wallet balance (if staked)
		var wallet models.Wallet
		if err := db.DB.First(&wallet, "user_id = ?", userID).Error; err == nil {
			// 1 additional vote per 10 SOL staked, max 100
			stakePower := wallet.BalanceSOL / 10.0
			if stakePower > 100 {
				stakePower = 100
			}
			votingPower += stakePower
		}
	}

	// 4. Record Vote
	vote := models.Vote{
		ProposalID: proposalID,
		VoterID:    userID,
		Choice:     req.Choice,
		Power:      votingPower,
	}

	tx := db.Social().Begin()
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

// executeProposal processes a finished proposal
func executeProposal(c *gin.Context) {
	proposalID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid proposal ID"})
		return
	}

	var proposal models.Proposal
	if err := db.Social().First(&proposal, "id = ?", proposalID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Proposal not found"})
		return
	}

	// Authorization: only the proposer or an admin may trigger execution
	callerRole, _ := c.Get("userRole")
	callerIDRaw, _ := c.Get("userID")
	isAdmin := callerRole == "admin"
	isProposer := false
	switch v := callerIDRaw.(type) {
	case uuid.UUID:
		isProposer = v == proposal.ProposerID
	case string:
		if parsed, err := uuid.Parse(v); err == nil {
			isProposer = parsed == proposal.ProposerID
		}
	}
	if !isAdmin && !isProposer {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the proposer or an admin can execute a proposal"})
		return
	}

	// 1. Validation
	if proposal.Status != models.ProposalActive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Proposal is not active (already executed or rejected)"})
		return
	}

	if time.Now().Before(proposal.EndTime) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Voting period has not ended yet"})
		return
	}

	// 2. Tally Votes
	totalVotes := proposal.YesVotes + proposal.NoVotes
	passed := false
	status := models.ProposalRejected

	if totalVotes >= proposal.Quorum && proposal.YesVotes > proposal.NoVotes {
		passed = true
		status = models.ProposalPassed
	}

	tx := db.DB.Begin()

	// 3. Execution Logic (if passed)
	if passed {
		status = models.ProposalExecuted // Mark executed immediately if successful

		switch proposal.Type {
		case models.ProposalTypeTreasury:
			// Parse execution data: {"recipient": "0x...", "amount": 100, "currency": "SOL"}
			var data struct {
				Recipient string  `json:"recipient"`
				Amount    float64 `json:"amount"`
				Currency  string  `json:"currency"`
			}
			
			recipient := "DAO_Recipient"
			amount := 0.0
			currency := "SOL"
			
			if proposal.ExecutionData != "" {
				if err := json.Unmarshal([]byte(proposal.ExecutionData), &data); err == nil {
					recipient = data.Recipient
					amount = data.Amount
					currency = data.Currency
				}
			}

			// Record Treasury Tx
			trx := models.TreasuryTransaction{
				ProposalID:  proposal.ID,
				Recipient:   recipient,
				Amount:      amount,
				Currency:    currency,
				Description: "Executed via Proposal " + proposal.Title,
				Status:      "executed",
			}
			tx.Create(&trx)

		case models.ProposalTypeParameter:
			// Update Parameter
			// Logic: Parse "key=value" from ExecutionData
			var data struct {
				Key   string `json:"key"`
				Value string `json:"value"`
			}
			
			paramName := "sys_commission_rate"
			paramValue := "0.05"
			
			if proposal.ExecutionData != "" {
				if err := json.Unmarshal([]byte(proposal.ExecutionData), &data); err == nil {
					paramName = data.Key
					paramValue = data.Value
				}
			}
			
			param := models.ProtocolParameter{
				Name:  paramName,
				Value: paramValue,
			}
			tx.Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "name"}},
				DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
			}).Create(&param)
		}
	}

	// 4. Update Status
	if err := tx.Model(&proposal).Update("status", status).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update status"})
		return
	}

	tx.Commit()

	// Notify Forum Thread
	if proposal.ThreadID != nil {
		go func() {
			msg := fmt.Sprintf("[System] Proposal has ended. Status: **%s**.", status)
			post := models.ForumPost{
				ThreadID: *proposal.ThreadID,
				AuthorID: proposal.ProposerID, // Or system bot ID
				Content:  msg,
			}
			db.Social().Create(&post)
		}()
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Proposal processed",
		"status":  status,
		"yes":     proposal.YesVotes,
		"no":      proposal.NoVotes,
	})
}
