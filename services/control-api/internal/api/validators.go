package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterValidatorRoutes registers quality attestation validator routes
func RegisterValidatorRoutes(r *gin.RouterGroup) {
	validators := r.Group("/validators")
	{
		validators.POST("/register", registerValidator)
		validators.GET("", listValidators)
		validators.GET("/:id", getValidator)
		validators.GET("/me", getMyValidator)
		validators.POST("/attestations", submitAttestation)
		validators.GET("/attestations/provider/:providerId", getProviderAttestations)
		validators.GET("/consensus/:providerId", getProviderConsensus)
		validators.POST("/consensus/:providerId/start", startConsensusRound)
	}
}

// @Summary Register as a validator
// @Tags validators
// @Accept json
// @Produce json
// @Param request body models.ValidatorRegistrationRequest true "Registration"
// @Success 201 {object} models.Validator
// @Router /v1/validators/register [post]
func registerValidator(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var req models.ValidatorRegistrationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if already registered
	var existing models.Validator
	if err := db.DB.Where("user_id = ?", userID).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Already registered as validator"})
		return
	}

	// Check hotkey not already used
	if err := db.DB.Where("hotkey = ?", req.Hotkey).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Hotkey already registered"})
		return
	}

	validator := models.Validator{
		UserID:           userID.(uuid.UUID),
		Hotkey:           req.Hotkey,
		Coldkey:          req.Coldkey,
		NetUID:           req.NetUID,
		Status:           models.ValidatorPending,
		MinStakeRequired: 10.0, // 10 TAO minimum
	}

	if req.NetUID == 0 {
		validator.NetUID = 1 // Default subnet
	}

	if err := db.DB.Create(&validator).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to register validator"})
		return
	}

	c.JSON(http.StatusCreated, validator)
}

// @Summary List active validators
// @Tags validators
// @Produce json
// @Success 200 {array} models.Validator
// @Router /v1/validators [get]
func listValidators(c *gin.Context) {
	var validators []models.Validator

	query := db.DB.Where("status = ?", models.ValidatorActive)

	// Optional filters
	if netUID := c.Query("net_uid"); netUID != "" {
		query = query.Where("net_uid = ?", netUID)
	}

	if err := query.Order("trust_score DESC").Limit(100).Find(&validators).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch validators"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"validators": validators, "count": len(validators)})
}

// @Summary Get validator by ID
// @Tags validators
// @Param id path string true "Validator ID"
// @Produce json
// @Success 200 {object} models.Validator
// @Router /v1/validators/{id} [get]
func getValidator(c *gin.Context) {
	validatorID := c.Param("id")

	var validator models.Validator
	if err := db.DB.Where("id = ?", validatorID).First(&validator).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Validator not found"})
		return
	}

	c.JSON(http.StatusOK, validator)
}

// @Summary Get my validator profile
// @Tags validators
// @Produce json
// @Success 200 {object} models.Validator
// @Router /v1/validators/me [get]
func getMyValidator(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var validator models.Validator
	if err := db.DB.Where("user_id = ?", userID).First(&validator).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Not registered as validator"})
		return
	}

	c.JSON(http.StatusOK, validator)
}

