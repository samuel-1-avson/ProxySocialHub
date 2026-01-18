package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterOnboardingRoutes registers onboarding routes
func RegisterOnboardingRoutes(rg *gin.RouterGroup) {
	rg.POST("/provider/apply", applyForProvider)
	rg.GET("/provider/status", getProviderStatus)
}

// RegisterAdminOnboardingRoutes registers admin onboarding routes
func RegisterAdminOnboardingRoutes(rg *gin.RouterGroup) {
	rg.GET("/provider/applications", getPendingProviderApplications)
	rg.POST("/provider/applications/:id/approve", approveProviderApplication)
	rg.POST("/provider/applications/:id/reject", rejectProviderApplication)
}

// ApplyProviderRequest is the request body
type ApplyProviderRequest struct {
	Reason    string `json:"reason" binding:"required,min=10,max=500"`
	ISP       string `json:"isp" binding:"required"`
	Location  string `json:"location" binding:"required"`
	Bandwidth string `json:"bandwidth" binding:"required"`
}

// applyForProvider handles provider application submission
func applyForProvider(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID, _ := uuid.Parse(currentUserID.(string))

	var req ApplyProviderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if already applied
	var existing models.ProviderApplication
	if err := db.DB.Where("user_id = ? AND status IN ('pending', 'approved')", userID).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "You already have a pending or approved application"})
		return
	}

	app := models.ProviderApplication{
		UserID:    userID,
		Reason:    req.Reason,
		ISP:       req.ISP,
		Location:  req.Location,
		Bandwidth: req.Bandwidth,
		Status:    "pending",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := db.DB.Create(&app).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit application"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":     "Application submitted successfully",
		"application": app,
	})
}

// getProviderStatus returns the application status
func getProviderStatus(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID, _ := uuid.Parse(currentUserID.(string))

	var app models.ProviderApplication
	if err := db.DB.Where("user_id = ?", userID).Order("created_at DESC").First(&app).Error; err != nil {
		// No application found
		c.JSON(http.StatusNotFound, gin.H{"status": "none"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":      app.Status,
		"application": app,
	})
}

// Admin Handlers

func getPendingProviderApplications(c *gin.Context) {
	status := c.DefaultQuery("status", "pending")

	var apps []models.ProviderApplication
	if err := db.DB.Preload("User").Where("status = ?", status).Order("created_at asc").Find(&apps).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch applications"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"applications": apps})
}

func approveProviderApplication(c *gin.Context) {
	appID := c.Param("id")
	id, err := uuid.Parse(appID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid application ID"})
		return
	}

	// Start transaction
	tx := db.DB.Begin()

	var app models.ProviderApplication
	if err := tx.First(&app, id).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusNotFound, gin.H{"error": "Application not found"})
		return
	}

	if app.Status != "pending" {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Application is not pending"})
		return
	}

	// Update Application Status
	app.Status = "approved"
	if err := tx.Save(&app).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update application"})
		return
	}

	// Update User Role to "provider"
	if err := tx.Model(&models.User{}).Where("id = ?", app.UserID).Update("role", "provider").Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update user role"})
		return
	}

	tx.Commit()
	c.JSON(http.StatusOK, gin.H{"message": "Application approved and user role updated"})
}

func rejectProviderApplication(c *gin.Context) {
	appID := c.Param("id")
	id, err := uuid.Parse(appID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid application ID"})
		return
	}

	var app models.ProviderApplication
	if err := db.DB.First(&app, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Application not found"})
		return
	}

	if app.Status != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Application is not pending"})
		return
	}

	app.Status = "rejected"
	if err := db.DB.Save(&app).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reject application"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Application rejected"})
}
