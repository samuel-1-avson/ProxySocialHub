package api

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/ipfs"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
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

	// PHB-GOV: Require a minimum on-chain PHB balance to create a proposal.
	// When PHB_TOKEN_MINT is set, the proposer must hold ≥ 100 PHB (raw units,
	// assuming 9 decimals → 100_000_000_000 = 100 PHB).
	// This is a soft Sybil guard — anyone with real stake can propose.
	if mintStr := os.Getenv("PHB_TOKEN_MINT"); mintStr != "" {
		oracle := solana.GetOracleClient()
		if oracle != nil {
			mintKey, mintErr := solana.PublicKeyFromBase58String(mintStr)
			if mintErr == nil {
				// Resolve proposer wallet.
				var proposerUser models.User
				if dbErr := db.DB.Select("wallet_address").First(&proposerUser, "id = ?", userID).Error; dbErr == nil &&
					proposerUser.WalletAddress != nil && *proposerUser.WalletAddress != "" {
					if walletPK, pkErr := solana.PublicKeyFromBase58String(*proposerUser.WalletAddress); pkErr == nil {
						ctx100, cancel100 := context.WithTimeout(c.Request.Context(), 5*time.Second)
						defer cancel100()
						const minPHBRaw = uint64(100_000_000_000) // 100 PHB @ 9 decimals
						phbBal, balErr := oracle.GetTokenBalance(ctx100, walletPK, mintKey)
						if balErr == nil && phbBal < minPHBRaw {
							c.JSON(http.StatusForbidden, gin.H{
								"error": fmt.Sprintf("insufficient PHB: need ≥100 PHB to create a proposal, have %d raw units", phbBal),
							})
							return
						}
					}
				}
			}
		}
	}

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

	// GOV-001: Anchor proposal on-chain — title_hash + end_slot commit to content
	// that cannot be silently altered after creation.
	go func(prop models.Proposal, proposerID uuid.UUID) {
		oracle := solana.GetOracleClient()
		if oracle == nil {
			return
		}
		var pidBytes [16]byte
		copy(pidBytes[:], prop.ID[:])

		// title_hash = SHA-256(title + "|" + ipfs_cid)
		h := sha256.Sum256([]byte(prop.Title + "|" + prop.IPFSHash))

		// Convert end_time to an approximate Solana slot (1 slot ≈ 400ms)
		duration := time.Until(prop.EndTime)
		endSlot := uint64(duration.Milliseconds() / 400)

		ctx2, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		proposerPubkey := solana.ZeroPublicKey() // fallback; ideally fetched from user's linked wallet
		var proposerUser models.User
		if err := db.DB.Select("wallet_address").First(&proposerUser, "id = ?", proposerID).Error; err == nil {
			if proposerUser.WalletAddress != nil && *proposerUser.WalletAddress != "" {
				if pk, err := solana.PublicKeyFromBase58String(*proposerUser.WalletAddress); err == nil {
					proposerPubkey = pk
				}
			}
		}

		proposalPDA, sig, err := oracle.CreateProposalOnChain(ctx2, solana.CreateProposalParams{
			ProposalID: pidBytes,
			Proposer:   proposerPubkey,
			TitleHash:  h,
			EndSlot:    endSlot,
		})
		if err != nil {
			logging.Error(err).Str("proposal_id", prop.ID.String()).Msg("createProposal: CreateProposalOnChain failed (non-fatal)")
			return
		}
		// Persist the on-chain PDA in the DB for future verification.
		db.Social().Model(&models.Proposal{}).Where("id = ?", prop.ID).
			Update("onchain_pda", proposalPDA.String())
		logging.Info().Str("sig", sig).Str("pda", proposalPDA.String()).Msg("createProposal: anchored on-chain")
	}(proposal, userID)

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

	// D-G3: Stake-weighted voting.
	//
	// Voting power = sum of StakedAmountSOL across all active nodes owned by
	// the voter, plus a 1.0 base for non-providers so everyone can vote.
	//
	// Using staked collateral (not total wallet balance) is intentional:
	//   - Prevents a holder from voting with funds they haven't committed.
	//   - Aligns governance power with skin-in-the-game.
	//   - Capped per address at 10 000 SOL to prevent whale capture.
	//
	// TODO (Phase A): snapshot stake at proposal.StartTime block to prevent
	// last-minute stake manipulation; requires on-chain registry migration.
	votingPower := 1.0 // base — every authenticated wallet gets 1 vote

	var totalStaked float64
	db.DB.Model(&models.Node{}).
		Where("user_id = ? AND is_healthy = true AND deleted_at IS NULL", userID).
		Select("COALESCE(SUM(staked_amount_sol), 0)").
		Scan(&totalStaked)

	const maxStakeVotingPower = 10_000.0
	if totalStaked > maxStakeVotingPower {
		totalStaked = maxStakeVotingPower
	}
	votingPower += totalStaked

	// PHB-GOV: Add on-chain PHB balance to voting power.
	// 1 PHB (raw: 1_000_000_000 units at 9 decimals) = 1 voting weight unit.
	// Capped at 10 000 PHB to prevent token whale capture.
	// Falls back silently if PHB_TOKEN_MINT is not configured or RPC fails.
	if mintStr := os.Getenv("PHB_TOKEN_MINT"); mintStr != "" {
		oracle := solana.GetOracleClient()
		if oracle != nil {
			mintKey, mintErr := solana.PublicKeyFromBase58String(mintStr)
			walletPK, walletErr := solana.PublicKeyFromBase58String(req.WalletAddress)
			if mintErr == nil && walletErr == nil {
				ctxPhb, cancelPhb := context.WithTimeout(c.Request.Context(), 3*time.Second)
				defer cancelPhb()
				const phbDecimals = 1_000_000_000.0
				const maxPHBVotingPower = 10_000.0
				if phbRaw, phbErr := oracle.GetTokenBalance(ctxPhb, walletPK, mintKey); phbErr == nil {
					phbUnits := float64(phbRaw) / phbDecimals
					if phbUnits > maxPHBVotingPower {
						phbUnits = maxPHBVotingPower
					}
					votingPower += phbUnits
				}
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
