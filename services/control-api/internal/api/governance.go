package api

import (
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"

	sol "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mr-tron/base58"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/ipfs"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
)

// RegisterGovernanceRoutes registers governance routes
func RegisterGovernanceRoutes(rg *gin.RouterGroup) {
	rg.GET("/governance/proposals", getProposals)
	rg.POST("/governance/proposals", createProposal)
	rg.GET("/governance/proposals/:id", getProposal)
	rg.POST("/governance/proposals/:id/vote/build", buildGovernanceVoteTx)
	rg.POST("/governance/proposals/:id/vote/relay", relayGovernanceVoteTx)
	rg.POST("/governance/proposals/:id/vote", castVote)
	rg.POST("/governance/proposals/:id/execute", executeProposal) // automated/manual trigger
}

type CreateProposalRequest struct {
	Title        string `json:"title" binding:"required,min=5,max=255"`
	Description  string `json:"description" binding:"required,min=20"`
	DurationDays int    `json:"duration_days" binding:"required,min=1,max=14"`
}

type GovernanceVoteRequest struct {
	Choice        string `json:"choice" binding:"required,oneof=yes no"`
	Signature     string `json:"signature" binding:"required"`       // Cryptographic signature
	WalletAddress string `json:"wallet_address" binding:"required"`  // Address that signed
	OnChainTxSig  string `json:"on_chain_tx_sig" binding:"required"` // Finalized Solana transaction signature
}

type GovernanceVoteBuildTxRequest struct {
	Choice        string `json:"choice" binding:"required,oneof=yes no"`
	Signature     string `json:"signature" binding:"required"`
	WalletAddress string `json:"wallet_address" binding:"required"`
}

