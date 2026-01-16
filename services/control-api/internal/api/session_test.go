package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestCreateSession_Rotating(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "sessions")

	email := testutil.UniqueEmail("session_rotating")
	user := testutil.CreateTestUser(t, email, "buyer")

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/sessions", createSession)

	body := map[string]interface{}{
		"type": "rotating",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/sessions", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusCreated, w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	session, ok := response["session"].(map[string]interface{})
	if !ok {
		t.Fatal("Expected session in response")
	}

	if session["type"] != "rotating" {
		t.Errorf("Expected type 'rotating', got '%v'", session["type"])
	}
	if session["credentials_user"] == nil {
		t.Error("Expected credentials_user in session")
	}
	if session["credentials_pass"] == nil {
		t.Error("Expected credentials_pass in session")
	}
}

func TestCreateSession_Sticky(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "sessions")

	email := testutil.UniqueEmail("session_sticky")
	user := testutil.CreateTestUser(t, email, "buyer")

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.POST("/sessions", createSession)

	body := map[string]interface{}{
		"type": "sticky",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/sessions", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("Expected status %d, got %d", http.StatusCreated, w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	session := response["session"].(map[string]interface{})
	if session["type"] != "sticky" {
		t.Errorf("Expected type 'sticky', got '%v'", session["type"])
	}
}

func TestListSessions(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "sessions")

	email := testutil.UniqueEmail("session_list")
	user := testutil.CreateTestUser(t, email, "buyer")

	// Create a few sessions
	for i := 0; i < 3; i++ {
		session := models.Session{
			UserID:          user.ID,
			Type:            models.SessionRotating,
			Status:          models.SessionActive,
			CredentialsUser: "test-user",
			CredentialsPass: "test-pass",
		}
		db.DB.Create(&session)
	}

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.GET("/sessions", listSessions)

	req := httptest.NewRequest("GET", "/sessions", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	sessions, ok := response["sessions"].([]interface{})
	if !ok {
		t.Fatal("Expected sessions array in response")
	}

	if len(sessions) != 3 {
		t.Errorf("Expected 3 sessions, got %d", len(sessions))
	}
}

func TestTerminateSession(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "wallets", "sessions")

	email := testutil.UniqueEmail("session_terminate")
	user := testutil.CreateTestUser(t, email, "buyer")

	// Create a session
	session := models.Session{
		UserID:          user.ID,
		Type:            models.SessionRotating,
		Status:          models.SessionActive,
		CredentialsUser: "test-user",
		CredentialsPass: "test-pass",
	}
	db.DB.Create(&session)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.DELETE("/sessions/:id", terminateSession)

	req := httptest.NewRequest("DELETE", "/sessions/"+session.ID.String(), nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	// Verify session is terminated
	var updatedSession models.Session
	db.DB.First(&updatedSession, "id = ?", session.ID)

	if updatedSession.Status != models.SessionTerminated {
		t.Errorf("Expected status 'terminated', got '%s'", updatedSession.Status)
	}
}

func TestSessionModelValidation(t *testing.T) {
	session := models.Session{
		Type:            models.SessionRotating,
		Status:          models.SessionActive,
		CredentialsUser: "test-cred",
		CredentialsPass: "test-pass",
	}

	if session.Type != models.SessionRotating {
		t.Errorf("Expected type rotating, got %s", session.Type)
	}
	if session.Status != models.SessionActive {
		t.Errorf("Expected status active, got %s", session.Status)
	}
}
