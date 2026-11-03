package api

import (
	"bytes"
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

// F02: one shared block/contact policy. After either party blocks, direct
// API calls cannot start conversations, send messages or send friend
// requests (either direction), blocked users do not appear in suggestions,
// no new notifications are created, and blocking severs follows,
// friendships and pending friend requests. Existing history stays readable.

func f02RouterAs(userID uuid.UUID) *gin.Engine {
	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	})
	return r
}

func f02Block(t *testing.T, blocker, blocked *models.User) {
	t.Helper()
	row := models.Block{BlockerID: blocker.ID, BlockedID: blocked.ID, Reason: "test block"}
	if err := db.DB.Create(&row).Error; err != nil {
		t.Fatalf("create block: %v", err)
	}
}

func f02Count(t *testing.T, model interface{}, query string, args ...interface{}) int64 {
	t.Helper()
	var n int64
	if err := db.DB.Model(model).Where(query, args...).Count(&n).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func TestF02StartConversationBlockedBothDirections(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "blocks", "conversations", "messages", "notifications")

	alice := testutil.CreateTestUser(t, testutil.UniqueEmail("f02alice"), "buyer")
	bob := testutil.CreateTestUser(t, testutil.UniqueEmail("f02bob"), "provider")
	f02Block(t, alice, bob) // Alice blocks Bob

	for _, tc := range []struct {
		name   string
		sender *models.User
		target *models.User
	}{
		{"blocked party cannot start", bob, alice},
		{"blocker cannot start either", alice, bob},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := f02RouterAs(tc.sender.ID)
			r.POST("/conversations", startConversation)
			body, _ := json.Marshal(models.StartConversationRequest{RecipientID: tc.target.ID, Message: "hello"})
			req := httptest.NewRequest("POST", "/conversations", bytes.NewBuffer(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != http.StatusForbidden {
				t.Fatalf("expected 403, got %d. Body: %s", w.Code, w.Body.String())
			}
		})
	}

	if n := f02Count(t, &models.Conversation{}, "1 = 1"); n != 0 {
		t.Fatalf("expected no conversations created, got %d", n)
	}
	if n := f02Count(t, &models.Message{}, "1 = 1"); n != 0 {
		t.Fatalf("expected no messages created, got %d", n)
	}
}