type GovernanceVoteRelayTxRequest struct {
	WalletAddress           string `json:"wallet_address" binding:"required"`
	SignedTransactionBase64 string `json:"signed_transaction_base64" binding:"required"`
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
	setAuthorityHeaders(c, authorityModeChainAuthoritative, "required", "mirror")

	report := solana.GetGovernanceExecutionCapabilityReport(c.Request.Context())
	if !report.Ready {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":                "governance chain execution is not ready",
			"governance_execution": report,
		})
		return
	}

	userID, ok := governanceUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	var req CreateProposalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	walletAddr, walletErr := governanceUserWalletAddress(userID)
	if walletErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": walletErr.Error()})
		return
	}

	oracle := solana.GetOracleClient()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "oracle unavailable"})
		return
	}

	proposerPK, err := solana.PublicKeyFromBase58String(walletAddr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid linked Solana wallet"})
		return
	}

	// PHB-GOV: Optional minimum on-chain PHB gate.
	if mintStr := os.Getenv("PHB_TOKEN_MINT"); mintStr != "" {
		mintKey, mintErr := solana.PublicKeyFromBase58String(mintStr)
		if mintErr == nil {
			const minPHBRaw = uint64(100_000_000_000) // 100 PHB @ 9 decimals
			phbBal, balErr := oracle.GetTokenBalance(c.Request.Context(), proposerPK, mintKey)
			if balErr == nil && phbBal < minPHBRaw {
				c.JSON(http.StatusForbidden, gin.H{
					"error": fmt.Sprintf("insufficient PHB: need >=100 PHB to create proposal, have %d raw units", phbBal),
				})
				return
			}
		}
	}

	ipfsClient := ipfs.NewClient()
	cid, err := ipfsClient.UploadText(req.Description)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upload to decentralized storage"})
		return
	}

	proposalID := uuid.New()
	now := time.Now()
	endTime := now.Add(time.Duration(req.DurationDays) * 24 * time.Hour)
	endSlot := uint64(time.Until(endTime).Milliseconds() / 400)
	if endSlot == 0 {
		endSlot = 1
	}
	var pidBytes [16]byte
	copy(pidBytes[:], proposalID[:])
	titleHash := sha256.Sum256([]byte(req.Title + "|" + cid))

	proposalPDA, txSig, err := oracle.CreateProposalOnChain(c.Request.Context(), solana.CreateProposalParams{
		ProposalID: pidBytes,
		Proposer:   proposerPK,
		TitleHash:  titleHash,
		EndSlot:    endSlot,
	})
	if err != nil {
		if solana.IsProgramUpgradeRequired(err) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":                "governance program upgrade required",
				"governance_execution": report,
			})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": "On-chain proposal creation failed: " + err.Error()})
		return
	}

	var threadID *uuid.UUID
	var govCat models.ForumCategory
	if err := db.Social().Where("name = ?", "Governance").First(&govCat).Error; err != nil {
		govCat = models.ForumCategory{
			Name:        "Governance",
			Slug:        "governance",
			Description: "Official DAO Proposal Discussions",
			SortOrder:   0,
		}
		_ = db.Social().Create(&govCat).Error
	}
	if govCat.ID != uuid.Nil {
		thread := models.ForumThread{
			CategoryID: govCat.ID,
			AuthorID:   userID,
			Title:      "Proposal: " + req.Title,
			Slug:       slugify("proposal-" + req.Title),
			Content:    req.Description + "\n\n[System] Proposal created via chain-authoritative flow.",
		}
		if err := db.Social().Create(&thread).Error; err == nil {
			threadID = &thread.ID
		}
	}

	proposal := models.Proposal{
		ID:          proposalID,
		Title:       req.Title,
		Description: req.Description,
		ProposerID:  userID,
		Type:        models.ProposalTypeGeneral,
		StartTime:   now,
		EndTime:     endTime,
		Status:      models.ProposalActive,
		IPFSHash:    cid,
		ThreadID:    threadID,
	}

	if err := db.Social().Create(&proposal).Error; err != nil {
		logging.Warn().Err(err).Str("proposal_id", proposalID.String()).Msg("createProposal: on-chain success, DB mirror failed")
		c.JSON(http.StatusAccepted, gin.H{
			"message":      "proposal created on-chain; db mirror pending reconciliation",
			"proposal_id":  proposalID,
			"proposal_pda": proposalPDA.String(),
			"tx_sig":       txSig,
			"warning":      err.Error(),
		})
		return
	}

	// Best-effort: persist on-chain PDA if column exists in DB schema.
	if err := db.Social().Model(&models.Proposal{}).Where("id = ?", proposalID).Update("onchain_pda", proposalPDA.String()).Error; err != nil {
		logging.Debug().Err(err).Str("proposal_id", proposalID.String()).Msg("createProposal: onchain_pda mirror skipped")
	}

	c.JSON(http.StatusCreated, gin.H{
		"proposal":     proposal,
		"proposal_pda": proposalPDA.String(),
		"tx_sig":       txSig,
	})
}

// getProposals lists all proposals
func getProposals(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "none", "source_of_truth")

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
	setAuthorityHeaders(c, authorityModeDBAuthoritative, "none", "source_of_truth")

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

// buildGovernanceVoteTx returns an unsigned cast_governance_vote transaction
// for the caller wallet to sign client-side.
func buildGovernanceVoteTx(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeChainAuthoritative, "required", "mirror")

	report := solana.GetGovernanceExecutionCapabilityReport(c.Request.Context())
	if !report.Ready {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":                "governance chain execution is not ready",
			"governance_execution": report,
		})
		return
	}

	userID, ok := governanceUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	proposalID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid proposal ID"})
		return
	}

	var req GovernanceVoteBuildTxRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	voteMsg := fmt.Sprintf("vote:%s:%s", proposalID.String(), req.Choice)
	if !verifyVoteSignature(req.WalletAddress, voteMsg, req.Signature) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
		return
	}

	linkedWallet, walletErr := governanceUserWalletAddress(userID)
	if walletErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": walletErr.Error()})
		return
	}
	if linkedWallet != req.WalletAddress {
		c.JSON(http.StatusForbidden, gin.H{"error": "wallet_address must match your linked wallet"})
		return
	}

	oracle := solana.GetOracleClient()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "oracle unavailable"})
		return
	}

	voterPK, err := solana.PublicKeyFromBase58String(req.WalletAddress)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wallet_address"})
		return
	}

	var pidBytes [16]byte
	copy(pidBytes[:], proposalID[:])
	proposalPDA, _, err := oracle.GetGovernanceProposalPDA(pidBytes)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to resolve proposal PDA"})
		return
	}

	votingPower := governanceVotePowerRaw(c, oracle, voterPK)
	builtTx, err := oracle.BuildGovernanceVoteTransaction(c.Request.Context(), solana.BuildGovernanceVoteTxParams{
		ProposalPDA: proposalPDA,
		VoterWallet: voterPK,
		VoteYes:     req.Choice == "yes",
		VotingPower: votingPower,
	})
	if err != nil {
		if solana.IsProgramUpgradeRequired(err) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":                "governance program upgrade required",
				"governance_execution": report,
			})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to build vote transaction: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"proposal_id":                 proposalID,
		"proposal_pda":                proposalPDA.String(),
		"governance_vote_pda":         builtTx.GovernanceVotePDA.String(),
		"wallet_address":              req.WalletAddress,
		"choice":                      req.Choice,
		"voting_power":                votingPower,
		"unsigned_transaction_base64": builtTx.UnsignedTxBase64,
		"recent_blockhash":            builtTx.RecentBlockhash,
	})
}

