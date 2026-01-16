package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

func RegisterKycRoutes(r *gin.RouterGroup) {
	kyc := r.Group("/kyc")
	{
		kyc.GET("/status", getKycStatus)
		kyc.POST("/start", startKyc)
		kyc.POST("/submit", submitKycDocuments)
		kyc.POST("/webhook", handleKycWebhook) // Public endpoint for KYC provider callbacks
	}
}

// KYC Status Response
type KycStatusResponse struct {
	Status          models.KYCStatus `json:"status"`
	IsVerified      bool             `json:"is_verified"`
	IsPending       bool             `json:"is_pending"`
	SubmittedAt     *time.Time       `json:"submitted_at,omitempty"`
	ReviewedAt      *time.Time       `json:"reviewed_at,omitempty"`
	RejectionReason string           `json:"rejection_reason,omitempty"`
	VerificationURL string           `json:"verification_url,omitempty"`
}

// getKycStatus returns the current KYC verification status for the user
func getKycStatus(c *gin.Context) {
	userID := c.GetString("userID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var verification models.KycVerification
	result := db.DB.Where("user_id = ?", userUUID).Order("created_at DESC").First(&verification)
	
	if result.Error != nil {
		// No KYC record found - user hasn't started
		c.JSON(http.StatusOK, KycStatusResponse{
			Status:     models.KYCStatusNotStarted,
			IsVerified: false,
			IsPending:  false,
		})
		return
	}

	c.JSON(http.StatusOK, KycStatusResponse{
		Status:          verification.Status,
		IsVerified:      verification.IsVerified(),
		IsPending:       verification.IsPending(),
		SubmittedAt:     verification.SubmittedAt,
		ReviewedAt:      verification.ReviewedAt,
		RejectionReason: verification.Data.RejectionReason,
		VerificationURL: verification.Data.VerificationURL,
	})
}

type StartKycRequest struct {
	Provider     string `json:"provider"` // "sumsub" or "manual"
	DocumentType string `json:"document_type" binding:"required"`
}

// startKyc initiates the KYC verification process
func startKyc(c *gin.Context) {
	userID := c.GetString("userID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var req StartKycRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check for existing KYC
	var existing models.KycVerification
	if db.DB.Where("user_id = ?", userUUID).First(&existing).Error == nil {
		if existing.Status == models.KYCStatusApproved {
			c.JSON(http.StatusConflict, gin.H{"error": "KYC already verified"})
			return
		}
		if existing.IsPending() {
			c.JSON(http.StatusConflict, gin.H{
				"error":            "KYC already in progress",
				"verification_url": existing.Data.VerificationURL,
			})
			return
		}
	}

	// Determine provider
	provider := models.KYCProviderManual
	if req.Provider == "sumsub" {
		provider = models.KYCProviderSumSub
	}

	// Generate verification URL (placeholder for actual provider integration)
	verificationURL := fmt.Sprintf("https://kyc.proxyhubb.com/verify/%s", uuid.New().String())
	
	// Create KYC record
	now := time.Now()
	verification := models.KycVerification{
		UserID:   userUUID,
		Status:   models.KYCStatusPending,
		Provider: provider,
		Data: models.KYCData{
			DocumentType:    models.DocumentType(req.DocumentType),
			VerificationURL: verificationURL,
		},
		SubmittedAt: &now,
	}

	// For SumSub, we would call their API here to create an applicant
	if provider == models.KYCProviderSumSub {
		// TODO: Integrate with SumSub API
		// applicantID, err := sumsub.CreateApplicant(userID, email)
		// verification.ApplicantID = applicantID
		verification.ApplicantID = "sumsub-placeholder-" + uuid.New().String()[:8]
	}

	if result := db.DB.Create(&verification); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to start KYC"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":               verification.ID,
		"status":           verification.Status,
		"verification_url": verificationURL,
		"message":          "KYC verification started. Please complete the verification process.",
	})
}

type SubmitDocumentsRequest struct {
	FirstName      string `json:"first_name" binding:"required"`
	LastName       string `json:"last_name" binding:"required"`
	DateOfBirth    string `json:"date_of_birth" binding:"required"`
	DocumentType   string `json:"document_type" binding:"required"`
	DocumentNumber string `json:"document_number" binding:"required"`
	DocumentExpiry string `json:"document_expiry"`
	PhoneNumber    string `json:"phone_number" binding:"required"`
	Address        string `json:"address"`
}

