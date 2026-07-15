package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	solanaGo "github.com/gagliardetto/solana-go"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/geoip"
	"github.com/proxyhubb/control-api/internal/logging"
	"github.com/proxyhubb/control-api/internal/middleware"
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
	admin := rg.Group("/provider")
	admin.Use(middleware.RequireAdmin())
	{
		admin.GET("/applications", getPendingProviderApplications)
		admin.POST("/applications/:id/approve", approveProviderApplication)
		admin.POST("/applications/:id/reject", rejectProviderApplication)
	}
}

// ApplyProviderRequest is the request body
type ApplyProviderRequest struct {
	Bandwidth string `json:"bandwidth" binding:"required"`
}

type ProviderAutoApprovalResult struct {
	Status        string   `json:"status"`
	AutoApproved  bool     `json:"auto_approved"`
	ReasonCode    string   `json:"reason_code,omitempty"`
	Reason        string   `json:"reason,omitempty"`
	SolanaNetwork string   `json:"solana_network,omitempty"`
	RequiredSOL   float64  `json:"required_sol,omitempty"`
	CurrentSOL    *float64 `json:"current_sol,omitempty"`
}

type ProviderDetectedGeo struct {
	IP       string `json:"ip,omitempty"`
	ISP      string `json:"isp"`
	Location string `json:"location"`
	City     string `json:"city,omitempty"`
	Region   string `json:"region,omitempty"`
	Country  string `json:"country,omitempty"`
	Detected bool   `json:"detected"`
}

var evaluateProviderAutoApproval = defaultProviderAutoApproval

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

func defaultProviderAutoApproval(ctx context.Context, user *models.User) ProviderAutoApprovalResult {
	oracle := solana.GetOracleClient()
	network := solana.EffectiveSolanaNetwork()

	result := ProviderAutoApprovalResult{
		Status:        "pending",
		SolanaNetwork: network,
		RequiredSOL:   providerMinimumBalanceSOL(ctx, oracle),
	}

	if solana.IsMainnetNetwork(network) {
		return mainnetProviderAutoApproval(user, network, result)
	}

	if user == nil {
		result.Status = "rejected"
		result.ReasonCode = "user_not_found"
		result.Reason = "User profile is unavailable for provider verification."
		return result
	}

	if user.Status != models.UserStatusActive {
		result.Status = "rejected"
		result.ReasonCode = "account_not_active"
		result.Reason = "Only active accounts can be promoted to provider automatically."
		return result
	}

	if user.WalletAddress == nil || strings.TrimSpace(*user.WalletAddress) == "" {
		result.Status = "rejected"
		result.ReasonCode = "linked_wallet_required"
		result.Reason = "A linked Solana wallet is required for decentralized provider approval."
		return result
	}

	pubkey, err := solanaGo.PublicKeyFromBase58(strings.TrimSpace(*user.WalletAddress))
	if err != nil {
		result.Status = "rejected"
		result.ReasonCode = "invalid_wallet_address"
		result.Reason = "The linked wallet address is invalid and cannot be verified on-chain."
		return result
	}

	if oracle == nil {
		result.Status = "pending"
		result.ReasonCode = "verification_unavailable"
		result.Reason = "Automatic on-chain verification is temporarily unavailable. The application will be rechecked automatically."
		return result
	}

	balanceLamports, err := oracle.GetBalance(ctx, pubkey)
	if err != nil {
		result.Status = "pending"
		result.ReasonCode = "balance_check_failed"
		result.Reason = "The network balance check could not be completed. The application will be rechecked automatically."
		return result
	}

	currentSOL := solana.LamportsToSOL(balanceLamports)
	result.CurrentSOL = &currentSOL

	if currentSOL < result.RequiredSOL {
		result.Status = "rejected"
		result.ReasonCode = "insufficient_balance"
		result.Reason = fmt.Sprintf("Automatic approval requires at least %.2f %s in the linked wallet.", result.RequiredSOL, solanaTokenLabel(network))
		return result
	}

	result.Status = "approved"
	result.AutoApproved = true
	result.ReasonCode = "eligible"
	result.Reason = "All decentralized provider auto-approval constraints are satisfied."
	return result
}

