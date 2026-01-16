package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// TestSetup2FA_Success tests successful 2FA setup
func TestSetup2FA_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "totp_backup_codes")

	email := testutil.UniqueEmail("setup2fa")
	user := testutil.CreateTestUser(t, email, "buyer")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID.String())
		c.Next()
	})
	r.POST("/2fa/setup", setup2FA)

	req := httptest.NewRequest("POST", "/2fa/setup", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["secret"] == nil {
		t.Error("Expected secret in response")
	}
	if response["qr_code"] == nil {
		t.Error("Expected qr_code in response")
	}
	if response["otpauth_url"] == nil {
		t.Error("Expected otpauth_url in response")
	}

	// Verify secret is saved to user (but 2FA not enabled yet)
	var updatedUser models.User
	db.DB.First(&updatedUser, "id = ?", user.ID)
	if updatedUser.TOTPSecret == nil {
		t.Error("TOTP secret should be saved to user")
	}
	if updatedUser.TOTPEnabled {
		t.Error("2FA should not be enabled yet (just setup)")
	}
}

// TestSetup2FA_AlreadyEnabled tests setup when 2FA is already enabled
func TestSetup2FA_AlreadyEnabled(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "totp_backup_codes")

	email := testutil.UniqueEmail("already2fa")
	user, _ := testutil.Create2FAEnabledUser(t, email)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID.String())
		c.Next()
	})
	r.POST("/2fa/setup", setup2FA)

	req := httptest.NewRequest("POST", "/2fa/setup", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["code"] != "already_enabled" {
		t.Errorf("Expected code 'already_enabled', got %v", response["code"])
	}
}

// TestEnable2FA_NoSetup tests enabling 2FA without calling setup first
func TestEnable2FA_NoSetup(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	email := testutil.UniqueEmail("nosetupenable")
	user := testutil.CreateTestUser(t, email, "buyer")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID.String())
		c.Next()
	})
	r.POST("/2fa/enable", enable2FA)

	body := enable2FARequest{Code: "123456"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/2fa/enable", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, w.Code)
	}
}

// TestDisable2FA_NotEnabled tests disabling 2FA when not enabled
func TestDisable2FA_NotEnabled(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	email := testutil.UniqueEmail("notenabled")
	user := testutil.CreateTestUser(t, email, "buyer")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID.String())
		c.Next()
	})
	r.POST("/2fa/disable", disable2FA)

	body := disable2FARequest{Password: "password123", Code: "123456"}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/2fa/disable", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, w.Code)
	}
}

// TestLogin2FA_Required tests login when 2FA is enabled
func TestLogin2FA_Required(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	email := testutil.UniqueEmail("login2fa")
	testutil.Create2FAEnabledUser(t, email)

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

	if response["requires_2fa"] != true {
		t.Error("Expected requires_2fa to be true")
	}
	if response["temp_token"] == nil {
		t.Error("Expected temp_token when 2FA is required")
	}
	if response["access_token"] != nil {
		t.Error("Should not return access_token when 2FA is required")
	}
}

// TestTempToken_2FA_GenerateAndValidate tests temp token generation and validation for 2FA flow
func TestTempToken_2FA_GenerateAndValidate(t *testing.T) {
	userID := "temp-user-456"

	token, err := GenerateTempToken(userID)
	if err != nil {
		t.Fatalf("Failed to generate temp token: %v", err)
	}

	if token == "" {
		t.Error("Temp token should not be empty")
	}

	claims, err := ValidateTempToken(token)
	if err != nil {
		t.Fatalf("Failed to validate temp token: %v", err)
	}

	if claims.UserID != userID {
		t.Errorf("Expected UserID '%s', got '%s'", userID, claims.UserID)
	}
}

// TestTOTPVerification tests basic TOTP verification logic
func TestTOTPVerification(t *testing.T) {
	secret := "TESTSECRET12345678901234567890AB"

	// Test that verifyTOTP works with a valid format code
	// Note: We can't test with a real generated code easily since TOTP is time-based
	// Instead we test the validation logic

	// Invalid code should fail (extremely unlikely to match)
	if verifyTOTP(secret, "000000") {
		// This might pass sometimes by chance, but very unlikely
		t.Log("Warning: 000000 matched (1 in 1 million chance)")
	}

	// Wrong length should fail
	if verifyTOTP(secret, "12345") {
		t.Error("5-digit code should not verify")
	}
	if verifyTOTP(secret, "1234567") {
		t.Error("7-digit code should not verify")
	}

	// Empty code should fail
	if verifyTOTP(secret, "") {
		t.Error("Empty code should not verify")
	}
}
