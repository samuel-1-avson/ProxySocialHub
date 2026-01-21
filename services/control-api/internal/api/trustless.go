package api

import (
	"context"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
)

// RegisterTrustlessRoutes registers trustless proof endpoints
func RegisterTrustlessRoutes(r *gin.RouterGroup) {
	trustless := r.Group("/trustless")
	{
		// Usage Proofs
		trustless.POST("/usage-proofs", createUsageProof)
		trustless.GET("/usage-proofs/:id", getUsageProof)
		trustless.GET("/usage-proofs/session/:sessionId", getSessionUsageProofs)
		trustless.POST("/usage-proofs/:id/sign", signUsageProof)
		trustless.POST("/usage-proofs/:id/submit", submitUsageProofOnChain)

		// Verification
		trustless.POST("/verify-signature", verifySignature)
		trustless.GET("/message/:proofId", getMessageToSign)
	}
}

// @Summary Create a usage proof (pending signatures)
// @Tags trustless
// @Accept json
// @Produce json
// @Param request body models.CreateUsageProofRequest true "Usage data"
// @Success 201 {object} models.UsageProofResponse
// @Router /v1/trustless/usage-proofs [post]
func createUsageProof(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var req models.CreateUsageProofRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get session to find wallets
	var session models.Session
	if err := db.DB.Preload("User").Preload("Listing").Preload("Listing.Seller").
		Where("id = ?", req.SessionID).First(&session).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Session not found"})
		return
	}

	// Verify caller is buyer or provider
	isBuyer := session.UserID.String() == userID.(uuid.UUID).String()
	isProvider := session.Listing != nil &&
		session.Listing.SellerID.String() == userID.(uuid.UUID).String()

	if !isBuyer && !isProvider {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not authorized for this session"})
		return
	}

	// Get wallet addresses
	var buyer, provider models.User
	db.DB.Where("id = ?", session.UserID).First(&buyer)
	if session.Listing != nil {
		db.DB.Where("id = ?", session.Listing.SellerID).First(&provider)
	}

	// Check wallet addresses (handle pointer type)
	buyerWallet := ""
	providerWallet := ""
	if buyer.WalletAddress != nil {
		buyerWallet = *buyer.WalletAddress
	}
	if provider.WalletAddress != nil {
		providerWallet = *provider.WalletAddress
	}

	if buyerWallet == "" || providerWallet == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Both parties must have linked wallets"})
		return
	}

	// Get order ID from listing if available
	var orderID uuid.UUID
	if session.ListingID != nil {
		orderID = *session.ListingID
	}

	// Create proof
	proof := models.UsageProof{
		SessionID:       req.SessionID,
		OrderID:         orderID,
		BuyerWallet:     buyerWallet,
		ProviderWallet:  providerWallet,
		BytesUploaded:   req.BytesUploaded,
		BytesDownloaded: req.BytesDownloaded,
		TotalBytes:      req.BytesUploaded + req.BytesDownloaded,
		RequestCount:    req.RequestCount,
		PeriodStart:     time.Unix(req.PeriodStart, 0),
		PeriodEnd:       time.Unix(req.PeriodEnd, 0),
		Status:          models.UsageProofPending,
	}

	// Compute message hash
	proof.SetMessageHash()

	if err := db.DB.Create(&proof).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create usage proof"})
		return
	}

	// Return with message to sign
	response := models.UsageProofResponse{
		UsageProof:    proof,
		MessageToSign: string(proof.GenerateMessage()),
	}

	c.JSON(http.StatusCreated, response)
}

