package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestApplyForProvider_AutoApprovesEligibleApplication(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "provider_applications", "wallets", "profiles")

	applicant := testutil.CreateTestUser(t, testutil.UniqueEmail("applicant"), "buyer")
	if err := db.DB.Model(&models.User{}).Where("id = ?", applicant.ID).Update("wallet_address", "9MpMTRvPxG1o2Jg6pR4Xy1Vh3sQzC6LzD6oJmNw5z7nA").Error; err != nil {
		t.Fatalf("Failed to set wallet address: %v", err)
	}

	original := evaluateProviderAutoApproval
	defer func() { evaluateProviderAutoApproval = original }()
	current := 1.25
	evaluateProviderAutoApproval = func(_ context.Context, _ *models.User) ProviderAutoApprovalResult {
		return ProviderAutoApprovalResult{
			Status:        "approved",
			AutoApproved:  true,
			ReasonCode:    "eligible",
			Reason:        "All decentralized provider auto-approval constraints are satisfied.",
			SolanaNetwork: "devnet",
			RequiredSOL:   0.05,
			CurrentSOL:    &current,
		}
	}

	r := setupTestRouter()
	protected := r.Group("/")
	protected.Use(func(c *gin.Context) {
		c.Set("user_id", applicant.ID)
		c.Set("userRole", applicant.Role)
		c.Next()
	})
	RegisterOnboardingRoutes(protected)

	req := httptest.NewRequest(http.MethodPost, "/provider/apply", bytes.NewBufferString(`{"bandwidth":"1Gbps Fiber"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("Expected status 201, got %d. Body: %s", w.Code, w.Body.String())
	}

	var response struct {
		Application  models.ProviderApplication `json:"application"`
		AutoApproved bool                       `json:"auto_approved"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if !response.AutoApproved {
		t.Fatalf("Expected auto_approved=true, got false")
	}

	if response.Application.Status != "approved" {
		t.Fatalf("Expected approved application status, got %s", response.Application.Status)
	}

	var updatedUser models.User
	if err := db.DB.First(&updatedUser, "id = ?", applicant.ID).Error; err != nil {
		t.Fatalf("Failed to reload applicant: %v", err)
	}

	if updatedUser.Role != "provider" {
		t.Fatalf("Expected applicant role provider, got %s", updatedUser.Role)
	}
}

func TestApplyForProvider_PersistsPendingWhenVerificationUnavailable(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "provider_applications", "wallets", "profiles")

	applicant := testutil.CreateTestUser(t, testutil.UniqueEmail("applicant"), "buyer")
	if err := db.DB.Model(&models.User{}).Where("id = ?", applicant.ID).Update("wallet_address", "7aq5Ywd5Q2z4L7n7jMhnnqF4o4LhZ3fxL3rq6iS9m6sR").Error; err != nil {
		t.Fatalf("Failed to set wallet address: %v", err)
	}

	original := evaluateProviderAutoApproval
	defer func() { evaluateProviderAutoApproval = original }()
	evaluateProviderAutoApproval = func(_ context.Context, _ *models.User) ProviderAutoApprovalResult {
		return ProviderAutoApprovalResult{
			Status:        "pending",
			ReasonCode:    "verification_unavailable",
			Reason:        "Automatic on-chain verification is temporarily unavailable. The application will be rechecked automatically.",
			SolanaNetwork: "devnet",
			RequiredSOL:   0.05,
		}
	}

	r := setupTestRouter()
	protected := r.Group("/")
	protected.Use(func(c *gin.Context) {
		c.Set("user_id", applicant.ID)
		c.Set("userRole", applicant.Role)
		c.Next()
	})
	RegisterOnboardingRoutes(protected)

	req := httptest.NewRequest(http.MethodPost, "/provider/apply", bytes.NewBufferString(`{"bandwidth":"250Mbps"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusAccepted {
		t.Fatalf("Expected status 202, got %d. Body: %s", w.Code, w.Body.String())
	}

	var response struct {
		Application models.ProviderApplication `json:"application"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.Application.Status != "pending" {
		t.Fatalf("Expected pending application status, got %s", response.Application.Status)
	}

	var updatedUser models.User
	if err := db.DB.First(&updatedUser, "id = ?", applicant.ID).Error; err != nil {
		t.Fatalf("Failed to reload applicant: %v", err)
	}

	if updatedUser.Role != "buyer" {
		t.Fatalf("Expected applicant role buyer, got %s", updatedUser.Role)
	}
}

func TestApplyForProvider_PersistsRejectedWhenConstraintsFail(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "provider_applications", "wallets", "profiles")

	applicant := testutil.CreateTestUser(t, testutil.UniqueEmail("applicant"), "buyer")

	original := evaluateProviderAutoApproval
	defer func() { evaluateProviderAutoApproval = original }()
	current := 0.01
	evaluateProviderAutoApproval = func(_ context.Context, _ *models.User) ProviderAutoApprovalResult {
		return ProviderAutoApprovalResult{
			Status:        "rejected",
			ReasonCode:    "insufficient_balance",
			Reason:        "Automatic approval requires at least 0.05 devnet SOL in the linked wallet.",
			SolanaNetwork: "devnet",
			RequiredSOL:   0.05,
			CurrentSOL:    &current,
		}
	}

	r := setupTestRouter()
	protected := r.Group("/")
	protected.Use(func(c *gin.Context) {
		c.Set("user_id", applicant.ID)
		c.Set("userRole", applicant.Role)
		c.Next()
	})
	RegisterOnboardingRoutes(protected)

	req := httptest.NewRequest(http.MethodPost, "/provider/apply", bytes.NewBufferString(`{"bandwidth":"500Mbps"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("Expected status 201, got %d. Body: %s", w.Code, w.Body.String())
	}

	var response struct {
		Application models.ProviderApplication `json:"application"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.Application.Status != "rejected" {
		t.Fatalf("Expected rejected application status, got %s", response.Application.Status)
	}

	var updatedUser models.User
	if err := db.DB.First(&updatedUser, "id = ?", applicant.ID).Error; err != nil {
		t.Fatalf("Failed to reload applicant: %v", err)
	}

	if updatedUser.Role != "buyer" {
		t.Fatalf("Expected applicant role buyer, got %s", updatedUser.Role)
	}
}

func TestGetProviderStatus_AutoApprovesLegacyPendingApplication(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "provider_applications", "wallets", "profiles")

	applicant := testutil.CreateTestUser(t, testutil.UniqueEmail("applicant"), "buyer")
	if err := db.DB.Model(&models.User{}).Where("id = ?", applicant.ID).Update("wallet_address", "3Cbq7aT1tY8gQK1Y9n4mCzX8MJn5p2qH4f3PLWfJ7bSe").Error; err != nil {
		t.Fatalf("Failed to set wallet address: %v", err)
	}

	app := models.ProviderApplication{
		ID:        uuid.New(),
		UserID:    applicant.ID,
		Status:    "pending",
		ISP:       "Test ISP",
		Location:  "Kampala, UG",
		Bandwidth: "300Mbps",
	}
	if err := db.DB.Create(&app).Error; err != nil {
		t.Fatalf("Failed to create provider application: %v", err)
	}

	original := evaluateProviderAutoApproval
	defer func() { evaluateProviderAutoApproval = original }()
	current := 0.8
	evaluateProviderAutoApproval = func(_ context.Context, _ *models.User) ProviderAutoApprovalResult {
		return ProviderAutoApprovalResult{
			Status:        "approved",
			AutoApproved:  true,
			ReasonCode:    "eligible",
			Reason:        "All decentralized provider auto-approval constraints are satisfied.",
			SolanaNetwork: "devnet",
			RequiredSOL:   0.05,
			CurrentSOL:    &current,
		}
	}

	r := setupTestRouter()
	protected := r.Group("/")
	protected.Use(func(c *gin.Context) {
		c.Set("user_id", applicant.ID)
		c.Set("userRole", applicant.Role)
		c.Next()
	})
	RegisterOnboardingRoutes(protected)

	req := httptest.NewRequest(http.MethodGet, "/provider/status", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	var response struct {
		Status      string                     `json:"status"`
		Application models.ProviderApplication `json:"application"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response.Status != "approved" {
		t.Fatalf("Expected status approved, got %s", response.Status)
	}

	var updatedApp models.ProviderApplication
	if err := db.DB.First(&updatedApp, "id = ?", app.ID).Error; err != nil {
		t.Fatalf("Failed to reload provider application: %v", err)
	}

	if updatedApp.Status != "approved" {
		t.Fatalf("Expected approved application status in DB, got %s", updatedApp.Status)
	}

	var updatedUser models.User
	if err := db.DB.First(&updatedUser, "id = ?", applicant.ID).Error; err != nil {
		t.Fatalf("Failed to reload applicant: %v", err)
	}

	if updatedUser.Role != "provider" {
		t.Fatalf("Expected applicant role provider, got %s", updatedUser.Role)
	}
}
