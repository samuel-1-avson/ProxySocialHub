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

func TestGetFriendshipStatus_RequestReceived(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "friend_requests", "friendships")

	me := testutil.CreateTestUser(t, testutil.UniqueEmail("status_me"), "buyer")
	sender := testutil.CreateTestUser(t, testutil.UniqueEmail("status_sender"), "provider")

	friendReq := models.FriendRequest{
		SenderID:   sender.ID,
		ReceiverID: me.ID,
		Status:     models.FriendRequestPending,
	}
	db.DB.Create(&friendReq)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", me.ID)
		c.Next()
	})
	r.GET("/friends/status/:userId", getFriendshipStatus)

	req := httptest.NewRequest("GET", "/friends/status/"+sender.ID.String(), nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response["status"] != "request_received" {
		t.Errorf("Expected request_received, got %v", response["status"])
	}
	if response["request_id"] != friendReq.ID.String() {
		t.Errorf("Expected request ID %s, got %v", friendReq.ID, response["request_id"])
	}
}

func TestCancelFriendRequest_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "friend_requests", "friendships")

	sender := testutil.CreateTestUser(t, testutil.UniqueEmail("cancel_sender"), "buyer")
	receiver := testutil.CreateTestUser(t, testutil.UniqueEmail("cancel_receiver"), "provider")

	friendReq := models.FriendRequest{
		SenderID:   sender.ID,
		ReceiverID: receiver.ID,
		Status:     models.FriendRequestPending,
	}
	db.DB.Create(&friendReq)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", sender.ID)
		c.Next()
	})
	r.DELETE("/friends/request/:requestId", cancelFriendRequest)

	req := httptest.NewRequest("DELETE", "/friends/request/"+friendReq.ID.String(), nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var count int64
	db.DB.Model(&models.FriendRequest{}).Where("id = ?", friendReq.ID).Count(&count)
	if count != 0 {
		t.Errorf("Expected canceled request to be deleted, got count %d", count)
	}
}

func TestRemoveFriend_DeletesBidirectionalRows(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "friendships")

	me := testutil.CreateTestUser(t, testutil.UniqueEmail("remove_me"), "buyer")
	friend := testutil.CreateTestUser(t, testutil.UniqueEmail("remove_friend"), "provider")

	db.DB.Create(&models.Friendship{UserID: me.ID, FriendID: friend.ID})
	db.DB.Create(&models.Friendship{UserID: friend.ID, FriendID: me.ID})

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", me.ID)
		c.Next()
	})
	r.DELETE("/friends/:friendId", removeFriend)

	req := httptest.NewRequest("DELETE", "/friends/"+friend.ID.String(), nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var count int64
	db.DB.Model(&models.Friendship{}).Where(
		"(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
		me.ID, friend.ID, friend.ID, me.ID,
	).Count(&count)
	if count != 0 {
		t.Errorf("Expected friendship rows deleted, got count %d", count)
	}
}

func TestGetPeopleYouMayKnow_ExcludesFriendsAndPending(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "friend_requests", "friendships")

	me := testutil.CreateTestUser(t, testutil.UniqueEmail("suggest_me"), "buyer")
	existingFriend := testutil.CreateTestUser(t, testutil.UniqueEmail("suggest_friend"), "provider")
	pending := testutil.CreateTestUser(t, testutil.UniqueEmail("suggest_pending"), "provider")
	candidate := testutil.CreateTestUser(t, testutil.UniqueEmail("suggest_candidate"), "provider")

	db.DB.Create(&models.Friendship{UserID: me.ID, FriendID: existingFriend.ID})
	db.DB.Create(&models.FriendRequest{
		SenderID:   me.ID,
		ReceiverID: pending.ID,
		Status:     models.FriendRequestPending,
	})

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", me.ID)
		c.Next()
	})
	r.GET("/discover/people", getPeopleYouMayKnow)

	req := httptest.NewRequest("GET", "/discover/people?limit=10", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var response struct {
		Suggestions []struct {
			ID string `json:"id"`
		} `json:"suggestions"`
	}
	json.Unmarshal(w.Body.Bytes(), &response)

	if len(response.Suggestions) != 1 {
		t.Fatalf("Expected 1 suggestion, got %d", len(response.Suggestions))
	}
	if response.Suggestions[0].ID != candidate.ID.String() {
		t.Errorf("Expected candidate %s, got %s", candidate.ID, response.Suggestions[0].ID)
	}
}

func TestGetMutualFriends_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "friendships")

	me := testutil.CreateTestUser(t, testutil.UniqueEmail("mutual_me"), "buyer")
	target := testutil.CreateTestUser(t, testutil.UniqueEmail("mutual_target"), "provider")
	shared := testutil.CreateTestUser(t, testutil.UniqueEmail("mutual_shared"), "buyer")
	onlyMine := testutil.CreateTestUser(t, testutil.UniqueEmail("mutual_only_mine"), "buyer")

	db.DB.Create(&models.Friendship{UserID: me.ID, FriendID: shared.ID})
	db.DB.Create(&models.Friendship{UserID: target.ID, FriendID: shared.ID})
	db.DB.Create(&models.Friendship{UserID: me.ID, FriendID: onlyMine.ID})

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", me.ID)
		c.Next()
	})
	r.GET("/users/:id/mutual-friends", getMutualFriends)

	req := httptest.NewRequest("GET", "/users/"+target.ID.String()+"/mutual-friends", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var response struct {
		Friends []models.Friendship `json:"friends"`
		Count   int                 `json:"count"`
	}
	json.Unmarshal(w.Body.Bytes(), &response)

	if response.Count != 1 {
		t.Fatalf("Expected count 1, got %d", response.Count)
	}
	if len(response.Friends) != 1 || response.Friends[0].FriendID != shared.ID {
		t.Fatalf("Expected shared friend %s, got %+v", shared.ID, response.Friends)
	}
}