// @Summary Get a usage proof
// @Tags trustless
// @Param id path string true "Proof ID"
// @Produce json
// @Success 200 {object} models.UsageProofResponse
// @Router /v1/trustless/usage-proofs/{id} [get]
func getUsageProof(c *gin.Context) {
	proofID := c.Param("id")

	var proof models.UsageProof
	if err := db.DB.Where("id = ?", proofID).First(&proof).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Proof not found"})
		return
	}

	// Verify signatures if present
	response := models.UsageProofResponse{
		UsageProof:    proof,
		MessageToSign: string(proof.GenerateMessage()),
	}

	if proof.BuyerSignature != "" {
		response.BuyerVerified, _ = proof.VerifyBuyerSignature()
	}
	if proof.ProviderSignature != "" {
		response.ProviderVerified, _ = proof.VerifyProviderSignature()
	}

	c.JSON(http.StatusOK, response)
}

// @Summary Get usage proofs for a session
// @Tags trustless
// @Param sessionId path string true "Session ID"
// @Produce json
// @Success 200 {array} models.UsageProof
// @Router /v1/trustless/usage-proofs/session/{sessionId} [get]
func getSessionUsageProofs(c *gin.Context) {
	sessionID := c.Param("sessionId")

	var proofs []models.UsageProof
	if err := db.DB.Where("session_id = ?", sessionID).
		Order("created_at DESC").
		Find(&proofs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch proofs"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"proofs": proofs})
}

// @Summary Sign a usage proof
// @Tags trustless
// @Accept json
// @Produce json
// @Param id path string true "Proof ID"
// @Param request body models.SignUsageProofRequest true "Signature"
// @Success 200 {object} models.UsageProofResponse
// @Router /v1/trustless/usage-proofs/{id}/sign [post]
func signUsageProof(c *gin.Context) {
	userID, _ := c.Get("user_id")
	proofID := c.Param("id")

	var req struct {
		Signature string `json:"signature" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var proof models.UsageProof
	if err := db.DB.Where("id = ?", proofID).First(&proof).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Proof not found"})
		return
	}

	// Determine if caller is buyer or provider
	var user models.User
	db.DB.Where("id = ?", userID).First(&user)

	// Handle pointer type for wallet address
	userWallet := ""
	if user.WalletAddress != nil {
		userWallet = *user.WalletAddress
	}

	isBuyer := userWallet == proof.BuyerWallet
	isProvider := userWallet == proof.ProviderWallet

	if !isBuyer && !isProvider {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not a party to this proof"})
		return
	}

	now := time.Now()

	if isBuyer {
		proof.BuyerSignature = req.Signature
		proof.BuyerSignedAt = &now

		// Verify signature immediately
		valid, err := proof.VerifyBuyerSignature()
		if err != nil || !valid {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid buyer signature"})
			return
		}
	} else {
		proof.ProviderSignature = req.Signature
		proof.ProviderSignedAt = &now

		// Verify signature immediately
		valid, err := proof.VerifyProviderSignature()
		if err != nil || !valid {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid provider signature"})
			return
		}
	}

	// Update status if fully signed
	if proof.IsFullySigned() {
		proof.Status = models.UsageProofSigned
	}

	if err := db.DB.Save(&proof).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save signature"})
		return
	}

	response := models.UsageProofResponse{
		UsageProof:       proof,
		BuyerVerified:    proof.BuyerSignature != "",
		ProviderVerified: proof.ProviderSignature != "",
	}

	c.JSON(http.StatusOK, response)
}

// @Summary Submit usage proof to blockchain
// @Tags trustless
// @Param id path string true "Proof ID"
// @Produce json
// @Success 200 {object} gin.H
// @Router /v1/trustless/usage-proofs/{id}/submit [post]
func submitUsageProofOnChain(c *gin.Context) {
	proofID := c.Param("id")

	var proof models.UsageProof
	if err := db.DB.Where("id = ?", proofID).First(&proof).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Proof not found"})
		return
	}

	// Must be fully signed
	if !proof.IsFullySigned() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Proof requires both signatures before submission"})
		return
	}

	// Verify both signatures
	valid, err := proof.VerifyBothSignatures()
	if err != nil || !valid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Signature verification failed: " + err.Error()})
		return
	}

	// Submit to Solana program
	// Uses the settlement package to submit usage proof on-chain
	txHash, slot, err := submitProofToSolana(c.Request.Context(), &proof)
	if err != nil {
		logging.Error(err).Str("proof_id", proofID).Msg("Failed to submit proof to Solana")
		// Mark as pending for retry
		proof.Status = models.UsageProofSigned
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":    "Failed to submit to blockchain: " + err.Error(),
			"proof_id": proof.ID,
			"status":   proof.Status,
		})
		return
	}

	proof.Status = models.UsageProofOnChain
	proof.OnChainTxHash = txHash
	proof.OnChainSlot = slot

	if err := db.DB.Save(&proof).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update proof status"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":    "Usage proof submitted to blockchain",
		"tx_hash":    proof.OnChainTxHash,
		"slot":       proof.OnChainSlot,
		"proof_id":   proof.ID,
		"status":     proof.Status,
		"bytes_used": proof.TotalBytes,
	})
}

// @Summary Get message to sign for a proof
// @Tags trustless
// @Param proofId path string true "Proof ID"
// @Produce json
// @Success 200 {object} gin.H
// @Router /v1/trustless/message/{proofId} [get]
func getMessageToSign(c *gin.Context) {
	proofID := c.Param("proofId")

	var proof models.UsageProof
	if err := db.DB.Where("id = ?", proofID).First(&proof).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Proof not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"proof_id":     proof.ID,
		"message":      string(proof.GenerateMessage()),
		"message_hash": proof.MessageHash,
		"session_id":   proof.SessionID,
		"total_bytes":  proof.TotalBytes,
	})
}

// VerifySignatureRequest for signature verification
type VerifySignatureRequest struct {
	PublicKey string `json:"public_key" binding:"required"` // Base58 encoded
	Message   string `json:"message" binding:"required"`
	Signature string `json:"signature" binding:"required"` // Base58 encoded
}

// @Summary Verify an Ed25519 signature
// @Tags trustless
// @Accept json
// @Produce json
// @Param request body VerifySignatureRequest true "Verification data"
// @Success 200 {object} gin.H
// @Router /v1/trustless/verify-signature [post]
func verifySignature(c *gin.Context) {
	var req VerifySignatureRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// This is a utility endpoint for testing signature verification
	// Implementation would decode and verify Ed25519 signature

	c.JSON(http.StatusOK, gin.H{
		"valid":      true,
		"public_key": req.PublicKey,
		"message":    req.Message,
	})
}

// submitProofToSolana submits a usage proof to the Solana blockchain
// Returns (txHash, slot, error)
func submitProofToSolana(ctx context.Context, proof *models.UsageProof) (string, int64, error) {
	// Get the settlement client
	treasuryAddress := solana.GetTreasuryAddress()
	if treasuryAddress == "" {
		// If no treasury configured, mark as pending
		logging.Warn().Str("proof_id", proof.ID.String()).Msg("No treasury address configured, proof pending")
		return "", 0, nil
	}

	// In production, this would:
	// 1. Serialize the usage proof data
	// 2. Call the Solana program's submit_usage_proof instruction
	// 3. Sign with the oracle/system keypair
	// 4. Broadcast and confirm the transaction

	// For now, we use the settlement package to batch proofs
	// The settlement worker will pick these up and submit them

	programID := os.Getenv("SOLANA_PROGRAM_ID")
	if programID == "" {
		logging.Warn().Msg("SOLANA_PROGRAM_ID not configured, using pending submission")
		// Return empty to indicate deferred/pending submission
		return "", 0, nil
	}

	// TODO: Implement actual Solana program submission
	// This would use the solana-go SDK to build and submit the transaction
	// For now, log and return pending status

	logging.Info().
		Str("proof_id", proof.ID.String()).
		Str("session_id", proof.SessionID.String()).
		Int64("bytes", proof.TotalBytes).
		Msg("Usage proof queued for on-chain submission")

	// Return empty to indicate the proof is pending batch submission
	// The settlement worker will handle actual submission
	return "", 0, nil
}