// @Summary Submit quality attestation
// @Tags validators
// @Accept json
// @Produce json
// @Param request body models.CreateAttestationRequest true "Attestation"
// @Success 201 {object} models.QualityAttestation
// @Router /v1/validators/attestations [post]
func submitAttestation(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var req models.CreateAttestationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get validator
	var validator models.Validator
	if err := db.DB.Where("user_id = ?", userID).First(&validator).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not registered as validator"})
		return
	}

	// Check if can validate
	if !validator.CanValidate() {
		c.JSON(http.StatusForbidden, gin.H{
			"error":  "Validator not eligible",
			"status": validator.Status,
			"staked": validator.StakedAmount,
			"trust":  validator.TrustScore,
		})
		return
	}

	// Check provider exists
	var provider models.User
	if err := db.DB.Where("id = ?", req.ProviderID).First(&provider).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Provider not found"})
		return
	}

	// Create attestation
	attestation := models.QualityAttestation{
		ValidatorID:           validator.ID,
		ProviderID:            req.ProviderID,
		NodeID:                req.NodeID,
		LatencyScore:          req.LatencyScore,
		UptimeScore:           req.UptimeScore,
		SuccessRateScore:      req.SuccessRateScore,
		BandwidthScore:        req.BandwidthScore,
		MeasuredLatencyMs:     req.MeasuredLatencyMs,
		MeasuredUptimePct:     req.MeasuredUptimePct,
		MeasuredSuccessRate:   req.MeasuredSuccessRate,
		MeasuredBandwidthMbps: req.MeasuredBandwidthMbps,
		Signature:             req.Signature,
		CreatedAt:             time.Now(),
	}

	// Set message hash
	attestation.SetMessageHash()

	// Verify signature
	valid, err := attestation.VerifySignature(validator.Hotkey)
	if err != nil || !valid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid signature"})
		return
	}

	// Find active consensus round or create one
	var consensusRound models.ConsensusRound
	err = db.DB.Where("provider_id = ? AND consensus_reached = false AND expires_at > ?",
		req.ProviderID, time.Now()).First(&consensusRound).Error

	if err != nil {
		// Create new round
		consensusRound = models.ConsensusRound{
			ProviderID:    req.ProviderID,
			NodeID:        req.NodeID,
			MinValidators: 3,
			MaxDeviation:  15.0,
		}
		db.DB.Create(&consensusRound)
	}

	attestation.ConsensusRoundID = &consensusRound.ID

	if err := db.DB.Create(&attestation).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save attestation"})
		return
	}

	// Update validator stats
	validator.TotalAttestations++
	now := time.Now()
	validator.LastActiveAt = &now
	db.DB.Save(&validator)

	// Check if consensus can be reached
	var attestations []models.QualityAttestation
	db.DB.Where("consensus_round_id = ?", consensusRound.ID).Find(&attestations)

	if len(attestations) >= consensusRound.MinValidators {
		consensusRound.CalculateConsensus(attestations)
		db.DB.Save(&consensusRound)

		// Update provider's quality score if consensus reached
		if consensusRound.ConsensusReached {
			updateProviderQuality(req.ProviderID, consensusRound.ConsensusScore)
		}
	}

	c.JSON(http.StatusCreated, gin.H{
		"attestation":     attestation,
		"consensus_round": consensusRound,
	})
}

// updateProviderQuality updates a provider's quality score based on consensus
func updateProviderQuality(providerID uuid.UUID, consensusScore float64) {
	// Update all active listings by this provider
	db.DB.Model(&models.ProxyListing{}).
		Where("seller_id = ? AND status = ?", providerID, models.ListingStatusActive).
		Update("quality_score", consensusScore)
}

// @Summary Get attestations for a provider
// @Tags validators
// @Param providerId path string true "Provider ID"
// @Produce json
// @Success 200 {array} models.QualityAttestation
// @Router /v1/validators/attestations/provider/{providerId} [get]
func getProviderAttestations(c *gin.Context) {
	providerID := c.Param("providerId")

	var attestations []models.QualityAttestation
	if err := db.DB.Where("provider_id = ?", providerID).
		Preload("Validator").
		Order("created_at DESC").
		Limit(50).
		Find(&attestations).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch attestations"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"attestations": attestations})
}

// @Summary Get consensus score for a provider
// @Tags validators
// @Param providerId path string true "Provider ID"
// @Produce json
// @Success 200 {object} models.ConsensusRound
// @Router /v1/validators/consensus/{providerId} [get]
func getProviderConsensus(c *gin.Context) {
	providerID := c.Param("providerId")

	// Get most recent completed consensus round
	var round models.ConsensusRound
	if err := db.DB.Where("provider_id = ? AND consensus_reached = true", providerID).
		Order("finalized_at DESC").
		First(&round).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No consensus round found"})
		return
	}

	c.JSON(http.StatusOK, round)
}

// @Summary Start a new consensus round
// @Tags validators
// @Param providerId path string true "Provider ID"
// @Produce json
// @Success 201 {object} models.ConsensusRound
// @Router /v1/validators/consensus/{providerId}/start [post]
func startConsensusRound(c *gin.Context) {
	providerID := c.Param("providerId")

	// Check for active round
	var existing models.ConsensusRound
	if err := db.DB.Where("provider_id = ? AND consensus_reached = false AND expires_at > ?",
		providerID, time.Now()).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{
			"error":      "Active round exists",
			"round":      existing,
			"expires_at": existing.ExpiresAt,
		})
		return
	}

	providerUUID, err := uuid.Parse(providerID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid provider ID"})
		return
	}

	round := models.ConsensusRound{
		ProviderID:    providerUUID,
		MinValidators: 3,
		MaxDeviation:  15.0,
	}

	if err := db.DB.Create(&round).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create round"})
		return
	}

	c.JSON(http.StatusCreated, round)
}