// submitKycDocuments handles document submission for manual verification
func submitKycDocuments(c *gin.Context) {
	userID := c.GetString("userID")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var req SubmitDocumentsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var verification models.KycVerification
	if result := db.DB.Where("user_id = ?", userUUID).First(&verification); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No KYC verification found. Please start KYC first."})
		return
	}

	if verification.Status == models.KYCStatusApproved {
		c.JSON(http.StatusConflict, gin.H{"error": "KYC already verified"})
		return
	}

	// Update verification data
	verification.Data.FirstName = req.FirstName
	verification.Data.LastName = req.LastName
	verification.Data.DateOfBirth = req.DateOfBirth
	verification.Data.DocumentType = models.DocumentType(req.DocumentType)
	verification.Data.DocumentNumber = req.DocumentNumber
	verification.Data.DocumentExpiry = req.DocumentExpiry
	verification.Data.PhoneNumber = req.PhoneNumber
	verification.Data.Address = req.Address
	verification.Data.Country = "GH" // Default to Ghana
	verification.Status = models.KYCStatusInReview

	now := time.Now()
	verification.SubmittedAt = &now

	if result := db.DB.Save(&verification); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit documents"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":      verification.ID,
		"status":  verification.Status,
		"message": "Documents submitted successfully. Your verification is under review.",
	})
}

// KYC Webhook payload (for external KYC providers)
type KycWebhookPayload struct {
	ApplicantID     string `json:"applicantId"`
	InspectionID    string `json:"inspectionId"`
	CorrelationID   string `json:"correlationId"`
	ExternalUserID  string `json:"externalUserId"`
	Type            string `json:"type"`
	ReviewResult    string `json:"reviewResult"` // "GREEN", "RED"
	ReviewStatus    string `json:"reviewStatus"` // "completed", "pending"
	RejectLabels    []string `json:"rejectLabels,omitempty"`
}

// handleKycWebhook processes callbacks from KYC providers (SumSub, etc.)
func handleKycWebhook(c *gin.Context) {
	var payload KycWebhookPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Find verification by applicant ID
	var verification models.KycVerification
	if result := db.DB.Where("applicant_id = ?", payload.ApplicantID).First(&verification); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Verification not found"})
		return
	}

	now := time.Now()
	verification.ReviewedAt = &now

	switch payload.ReviewResult {
	case "GREEN":
		verification.Status = models.KYCStatusApproved
	case "RED":
		verification.Status = models.KYCStatusRejected
		if len(payload.RejectLabels) > 0 {
			verification.Data.RejectionReason = fmt.Sprintf("Rejected: %v", payload.RejectLabels)
		}
	default:
		verification.Status = models.KYCStatusInReview
	}

	if result := db.DB.Save(&verification); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update verification"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "processed"})
}

// ========== Admin Functions ==========

// AdminApproveKyc allows admins to manually approve KYC
func AdminApproveKyc(c *gin.Context) {
	verificationID := c.Param("id")
	adminID := c.GetString("userID")

	var verification models.KycVerification
	if result := db.DB.First(&verification, "id = ?", verificationID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Verification not found"})
		return
	}

	now := time.Now()
	verification.Status = models.KYCStatusApproved
	verification.ReviewedAt = &now
	verification.ReviewedBy = adminID

	if result := db.DB.Save(&verification); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to approve"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "approved", "id": verification.ID})
}

type AdminRejectRequest struct {
	Reason string `json:"reason" binding:"required"`
}

// AdminRejectKyc allows admins to manually reject KYC
func AdminRejectKyc(c *gin.Context) {
	verificationID := c.Param("id")
	adminID := c.GetString("userID")

	var req AdminRejectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var verification models.KycVerification
	if result := db.DB.First(&verification, "id = ?", verificationID); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Verification not found"})
		return
	}

	now := time.Now()
	verification.Status = models.KYCStatusRejected
	verification.ReviewedAt = &now
	verification.ReviewedBy = adminID
	verification.Data.RejectionReason = req.Reason

	if result := db.DB.Save(&verification); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reject"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "rejected", "id": verification.ID})
}

// GetPendingKycVerifications returns all pending KYC verifications for admin review
func GetPendingKycVerifications(c *gin.Context) {
	var verifications []models.KycVerification
	if result := db.DB.Where("status IN ?", []models.KYCStatus{
		models.KYCStatusPending,
		models.KYCStatusInReview,
	}).Order("created_at ASC").Find(&verifications); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch verifications"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"verifications": verifications,
		"count":         len(verifications),
	})
}
