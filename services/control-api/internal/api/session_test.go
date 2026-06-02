package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestCreateSession_Rotating(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "wallets", "sessions")

	email := testutil.UniqueEmail("session_rotating_v3")
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
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusCreated, w.Code, w.Body.String())
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
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "wallets", "sessions")

	email := testutil.UniqueEmail("session_sticky_v3")
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
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusCreated, w.Code, w.Body.String())
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
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "wallets", "sessions")

	email := testutil.UniqueEmail("session_list_v3")
	user := testutil.CreateTestUser(t, email, "buyer")

	// Create a few sessions
	for i := 0; i < 3; i++ {
		session := models.Session{
			UserID:          user.ID,
			Type:            models.SessionRotating,
			Status:          models.SessionActive,
			CredentialsUser: "test-user",
			CredentialsPass: "test-pass",
			Config:          "{}",
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
		t.Fatalf("Expected status %d, got %d", http.StatusOK, w.Code)
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
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "wallets", "sessions")

	email := testutil.UniqueEmail("session_terminate_v3")
	user := testutil.CreateTestUser(t, email, "buyer")

	// Create a session
	session := models.Session{
		UserID:          user.ID,
		Type:            models.SessionRotating,
		Status:          models.SessionActive,
		CredentialsUser: "test-user",
		CredentialsPass: "test-pass",
		Config:          "{}",
	}
	db.DB.Create(&session)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.DELETE("/sessions/:id", terminateSession)

	req := httptest.NewRequest("DELETE", "/sessions/"+session.ID.String(), nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	// Verify session is terminated
	var updatedSession models.Session
	db.DB.First(&updatedSession, "id = ?", session.ID)

	if updatedSession.Status != models.SessionTerminated {
		t.Errorf("Expected status 'terminated', got '%s'", updatedSession.Status)
	}
}

func TestTerminateSession_BlocksAlreadyTerminated(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "wallets", "sessions")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("session_terminate_terminal"), "buyer")
	session := models.Session{
		UserID:          user.ID,
		Type:            models.SessionRotating,
		Status:          models.SessionTerminated,
		CredentialsUser: "test-user-terminal",
		CredentialsPass: "test-pass-terminal",
		Config:          "{}",
	}
	if err := db.DB.Create(&session).Error; err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.DELETE("/sessions/:id", terminateSession)

	req := httptest.NewRequest("DELETE", "/sessions/"+session.ID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for already terminated session, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateSessionFromListing_SuccessLinksListingAndNode(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "wallets", "sessions", "proxy_listings", "nodes")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_p2p_session"), "provider")
	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("buyer_p2p_session"), "buyer")
	db.DB.Model(&models.Wallet{}).Where("user_id = ?", buyer.ID).Update("balance_sol", 10.0)

	node := models.Node{
		UserID:            provider.ID,
		ProviderUserID:    provider.ID,
		IPAddress:         "127.0.0.1",
		Port:              8080,
		IsHealthy:         true,
		ActiveConnections: 0,
		MaxConnections:    10,
		QualityScore:      99,
	}
	if err := db.DB.Create(&node).Error; err != nil {
		t.Fatalf("failed to create node: %v", err)
	}

	listing := models.ProxyListing{
		SellerID:             provider.ID,
		Title:                "P2P Listing",
		PricePerGB:           1,
		MinPurchaseGB:        1,
		AvailableBandwidthGB: 10,
		MaxConcurrency:       5,
		RotationType:         "sticky",
		Status:               models.ListingStatusActive,
	}
	if err := db.DB.Create(&listing).Error; err != nil {
		t.Fatalf("failed to create listing: %v", err)
	}

	r := setupTestRouter()
	r.Use(authMiddlewareMock(buyer.ID.String(), "buyer"))
	r.POST("/sessions/from-listing", createSessionFromListing)

	body := createSessionFromListingRequest{
		ListingID:      listing.ID.String(),
		BandwidthLimit: 1024,
	}
	jsonBody, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", "/sessions/from-listing", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var session models.Session
	if err := db.DB.First(&session, "user_id = ? AND listing_id = ?", buyer.ID, listing.ID).Error; err != nil {
		t.Fatalf("expected session linked to listing: %v", err)
	}
	if session.Status != models.SessionActive {
		t.Fatalf("expected active session, got %s", session.Status)
	}
	if session.NodeID == nil || *session.NodeID != node.ID {
		t.Fatalf("expected session node %s, got %v", node.ID, session.NodeID)
	}
	if session.Type != models.SessionSticky {
		t.Fatalf("expected sticky session inherited from listing, got %s", session.Type)
	}
}