// mainnetProviderAutoApproval requires completed identity KYC — no balance-only auto-approve.
func mainnetProviderAutoApproval(user *models.User, network string, result ProviderAutoApprovalResult) ProviderAutoApprovalResult {
	if user == nil {
		result.Status = "rejected"
		result.ReasonCode = "user_not_found"
		result.Reason = "User profile is unavailable for provider verification."
		return result
	}

	if user.Status != models.UserStatusActive {
		result.Status = "rejected"
		result.ReasonCode = "account_not_active"
		result.Reason = "Only active accounts can become providers on mainnet."
		return result
	}

	if user.WalletAddress == nil || strings.TrimSpace(*user.WalletAddress) == "" {
		result.Status = "rejected"
		result.ReasonCode = "linked_wallet_required"
		result.Reason = "Link a Solana payout wallet before applying as a provider on mainnet."
		return result
	}

	switch user.KYCStatus {
	case models.KYCStatusApproved:
		result.Status = "approved"
		result.AutoApproved = true
		result.ReasonCode = "kyc_verified"
		result.Reason = "Identity verification (KYC) is approved for mainnet provider access."
		return result
	case models.KYCStatusRejected:
		result.Status = "rejected"
		result.ReasonCode = "kyc_rejected"
		result.Reason = "Identity verification was rejected. Contact support to appeal."
		return result
	default:
		result.Status = "pending"
		result.ReasonCode = "kyc_required"
		result.Reason = "Complete identity verification (KYC) before mainnet provider approval. Balance-only auto-approval is disabled on mainnet."
		return result
	}
}

func upsertProviderApplication(tx *gorm.DB, app *models.ProviderApplication, userID uuid.UUID, isp, location, bandwidth string, decision ProviderAutoApprovalResult, now time.Time) error {
	app.UserID = userID
	app.ISP = isp
	app.Location = location
	app.Bandwidth = bandwidth
	app.Status = decision.Status
	app.ReviewerID = nil
	app.UpdatedAt = now

	if app.ID == uuid.Nil {
		app.CreatedAt = now
		return tx.Create(app).Error
	}

	return tx.Save(app).Error
}

func roleHasProviderAccess(role string) bool {
	switch role {
	case "provider", "admin", "superadmin", "moderator", "both":
		return true
	default:
		return false
	}
}

func ensureProviderRole(tx *gorm.DB, userID uuid.UUID) error {
	var user models.User
	if err := tx.Select("id", "role").First(&user, "id = ?", userID).Error; err != nil {
		return err
	}

	if roleHasProviderAccess(user.Role) {
		return nil
	}

	return tx.Model(&models.User{}).Where("id = ?", userID).Update("role", "provider").Error
}

func syncApprovedProviderRole(user *models.User) error {
	if user == nil || roleHasProviderAccess(user.Role) {
		return nil
	}

	var approvedCount int64
	if err := db.DB.Model(&models.ProviderApplication{}).
		Where("user_id = ? AND status = ?", user.ID, "approved").
		Count(&approvedCount).Error; err != nil {
		return err
	}
	if approvedCount == 0 {
		return nil
	}

	if err := ensureProviderRole(db.DB, user.ID); err != nil {
		return err
	}
	user.Role = "provider"
	return nil
}