func TestF02SendMessageBlockedInExistingConversation(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "blocks", "conversations", "messages", "notifications", "notification_preferences")

	alice := testutil.CreateTestUser(t, testutil.UniqueEmail("f02alice2"), "buyer")
	bob := testutil.CreateTestUser(t, testutil.UniqueEmail("f02bob2"), "provider")

	conv := models.Conversation{Participant1: alice.ID, Participant2: bob.ID}
	if err := db.DB.Create(&conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	seed := models.Message{ConversationID: conv.ID, SenderID: alice.ID, Content: "before block"}
	if err := db.DB.Create(&seed).Error; err != nil {
		t.Fatalf("create seed message: %v", err)
	}

	f02Block(t, bob, alice) // Bob blocks Alice after the conversation exists

	for _, sender := range []*models.User{alice, bob} {
		r := f02RouterAs(sender.ID)
		r.POST("/conversations/:id/messages", sendMessage)
		body, _ := json.Marshal(map[string]string{"content": "after block"})
		req := httptest.NewRequest("POST", "/conversations/"+conv.ID.String()+"/messages", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusForbidden {
			t.Fatalf("sender %s: expected 403, got %d. Body: %s", sender.ID, w.Code, w.Body.String())
		}
	}

	if n := f02Count(t, &models.Message{}, "conversation_id = ?", conv.ID); n != 1 {
		t.Fatalf("expected only the pre-block message, got %d", n)
	}
	if n := f02Count(t, &models.Notification{}, "1 = 1"); n != 0 {
		t.Fatalf("expected no notifications from blocked sends, got %d", n)
	}

	// History remains readable for both participants (read-only evidence).
	r := f02RouterAs(alice.ID)
	r.GET("/conversations/:id/messages", getMessages)
	req := httptest.NewRequest("GET", "/conversations/"+conv.ID.String()+"/messages", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("history read: expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestF02SendMessageAllowedWithoutBlock(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "blocks", "conversations", "messages", "notifications", "notification_preferences")

	alice := testutil.CreateTestUser(t, testutil.UniqueEmail("f02alice3"), "buyer")
	bob := testutil.CreateTestUser(t, testutil.UniqueEmail("f02bob3"), "provider")
	conv := models.Conversation{Participant1: alice.ID, Participant2: bob.ID}
	if err := db.DB.Create(&conv).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}

	r := f02RouterAs(alice.ID)
	r.POST("/conversations/:id/messages", sendMessage)
	body, _ := json.Marshal(map[string]string{"content": "still works"})
	req := httptest.NewRequest("POST", "/conversations/"+conv.ID.String()+"/messages", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestF02FriendRequestBlockedBothDirections(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "blocks", "friend_requests", "friendships", "notifications")

	alice := testutil.CreateTestUser(t, testutil.UniqueEmail("f02alice4"), "buyer")
	bob := testutil.CreateTestUser(t, testutil.UniqueEmail("f02bob4"), "provider")
	f02Block(t, bob, alice) // Bob blocks Alice

	for _, tc := range []struct {
		sender *models.User
		target *models.User
	}{{alice, bob}, {bob, alice}} {
		r := f02RouterAs(tc.sender.ID)
		r.POST("/friends/request/:userId", sendFriendRequest)
		req := httptest.NewRequest("POST", "/friends/request/"+tc.target.ID.String(), nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusForbidden {
			t.Fatalf("sender %s: expected 403, got %d. Body: %s", tc.sender.ID, w.Code, w.Body.String())
		}
	}

	if n := f02Count(t, &models.FriendRequest{}, "1 = 1"); n != 0 {
		t.Fatalf("expected no friend requests created, got %d", n)
	}
	if n := f02Count(t, &models.Notification{}, "1 = 1"); n != 0 {
		t.Fatalf("expected no notifications from blocked requests, got %d", n)
	}
}

func TestF02SuggestionsExcludeBlockedBothDirections(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "blocks", "friend_requests", "friendships")

	viewer := testutil.CreateTestUser(t, testutil.UniqueEmail("f02viewer"), "buyer")
	blockedByViewer := testutil.CreateTestUser(t, testutil.UniqueEmail("f02blockedby"), "provider")
	blockerOfViewer := testutil.CreateTestUser(t, testutil.UniqueEmail("f02blockerof"), "provider")
	neutral := testutil.CreateTestUser(t, testutil.UniqueEmail("f02neutral"), "provider")

	f02Block(t, viewer, blockedByViewer)
	f02Block(t, blockerOfViewer, viewer)

	r := f02RouterAs(viewer.ID)
	r.GET("/discover/people", getPeopleYouMayKnow)
	req := httptest.NewRequest("GET", "/discover/people", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !bytes.Contains(w.Body.Bytes(), []byte(neutral.ID.String())) {
		t.Fatalf("expected neutral user in suggestions. Body: %s", body)
	}
	for _, excluded := range []uuid.UUID{blockedByViewer.ID, blockerOfViewer.ID} {
		if bytes.Contains(w.Body.Bytes(), []byte(excluded.String())) {
			t.Fatalf("blocked user %s must not be suggested. Body: %s", excluded, body)
		}
	}
}

func TestF02BlockSeversFriendshipAndPendingRequests(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "blocks", "follows", "friendships", "friend_requests")

	alice := testutil.CreateTestUser(t, testutil.UniqueEmail("f02alice5"), "buyer")
	bob := testutil.CreateTestUser(t, testutil.UniqueEmail("f02bob5"), "provider")
	carol := testutil.CreateTestUser(t, testutil.UniqueEmail("f02carol5"), "buyer")

	// Alice <-> Bob: follows, friendship, and a pending request Carol->Alice
	// that must survive; Alice blocks Bob.
	mustCreate := func(v interface{}) {
		t.Helper()
		if err := db.DB.Create(v).Error; err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	mustCreate(&models.Follow{FollowerID: alice.ID, FollowingID: bob.ID})
	mustCreate(&models.Friendship{UserID: alice.ID, FriendID: bob.ID})
	mustCreate(&models.Friendship{UserID: bob.ID, FriendID: alice.ID})
	mustCreate(&models.FriendRequest{SenderID: bob.ID, ReceiverID: alice.ID, Status: models.FriendRequestPending})
	mustCreate(&models.FriendRequest{SenderID: carol.ID, ReceiverID: alice.ID, Status: models.FriendRequestPending})

	r := f02RouterAs(alice.ID)
	r.POST("/users/:id/block", blockUser)
	req := httptest.NewRequest("POST", "/users/"+bob.ID.String()+"/block", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("block: expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	if n := f02Count(t, &models.Block{}, "blocker_id = ? AND blocked_id = ?", alice.ID, bob.ID); n != 1 {
		t.Fatalf("expected block row, got %d", n)
	}
	if n := f02Count(t, &models.Follow{}, "(follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)", alice.ID, bob.ID, bob.ID, alice.ID); n != 0 {
		t.Fatalf("expected follows removed, got %d", n)
	}
	if n := f02Count(t, &models.Friendship{}, "(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", alice.ID, bob.ID, bob.ID, alice.ID); n != 0 {
		t.Fatalf("expected friendship removed, got %d", n)
	}
	if n := f02Count(t, &models.FriendRequest{}, "sender_id = ? AND receiver_id = ? AND status = ?", bob.ID, alice.ID, models.FriendRequestPending); n != 0 {
		t.Fatalf("expected bob->alice pending request removed, got %d", n)
	}
	if n := f02Count(t, &models.FriendRequest{}, "sender_id = ? AND receiver_id = ? AND status = ?", carol.ID, alice.ID, models.FriendRequestPending); n != 1 {
		t.Fatalf("expected carol->alice pending request preserved, got %d", n)
	}
}