func TestCreateSessionFromListing_BlocksUnavailableListings(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "wallets", "sessions", "proxy_listings")

	provider := testutil.CreateTestUser(t, testutil.UniqueEmail("provider_p2p_inactive"), "provider")
	buyer := testutil.CreateTestUser(t, testutil.UniqueEmail("buyer_p2p_inactive"), "buyer")
	db.DB.Model(&models.Wallet{}).Where("user_id = ?", buyer.ID).Update("balance_sol", 10.0)

	for _, status := range []models.ListingStatus{models.ListingStatusPaused, models.ListingStatusSoldOut, models.ListingStatusDeleted} {
		t.Run(string(status), func(t *testing.T) {
			listing := models.ProxyListing{
				ID:                   uuid.New(),
				SellerID:             provider.ID,
				Title:                "Unavailable P2P Listing",
				PricePerGB:           1,
				MinPurchaseGB:        1,
				AvailableBandwidthGB: 10,
				MaxConcurrency:       5,
				Status:               status,
			}
			if err := db.DB.Create(&listing).Error; err != nil {
				t.Fatalf("failed to create listing: %v", err)
			}

			r := setupTestRouter()
			r.Use(authMiddlewareMock(buyer.ID.String(), "buyer"))
			r.POST("/sessions/from-listing", createSessionFromListing)

			body := createSessionFromListingRequest{ListingID: listing.ID.String()}
			jsonBody, _ := json.Marshal(body)
			req := httptest.NewRequest("POST", "/sessions/from-listing", bytes.NewBuffer(jsonBody))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusConflict {
				t.Fatalf("expected 409 for %s listing, got %d: %s", status, w.Code, w.Body.String())
			}
		})
	}
}

func TestGetSession(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "wallets", "sessions")

	email := testutil.UniqueEmail("session_get_v3")
	user := testutil.CreateTestUser(t, email, "buyer")

	session := models.Session{
		UserID:          user.ID,
		Type:            models.SessionRotating,
		Status:          models.SessionActive,
		CredentialsUser: "test-user-get",
		CredentialsPass: "test-pass-get",
		Config:          "{}",
	}
	db.DB.Create(&session)

	r := setupTestRouter()
	r.Use(authMiddlewareMock(user.ID.String(), "buyer"))
	r.GET("/sessions/:id", getSession)

	req := httptest.NewRequest("GET", "/sessions/"+session.ID.String(), nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	s, ok := response["session"].(map[string]interface{})
	if !ok {
		t.Fatalf("Expected session object in response, got: %v", response)
	}
	if s["id"] != session.ID.String() {
		t.Errorf("Expected session ID %s, got %s", session.ID, s["id"])
	}
}

func TestSessionModelValidation(t *testing.T) {
	session := models.Session{
		Type:            models.SessionRotating,
		Status:          models.SessionActive,
		CredentialsUser: "test-cred",
		CredentialsPass: "test-pass",
		Config:          "{}",
	}

	if session.Type != models.SessionRotating {
		t.Errorf("Expected type rotating, got %s", session.Type)
	}
	if session.Status != models.SessionActive {
		t.Errorf("Expected status active, got %s", session.Status)
	}
}
