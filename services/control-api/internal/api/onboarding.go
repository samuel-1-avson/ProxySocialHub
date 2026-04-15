package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	solanaGo "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/geoip"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/solana"
	"gorm.io/gorm"
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
	Bandwidth string `json:"bandwidth" binding:"required"`
}

func providerMinimumBalanceSOL(ctx context.Context, oracle *solana.OracleClient) float64 {
	minBalanceSOL := 0.05

	if oracle != nil {
		if cfg, err := oracle.ReadProgramConfig(ctx); err == nil {
			minBalanceSOL = float64(cfg.KYCMinSOLLamports) / 1e9
		}
	}

	if minBalanceSOL == 0.05 {
		if manager := GetConfigManager(); manager != nil {
			if val, err := manager.Get("kyc.min_sol_balance"); err == nil {
				if f, err := strconv.ParseFloat(val, 64); err == nil {
					minBalanceSOL = f
				}
			}
		}
	}

	return minBalanceSOL
}

func solanaTokenLabel(network string) string {
	switch network {
	case "", "mainnet", "mainnet-beta":
		return "SOL"
	default:
		return fmt.Sprintf("%s SOL", network)
	}
}

// applyForProvider handles provider application submission
func applyForProvider(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var req ApplyProviderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 1. Check if already applied
	var existing models.ProviderApplication
	if err := db.DB.Where("user_id = ? AND status IN ('pending', 'approved')", userID).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "You already have a pending or approved application"})
		return
	}

	// 2. SOL Balance Check (Minimum 0.05 SOL)
	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User profile not found"})
		return
	}

	if user.WalletAddress == nil || *user.WalletAddress == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No wallet linked for verification"})
		return
	}

	oracle := solana.GetOracleClient()
	minBalanceSOL := providerMinimumBalanceSOL(c.Request.Context(), oracle)
	if oracle != nil {
		network := oracle.GetNetwork()
		if network == "" {
			network = "devnet"
		}
		tokenLabel := solanaTokenLabel(network)

		pubkey, err := solanaGo.PublicKeyFromBase58(*user.WalletAddress)
		if err == nil {
			balanceLamports, err := oracle.GetBalance(c.Request.Context(), pubkey)
			if err == nil {
				balanceSOL := float64(balanceLamports) / 1000000000.0
				if balanceSOL < minBalanceSOL {
					c.JSON(http.StatusBadRequest, gin.H{
						"error":          fmt.Sprintf("Insufficient balance. Minimum %.2f %s required.", minBalanceSOL, tokenLabel),
						"required_sol":   minBalanceSOL,
						"current_sol":    balanceSOL,
						"solana_network": network,
					})
					return
				}
			}
		}
	}

	// 3. ISP & Location Auto-Detection
	clientIP := c.ClientIP()
	geoResult, ok := geoip.Resolve(clientIP)

	finalISP := "Unknown ISP"
	finalLocation := "Unknown"

	if ok {
		finalISP = geoResult.ISP
		finalLocation = fmt.Sprintf("%s, %s", geoResult.City, geoResult.Country)
	}

	app := models.ProviderApplication{
		UserID:    userID,
		ISP:       finalISP,
		Location:  finalLocation,
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
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

	var app models.ProviderApplication
	if err := db.DB.Where("user_id = ?", userID).Order("created_at DESC").First(&app).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, gin.H{"status": "none", "application": nil})
			return
		}

		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch provider application status"})
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
