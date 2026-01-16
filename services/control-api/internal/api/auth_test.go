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
	"golang.org/x/crypto/bcrypt"
)

func setupTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	return r
}

func TestRegister_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	r := setupTestRouter()
	r.POST("/register", register)

	email := testutil.UniqueEmail("register")
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

	// Now returns 201 with verification_required instead of tokens
	if w.Code != http.StatusCreated {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusCreated, w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	// With email verification enabled, we expect verification_required
	if response["verification_required"] != true {
		// If verification is not required, we should have tokens
		if response["access_token"] == nil {
			t.Error("Expected access_token or verification_required in response")
		}
	}

	// Verify password is hashed in database
	var user models.User
	db.DB.Where("email = ?", email).First(&user)
	if user.PasswordHash == "securepassword123" {
		t.Error("Password should be hashed, not stored in plaintext")
	}
	// Verify bcrypt can verify the password
	err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte("securepassword123"))
	if err != nil {
		t.Error("Bcrypt should be able to verify the hashed password")
	}
}

func TestRegister_InvalidEmail(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users")

	r := setupTestRouter()
	r.POST("/register", register)

	body := registerRequest{
		Email:    "invalid-email",
		Password: "securepassword123",
		Role:     "buyer",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/register", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, w.Code)
	}
}

func TestRegister_ShortPassword(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users")

	r := setupTestRouter()
	r.POST("/register", register)

	body := registerRequest{
		Email:    "test@example.com",
		Password: "short",
		Role:     "buyer",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/register", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, w.Code)
	}
}

func TestRegister_DuplicateEmail(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	email := testutil.UniqueEmail("duplicate")
	testutil.CreateTestUser(t, email, "buyer")

	r := setupTestRouter()
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

	if w.Code != http.StatusConflict {
		t.Errorf("Expected status %d, got %d", http.StatusConflict, w.Code)
	}
}

func TestLogin_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	email := testutil.UniqueEmail("login")
	testutil.CreateTestUser(t, email, "buyer")

	r := setupTestRouter()
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
	if response["refresh_token"] == nil {
		t.Error("Expected refresh_token in response")
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets")

	email := testutil.UniqueEmail("wrongpw")
	testutil.CreateTestUser(t, email, "buyer")

	r := setupTestRouter()
	r.POST("/login", login)

	body := loginRequest{
		Email:    email,
		Password: "wrongpassword",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/login", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status %d, got %d", http.StatusUnauthorized, w.Code)
	}
}

func TestLogin_NonExistentUser(t *testing.T) {
	testutil.SetupTestDB(t)

	r := setupTestRouter()
	r.POST("/login", login)

	body := loginRequest{
		Email:    "nonexistent@example.com",
		Password: "password123",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/login", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status %d, got %d", http.StatusUnauthorized, w.Code)
	}
}

func TestLogin_UnverifiedEmail(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users")

	email := testutil.UniqueEmail("unverified")
	testutil.CreateUnverifiedTestUser(t, email, "buyer")

	r := setupTestRouter()
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

	// Should return 400 with verification_required
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status %d, got %d", http.StatusBadRequest, w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["verification_required"] != true {
		t.Error("Expected verification_required to be true")
	}
}

func TestLogin_With2FA(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users")

	email := testutil.UniqueEmail("2fa")
	testutil.Create2FAEnabledUser(t, email)

	r := setupTestRouter()
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
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
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

func TestJWT_GenerateAndValidate(t *testing.T) {
	// GenerateAccessToken takes (userID, role) and returns (token, expiresIn, error)
	token, _, err := GenerateAccessToken("test-user-id", "buyer")
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	if token == "" {
		t.Error("Token should not be empty")
	}

	// Validate the token
	claims, err := ValidateAccessToken(token)
	if err != nil {
		t.Fatalf("Failed to validate token: %v", err)
	}

	if claims.UserID != "test-user-id" {
		t.Errorf("Expected UserID 'test-user-id', got '%s'", claims.UserID)
	}
	if claims.Role != "buyer" {
		t.Errorf("Expected Role 'buyer', got '%s'", claims.Role)
	}
}

func TestJWT_InvalidToken(t *testing.T) {
	_, err := ValidateAccessToken("invalid.token.here")
	if err == nil {
		t.Error("Expected error for invalid token")
	}
}

func TestPasswordHashing(t *testing.T) {
	password := "mysecretpassword"
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("Failed to hash password: %v", err)
	}

	// Verify correct password
	err = bcrypt.CompareHashAndPassword(hash, []byte(password))
	if err != nil {
		t.Error("Correct password should verify")
	}

	// Verify wrong password fails
	err = bcrypt.CompareHashAndPassword(hash, []byte("wrongpassword"))
	if err == nil {
		t.Error("Wrong password should not verify")
	}
}

func TestTempToken_GenerateAndValidate(t *testing.T) {
	userID := "temp-user-123"

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