// PromoteProviderApplicationAfterKYC re-evaluates a pending provider application after KYC approval (mainnet).
func PromoteProviderApplicationAfterKYC(ctx context.Context, userID uuid.UUID) {
	if !solana.IsMainnetNetwork(solana.EffectiveSolanaNetwork()) {
		return
	}

	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
		return
	}
	if user.KYCStatus != models.KYCStatusApproved {
		return
	}

	var app models.ProviderApplication
	if err := db.DB.Where("user_id = ?", userID).First(&app).Error; err != nil {
		return
	}
	if app.Status == "approved" {
		_ = ensureProviderRole(db.DB, userID)
		return
	}
	if app.Status != "pending" {
		return
	}

	decision := mainnetProviderAutoApproval(&user, solana.EffectiveSolanaNetwork(), ProviderAutoApprovalResult{
		SolanaNetwork: solana.EffectiveSolanaNetwork(),
	})
	if decision.Status != "approved" {
		return
	}

	now := time.Now()
	tx := db.DB.Begin()
	if err := upsertProviderApplication(tx, &app, userID, app.ISP, app.Location, app.Bandwidth, decision, now); err != nil {
		tx.Rollback()
		return
	}
	if err := ensureProviderRole(tx, userID); err != nil {
		tx.Rollback()
		return
	}
	if err := tx.Commit().Error; err != nil {
		return
	}

	_ = db.DB.Model(&models.ProviderNode{}).Where("user_id = ?", userID).Update("kyc_verified", true).Error
	logging.Info().Str("user_id", userID.String()).Msg("Provider application auto-approved after KYC")
}

func autoDecisionMessage(decision ProviderAutoApprovalResult) string {
	switch decision.Status {
	case "approved":
		return "Application approved automatically"
	case "pending":
		return "Application saved and is awaiting automatic verification"
	default:
		return "Application evaluated automatically"
	}
}

func autoDecisionStatusCode(decision ProviderAutoApprovalResult, existed bool) int {
	if decision.Status == "pending" {
		return http.StatusAccepted
	}
	if existed {
		return http.StatusOK
	}
	return http.StatusCreated
}

func syncApplicationDecision(user *models.User, app *models.ProviderApplication, decision ProviderAutoApprovalResult) error {
	tx := db.DB.Begin()
	if err := upsertProviderApplication(tx, app, user.ID, app.ISP, app.Location, app.Bandwidth, decision, time.Now()); err != nil {
		tx.Rollback()
		return err
	}

	if decision.Status == "approved" {
		if err := ensureProviderRole(tx, user.ID); err != nil {
			tx.Rollback()
			return err
		}
	}

	return tx.Commit().Error
}

func detectProviderGeo(c *gin.Context) ProviderDetectedGeo {
	clientIP := providerClientIP(c)
	effectiveIP := geoip.NormalizeIPForGeo(clientIP)
	if result, ok := geoip.Resolve(effectiveIP); ok {
		return ProviderDetectedGeo{
			IP:       effectiveIP,
			ISP:      firstNonEmpty(result.ISP, "Unknown ISP"),
			Location: providerGeoLocation(result),
			City:     result.City,
			Region:   result.Region,
			Country:  result.Country,
			Detected: true,
		}
	}

	return ProviderDetectedGeo{
		IP:       effectiveIP,
		ISP:      "Unknown ISP",
		Location: "Unknown",
		Detected: false,
	}
}

func providerClientIP(c *gin.Context) string {
	for _, header := range []string{"CF-Connecting-IP", "X-Real-IP", "X-Forwarded-For"} {
		value := strings.TrimSpace(c.GetHeader(header))
		if value == "" {
			continue
		}
		for _, candidate := range strings.Split(value, ",") {
			candidate = strings.TrimSpace(candidate)
			if candidate != "" && !geoip.NeedsPublicIPLookup(candidate) {
				return candidate
			}
		}
	}
	return c.ClientIP()
}