// relayGovernanceVoteTx relays a fully signed governance vote transaction.
func relayGovernanceVoteTx(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeChainAuthoritative, "required", "none")

	report := solana.GetGovernanceExecutionCapabilityReport(c.Request.Context())
	if !report.Ready {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":                "governance chain execution is not ready",
			"governance_execution": report,
		})
		return
	}

	userID, ok := governanceUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
		return
	}

	proposalID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid proposal ID"})
		return
	}

	var req GovernanceVoteRelayTxRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	linkedWallet, walletErr := governanceUserWalletAddress(userID)
	if walletErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": walletErr.Error()})
		return
	}
	if linkedWallet != req.WalletAddress {
		c.JSON(http.StatusForbidden, gin.H{"error": "wallet_address must match your linked wallet"})
		return
	}

	oracle := solana.GetOracleClient()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "oracle unavailable"})
		return
	}

	voterPK, err := solana.PublicKeyFromBase58String(req.WalletAddress)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wallet_address"})
		return
	}

	var pidBytes [16]byte
	copy(pidBytes[:], proposalID[:])
	proposalPDA, _, err := oracle.GetGovernanceProposalPDA(pidBytes)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to resolve proposal PDA"})
		return
	}
	votePDA, _, err := oracle.GetGovernanceVotePDA(proposalPDA, voterPK)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to resolve governance vote PDA"})
		return
	}

	tx, err := sol.TransactionFromBase64(req.SignedTransactionBase64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid signed_transaction_base64"})
		return
	}
	if err := tx.VerifySignatures(); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid transaction signatures"})
		return
	}
	if !tx.IsSigner(voterPK) {
		c.JSON(http.StatusForbidden, gin.H{"error": "signed transaction must include linked wallet as signer"})
		return
	}
	hasProposal, err := tx.HasAccount(proposalPDA)
	if err != nil || !hasProposal {
		c.JSON(http.StatusBadRequest, gin.H{"error": "signed transaction does not target proposal account"})
		return
	}
	hasVotePDA, err := tx.HasAccount(votePDA)
	if err != nil || !hasVotePDA {
		c.JSON(http.StatusBadRequest, gin.H{"error": "signed transaction does not include expected governance vote account"})
		return
	}
	hasProgram, err := tx.HasAccount(oracle.GetProgramID())
	if err != nil || !hasProgram {
		c.JSON(http.StatusBadRequest, gin.H{"error": "signed transaction does not include governance program"})
		return
	}

	txSig, err := oracle.RelaySignedTransactionBase64(c.Request.Context(), req.SignedTransactionBase64)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to relay signed transaction: " + err.Error()})
		return
	}

	c.JSON(http.StatusAccepted, gin.H{
		"message":      "Signed governance vote transaction relayed",
		"proposal_id":  proposalID,
		"proposal_pda": proposalPDA.String(),
		"tx_sig":       txSig,
	})
}

