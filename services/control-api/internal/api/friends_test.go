package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

func TestSendFriendRequest_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "friend_requests", "friendships")

	email1 := testutil.UniqueEmail("sender")
	sender := testutil.CreateTestUser(t, email1, "buyer")

	email2 := testutil.UniqueEmail("target")
	target := testutil.CreateTestUser(t, email2, "provider")

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("userID", sender.ID.String())
		c.Next()
	})
	r.POST("/friends/request/:userId", sendFriendRequest)

	req := httptest.NewRequest("POST", "/friends/request/"+target.ID.String(), nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var savedReq models.FriendRequest
	db.DB.First(&savedReq, "sender_id = ? AND receiver_id = ?", sender.ID, target.ID)
	if savedReq.Status != models.FriendRequestPending {
		t.Errorf("Expected pending status, got %s", savedReq.Status)
	}
}

func TestAcceptFriendRequest_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "friend_requests", "friendships")

	email1 := testutil.UniqueEmail("requester")
	requester := testutil.CreateTestUser(t, email1, "buyer")

	email2 := testutil.UniqueEmail("accepter")
	accepter := testutil.CreateTestUser(t, email2, "provider")

	// Create pending request
	friendReq := models.FriendRequest{
		SenderID:   requester.ID,
		ReceiverID: accepter.ID,
		Status:     models.FriendRequestPending,
	}
	db.DB.Create(&friendReq)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("userID", accepter.ID.String())
		c.Next()
	})
	r.PUT("/friends/request/:requestId/accept", acceptFriendRequest)

	req := httptest.NewRequest("PUT", "/friends/request/"+friendReq.ID.String()+"/accept", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	// Verify request updated
	var updatedReq models.FriendRequest
	db.DB.First(&updatedReq, "id = ?", friendReq.ID)
	if updatedReq.Status != models.FriendRequestAccepted {
		t.Errorf("Expected accepted status, got %s", updatedReq.Status)
	}

	// Verify bidirectional friendship
	var count int64
	db.DB.Model(&models.Friendship{}).Where(
		"(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
		requester.ID, accepter.ID, accepter.ID, requester.ID,
	).Count(&count)

	if count != 2 {
		t.Errorf("Expected 2 friendship rows, got %d", count)
	}
}

func TestRejectFriendRequest_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "friend_requests", "friendships")

	email1 := testutil.UniqueEmail("requester")
	requester := testutil.CreateTestUser(t, email1, "buyer")

	email2 := testutil.UniqueEmail("rejecter")
	rejecter := testutil.CreateTestUser(t, email2, "provider")

	friendReq := models.FriendRequest{
		SenderID:   requester.ID,
		ReceiverID: rejecter.ID,
		Status:     models.FriendRequestPending,
	}
	db.DB.Create(&friendReq)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("userID", rejecter.ID.String())
		c.Next()
	})
	r.PUT("/friends/request/:requestId/reject", rejectFriendRequest)

	req := httptest.NewRequest("PUT", "/friends/request/"+friendReq.ID.String()+"/reject", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var updatedReq models.FriendRequest
	db.DB.First(&updatedReq, "id = ?", friendReq.ID)
	if updatedReq.Status != models.FriendRequestRejected {
		t.Errorf("Expected rejected status, got %s", updatedReq.Status)
	}
}

func TestListFriends_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "friendships")

	email1 := testutil.UniqueEmail("me")
	me := testutil.CreateTestUser(t, email1, "buyer")

	email2 := testutil.UniqueEmail("friend")
	friend := testutil.CreateTestUser(t, email2, "provider")

	// Create friendship
	friendship := models.Friendship{
		UserID:   me.ID,
		FriendID: friend.ID,
	}
	db.DB.Create(&friendship)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("userID", me.ID.String())
		c.Next()
	})
	r.GET("/friends", listFriends)

	req := httptest.NewRequest("GET", "/friends", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var friends []models.Friendship
	json.Unmarshal(w.Body.Bytes(), &friends)

	if len(friends) != 1 {
		t.Errorf("Expected 1 friend, got %d", len(friends))
	}
	if friends[0].Friend.ID != friend.ID {
		t.Errorf("Expected friend ID %s, got %s", friend.ID, friends[0].Friend.ID)
	}
}