func providerGeoLocation(result geoip.Result) string {
	parts := []string{}
	if result.City != "" {
		parts = append(parts, result.City)
	} else if result.Region != "" {
		parts = append(parts, result.Region)
	}
	if result.Country != "" {
		parts = append(parts, result.Country)
	}
	if len(parts) == 0 {
		return "Unknown"
	}
	return strings.Join(parts, ", ")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
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

	// Load the current user profile for deterministic automatic evaluation.
	var user models.User
	if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User profile not found"})
		return
	}

	detectedGeo := detectProviderGeo(c)
	finalISP := detectedGeo.ISP
	finalLocation := detectedGeo.Location

	var app models.ProviderApplication
	existingErr := db.DB.Where("user_id = ?", userID).First(&app).Error
	exists := existingErr == nil
	if existingErr != nil && !errors.Is(existingErr, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch existing application"})
		return
	}

	if exists && app.Status == "approved" {
		if err := ensureProviderRole(db.DB, userID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to synchronize provider role"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"message":       "Application already approved",
			"application":   app,
			"auto_approved": app.ReviewerID == nil,
			"detected_geo":  detectedGeo,
		})
		return
	}

	decision := evaluateProviderAutoApproval(c.Request.Context(), &user)
	now := time.Now()
	app.ISP = finalISP
	app.Location = finalLocation
	app.Bandwidth = req.Bandwidth

	tx := db.DB.Begin()
	if !exists {
		app = models.ProviderApplication{}
	}
	if err := upsertProviderApplication(tx, &app, userID, finalISP, finalLocation, req.Bandwidth, decision, now); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to persist provider application"})
		return
	}

	if decision.Status == "approved" {
		if err := ensureProviderRole(tx, userID); err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update user role"})
			return
		}
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to finalize provider application"})
		return
	}

	c.JSON(autoDecisionStatusCode(decision, exists), gin.H{
		"message":       autoDecisionMessage(decision),
		"application":   app,
		"auto_approved": decision.AutoApproved,
		"eligibility":   decision,
		"detected_geo":  detectedGeo,
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
	if err := db.DB.Where("user_id = ?", userID).First(&app).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, gin.H{
				"status":       "none",
				"application":  nil,
				"detected_geo": detectProviderGeo(c),
			})
			return
		}

		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch provider application status"})
		return
	}

	if app.Status != "approved" {
		var user models.User
		if err := db.DB.First(&user, "id = ?", userID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "User profile not found"})
			return
		}

		decision := evaluateProviderAutoApproval(c.Request.Context(), &user)
		if decision.Status != app.Status || app.ReviewerID != nil {
			if err := syncApplicationDecision(&user, &app, decision); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to refresh provider application status"})
				return
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"status":        decision.Status,
			"application":   app,
			"auto_approved": decision.AutoApproved,
			"eligibility":   decision,
			"detected_geo":  detectProviderGeo(c),
		})
		return
	}

	if err := ensureProviderRole(db.DB, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to synchronize provider role"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":        app.Status,
		"application":   app,
		"auto_approved": app.ReviewerID == nil,
		"detected_geo":  detectProviderGeo(c),
	})
}

// Admin Handlers

func getPendingProviderApplications(c *gin.Context) {
	status := c.DefaultQuery("status", "pending")

	var apps []models.ProviderApplication
	if err := db.DB.Preload("User").Preload("Reviewer").Where("status = ?", status).Order("created_at asc").Find(&apps).Error; err != nil {
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

	reviewerID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
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
	app.ReviewerID = &reviewerID
	app.UpdatedAt = time.Now()
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
	c.JSON(http.StatusOK, gin.H{
		"message":     "Application approved and user role updated",
		"application": app,
	})
}

func rejectProviderApplication(c *gin.Context) {
	appID := c.Param("id")
	id, err := uuid.Parse(appID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid application ID"})
		return
	}

	reviewerID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
		return
	}

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

	app.Status = "rejected"
	app.ReviewerID = &reviewerID
	app.UpdatedAt = time.Now()
	if err := tx.Save(&app).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reject application"})
		return
	}

	tx.Commit()
	c.JSON(http.StatusOK, gin.H{
		"message":     "Application rejected",
		"application": app,
	})
}