// castVote allows a user to vote on a proposal
func castVote(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeChainAuthoritative, "required", "mirror")

	report := solana.GetGovernanceExecutionCapabilityReport(c.Request.Context())
	if !report.Ready {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":                "governance chain execution is not ready",
			"governance_execution": report,
		})
		return
	}

	userID, ok := governanceUserID(c)
	if !ok {
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

	voteMsg := fmt.Sprintf("vote:%s:%s", proposalID.String(), req.Choice)
	if !verifyVoteSignature(req.WalletAddress, voteMsg, req.Signature) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
		return
	}

	linkedWallet, walletErr := governanceUserWalletAddress(userID)
	if walletErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": walletErr.Error()})
		return
	}
	if linkedWallet != req.WalletAddress {
		c.JSON(http.StatusForbidden, gin.H{"error": "wallet_address must match your linked wallet"})
		return
	}

	oracle := solana.GetOracleClient()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "oracle unavailable"})
		return
	}

	voterPK, err := solana.PublicKeyFromBase58String(req.WalletAddress)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid wallet_address"})
		return
	}

	var pidBytes [16]byte
	copy(pidBytes[:], proposalID[:])
	proposalPDA, _, err := oracle.GetGovernanceProposalPDA(pidBytes)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to resolve proposal PDA"})
		return
	}

	if _, err := oracle.GetTransaction(c.Request.Context(), req.OnChainTxSig); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "On-chain vote transaction not finalized yet", "details": err.Error()})
		return
	}

	voteOnChain, err := oracle.ReadGovernanceVote(c.Request.Context(), proposalPDA, voterPK)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to verify on-chain vote: " + err.Error()})
		return
	}
	if voteOnChain == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "On-chain vote record not found for wallet"})
		return
	}

	expectedVoteYes := req.Choice == "yes"
	if voteOnChain.VoteYes != expectedVoteYes {
		c.JSON(http.StatusConflict, gin.H{"error": "Vote choice does not match on-chain vote record"})
		return
	}

	proposalOnChain, err := oracle.ReadGovernanceProposal(c.Request.Context(), proposalPDA)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to read on-chain proposal state"})
		return
	}

	mirrorErr := db.Social().Transaction(func(tx *gorm.DB) error {
		var existingVote models.Vote
		err := tx.Where("proposal_id = ? AND voter_id = ?", proposalID, userID).First(&existingVote).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			newVote := models.Vote{
				ProposalID: proposalID,
				VoterID:    userID,
				Choice:     req.Choice,
				Power:      float64(voteOnChain.VotingPower),
			}
			if err := tx.Create(&newVote).Error; err != nil {
				return err
			}
		case err == nil:
			if err := tx.Model(&existingVote).Updates(map[string]interface{}{
				"choice": req.Choice,
				"power":  float64(voteOnChain.VotingPower),
			}).Error; err != nil {
				return err
			}
		default:
			return err
		}

		if err := tx.Model(&models.Proposal{}).Where("id = ?", proposalID).Updates(map[string]interface{}{
			"yes_votes":  float64(proposalOnChain.VoteYes),
			"no_votes":   float64(proposalOnChain.VoteNo),
			"status":     governanceProposalStatusFromOnChain(proposalOnChain.Status),
			"updated_at": time.Now(),
		}).Error; err != nil {
			return err
		}

		return nil
	})

	if mirrorErr != nil {
		logging.Warn().Err(mirrorErr).Str("proposal_id", proposalID.String()).Msg("castVote: on-chain verified, DB mirror failed")
		c.JSON(http.StatusAccepted, gin.H{
			"message":         "vote verified on-chain; db mirror pending reconciliation",
			"proposal_id":     proposalID,
			"proposal_pda":    proposalPDA.String(),
			"on_chain_tx_sig": req.OnChainTxSig,
			"warning":         mirrorErr.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":         "Vote verified and mirrored from chain",
		"proposal_id":     proposalID,
		"proposal_pda":    proposalPDA.String(),
		"on_chain_tx_sig": req.OnChainTxSig,
		"power":           float64(voteOnChain.VotingPower),
	})
}

