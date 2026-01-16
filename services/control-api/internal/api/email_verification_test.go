package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// TestVerifyEmail_Success tests successful email verification
func TestVerifyEmail_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	// Create unverified user with verification token
	token := "test-verification-token-success-" + testutil.UniqueEmail("verify")
	expires := time.Now().Add(24 * time.Hour)

	user := &models.User{
		Email:                    testutil.UniqueEmail("verify"),
		PasswordHash:             testutil.HashPassword("password123"),
		Role:                     "buyer",
		EmailVerified:            false,
		VerificationToken:        &token,
		VerificationTokenExpires: &expires,
		Status:                   models.UserStatusPending,
	}
	db.DB.Create(user)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/verify-email", verifyEmail)

	body := verifyEmailRequest{Token: token}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/verify-email", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["access_token"] == nil {
		t.Error("Expected access_token in response")
	}
	if response["message"] != "Email verified successfully" {
		t.Errorf("Expected success message, got %v", response["message"])
	}

	// Verify user is now verified in database
	var updatedUser models.User
	db.DB.First(&updatedUser, "id = ?", user.ID)
	if !updatedUser.EmailVerified {
		t.Error("User should be marked as email verified")
	}
	if updatedUser.VerificationToken != nil {
		t.Error("Verification token should be cleared after verification")
	}
	if updatedUser.Status != models.UserStatusActive {
		t.Errorf("User status should be active, got %s", updatedUser.Status)
	}
}

// TestVerifyEmail_InvalidToken tests verification with invalid token
func TestVerifyEmail_InvalidToken(t *testing.T) {
	testutil.SetupTestDB(t)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/verify-email", verifyEmail)

	body := verifyEmailRequest{Token: "invalid-token-that-does-not-exist"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/verify-email", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["code"] != "invalid_token" {
		t.Errorf("Expected code 'invalid_token', got %v", response["code"])
	}
}

// TestVerifyEmail_ExpiredToken tests verification with expired token
func TestVerifyEmail_ExpiredToken(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users")

	// Create user with expired verification token
	token := "expired-verification-token-" + testutil.UniqueEmail("expired")
	expires := time.Now().Add(-1 * time.Hour) // Expired 1 hour ago

	user := &models.User{
		Email:                    testutil.UniqueEmail("expired"),
		PasswordHash:             testutil.HashPassword("password123"),
		Role:                     "buyer",
		EmailVerified:            false,
		VerificationToken:        &token,
		VerificationTokenExpires: &expires,
	}
	db.DB.Create(user)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/verify-email", verifyEmail)

	body := verifyEmailRequest{Token: token}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/verify-email", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["code"] != "token_expired" {
		t.Errorf("Expected code 'token_expired', got %v", response["code"])
	}
}

// TestResendVerification_Success tests resending verification email
func TestResendVerification_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users")

	email := testutil.UniqueEmail("resend")
	user := &models.User{
		Email:         email,
		PasswordHash:  testutil.HashPassword("password123"),
		Role:          "buyer",
		EmailVerified: false,
	}
	db.DB.Create(user)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/resend-verification", resendVerification)

	body := resendVerificationRequest{Email: email}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/resend-verification", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	// Verify new token was generated
	var updatedUser models.User
	db.DB.First(&updatedUser, "email = ?", email)
	if updatedUser.VerificationToken == nil {
		t.Error("Verification token should be generated")
	}
	if updatedUser.VerificationTokenExpires == nil {
		t.Error("Verification token expiry should be set")
	}
}

// TestResendVerification_AlreadyVerified tests resend for already verified user
func TestResendVerification_AlreadyVerified(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	email := testutil.UniqueEmail("alreadyverified")
	testutil.CreateTestUser(t, email, "buyer") // Creates verified user

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/resend-verification", resendVerification)

	body := resendVerificationRequest{Email: email}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/resend-verification", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["code"] != "already_verified" {
		t.Errorf("Expected code 'already_verified', got %v", response["code"])
	}
}

// TestResendVerification_NonExistentEmail tests resend for non-existent email (should not reveal)
func TestResendVerification_NonExistentEmail(t *testing.T) {
	testutil.SetupTestDB(t)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/resend-verification", resendVerification)

	body := resendVerificationRequest{Email: "nonexistent_" + testutil.UniqueEmail("noexist") + "@example.com"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/resend-verification", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	// Should return OK to not reveal if email exists
	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}
}

// TestLogin_UnverifiedEmailBlocked tests login blocked for unverified email
func TestLogin_UnverifiedEmailBlocked(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users")

	email := testutil.UniqueEmail("unverified_login")
	testutil.CreateUnverifiedTestUser(t, email, "buyer")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/login", login)

	body := loginRequest{
		Email:    email,
		Password: "password123",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/login", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	// Should return 400 Bad Request with verification_required
	if w.Code != http.StatusBadRequest && w.Code != http.StatusForbidden {
		t.Errorf("Expected status 400 or 403, got %d. Body: %s", w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["verification_required"] != true {
		t.Error("Expected verification_required to be true")
	}
}

// TestLogin_VerifiedEmail tests successful login for verified email
func TestLogin_VerifiedEmailSuccess(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	email := testutil.UniqueEmail("verified_login")
	testutil.CreateTestUser(t, email, "buyer")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/login", login)

	body := loginRequest{
		Email:    email,
		Password: "password123",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/login", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["access_token"] == nil {
		t.Error("Expected access_token in response")
	}
}

// TestRegister_GeneratesVerificationToken tests that register generates verification token
func TestRegister_GeneratesVerificationToken(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	email := testutil.UniqueEmail("newregister")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/register", register)

	body := registerRequest{
		Email:    email,
		Password: "securepassword123",
		Role:     "buyer",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/register", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusCreated, w.Code, w.Body.String())
	}

	// Verify user has verification token
	var user models.User
	db.DB.First(&user, "email = ?", email)

	if user.EmailVerified {
		t.Error("New user should not be verified")
	}
	if user.VerificationToken == nil {
		t.Error("New user should have verification token")
	}
	if user.VerificationTokenExpires == nil {
		t.Error("New user should have verification token expiry")
	}
}