// executeProposal processes a finished proposal
func executeProposal(c *gin.Context) {
	setAuthorityHeaders(c, authorityModeChainAuthoritative, "required", "mirror")

	report := solana.GetGovernanceExecutionCapabilityReport(c.Request.Context())
	if !report.Ready {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":                "governance chain execution is not ready",
			"governance_execution": report,
		})
		return
	}

	proposalID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid proposal ID"})
		return
	}

	oracle := solana.GetOracleClient()
	if oracle == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "oracle unavailable"})
		return
	}

	var pidBytes [16]byte
	copy(pidBytes[:], proposalID[:])
	proposalPDA, _, err := oracle.GetGovernanceProposalPDA(pidBytes)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to resolve proposal PDA"})
		return
	}

	txSig, err := oracle.FinalizeProposalOnChain(c.Request.Context(), proposalPDA)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "On-chain governance finalize failed: " + err.Error()})
		return
	}

	proposalOnChain, err := oracle.ReadGovernanceProposal(c.Request.Context(), proposalPDA)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to read on-chain proposal state"})
		return
	}

	mirrorErr := db.Social().Model(&models.Proposal{}).Where("id = ?", proposalID).Updates(map[string]interface{}{
		"yes_votes":  float64(proposalOnChain.VoteYes),
		"no_votes":   float64(proposalOnChain.VoteNo),
		"status":     governanceProposalStatusFromOnChain(proposalOnChain.Status),
		"updated_at": time.Now(),
	}).Error

	if mirrorErr != nil {
		logging.Warn().Err(mirrorErr).Str("proposal_id", proposalID.String()).Msg("executeProposal: on-chain finalized, DB mirror failed")
		c.JSON(http.StatusAccepted, gin.H{
			"message":      "proposal finalized on-chain; db mirror pending reconciliation",
			"proposal_id":  proposalID,
			"proposal_pda": proposalPDA.String(),
			"tx_sig":       txSig,
			"status":       governanceProposalStatusFromOnChain(proposalOnChain.Status),
			"yes":          proposalOnChain.VoteYes,
			"no":           proposalOnChain.VoteNo,
			"warning":      mirrorErr.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      "Proposal finalized from chain",
		"proposal_id":  proposalID,
		"proposal_pda": proposalPDA.String(),
		"tx_sig":       txSig,
		"status":       governanceProposalStatusFromOnChain(proposalOnChain.Status),
		"yes":          proposalOnChain.VoteYes,
		"no":           proposalOnChain.VoteNo,
	})
}

func governanceUserID(c *gin.Context) (uuid.UUID, bool) {
	userIDStr := c.GetString("userID")
	if userIDStr == "" {
		if uid, exists := c.Get("user_id"); exists {
			switch v := uid.(type) {
			case uuid.UUID:
				return v, true
			case string:
				userIDStr = v
			}
		}
	}
	parsed, err := uuid.Parse(userIDStr)
	if err != nil {
		return uuid.Nil, false
	}
	return parsed, true
}

func governanceUserWalletAddress(userID uuid.UUID) (string, error) {
	var user models.User
	if err := db.DB.Select("wallet_address").First(&user, "id = ?", userID).Error; err != nil {
		return "", fmt.Errorf("failed to resolve linked wallet")
	}
	if user.WalletAddress == nil || *user.WalletAddress == "" {
		return "", fmt.Errorf("link a Solana wallet before using governance write endpoints")
	}
	return *user.WalletAddress, nil
}

func governanceProposalStatusFromOnChain(status uint8) models.ProposalStatus {
	switch status {
	case 1:
		return models.ProposalPassed
	case 2:
		return models.ProposalRejected
	case 3:
		return models.ProposalExecuted
	default:
		return models.ProposalActive
	}
}

func governanceVotePowerRaw(ctx *gin.Context, oracle *solana.OracleClient, voterWallet sol.PublicKey) uint64 {
	const phbDecimals = uint64(1_000_000_000)
	var votingPower uint64 = 1

	mintStr := os.Getenv("PHB_TOKEN_MINT")
	if mintStr == "" {
		return votingPower
	}

	mintKey, err := solana.PublicKeyFromBase58String(mintStr)
	if err != nil {
		return votingPower
	}

	rawBalance, err := oracle.GetTokenBalance(ctx.Request.Context(), voterWallet, mintKey)
	if err != nil || rawBalance == 0 {
		return votingPower
	}

	if phbPower := rawBalance / phbDecimals; phbPower > 0 {
		votingPower = phbPower
	}

	return votingPower
}
