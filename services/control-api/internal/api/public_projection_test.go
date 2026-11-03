package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// F01 regression fixtures: a synthetic user with distinctive private values.
// Community responses must expose the public identity (username/display
// name) but never private field names or values, including nested
// author / last_replier / sender / other_participant / friend relations.
const (
	f01PrivateEmail  = "f01-private-email@example.test"
	f01PrivateTaxID  = "F01-PRIVATE-TAX-ID-98765"
	f01PrivateWallet = "F01PrivateWalletAddress1111111111111111111"
	f01PrivateISP    = "F01-PRIVATE-ISP-EXAMPLE"
)

var f01ForbiddenKeys = []string{
	`"email"`,
	`"tax_id"`,
	`"kyc_status"`,
	`"wallet_address"`,
	`"email_verified"`,
	`"scheduled_deletion_at"`,
	`"verification_token"`,
}

var f01ForbiddenValues = []string{
	f01PrivateEmail,
	f01PrivateTaxID,
	f01PrivateWallet,
	f01PrivateISP,
}

func f01AssertNoPrivateLeak(t *testing.T, label, body string) {
	t.Helper()
	for _, key := range f01ForbiddenKeys {
		if strings.Contains(body, key) {
			t.Errorf("%s: response contains forbidden key %s. Body: %s", label, key, body)
		}
	}
	for _, value := range f01ForbiddenValues {
		if strings.Contains(body, value) {
			t.Errorf("%s: response contains private value %q. Body: %s", label, value, body)
		}
	}
	if !strings.Contains(body, "f01publicname") {
		t.Errorf("%s: expected public display name in response. Body: %s", label, body)
	}
}

// f01SeedPrivateUser creates a user and stamps private columns directly,
// bypassing save hooks so the fixture does not depend on vault config.
func f01SeedPrivateUser(t *testing.T) *models.User {
	t.Helper()
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("f01author"), "provider")
	if err := db.DB.Exec(
		`UPDATE profiles SET email = ?, tax_id = ?, wallet_address = ?, kyc_status = ?, isp = ?, username = ?, display_name = ?, avatar_url = ? WHERE id = ?`,
		f01PrivateEmail, f01PrivateTaxID, f01PrivateWallet, "approved", f01PrivateISP,
		"f01publicuser", "f01publicname", "https://example.test/avatar.png", user.ID,
	).Error; err != nil {
		t.Fatalf("seed private profile columns: %v", err)
	}
	return user
}

func TestF01PublicForumResponsesDoNotLeakPrivateUserFields(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "forum_categories", "forum_threads", "forum_posts")

	author := f01SeedPrivateUser(t)

	cat := models.ForumCategory{Name: "General", Slug: "f01-general"}
	if err := db.DB.Create(&cat).Error; err != nil {
		t.Fatalf("create category: %v", err)
	}
	thread := models.ForumThread{
		CategoryID:  cat.ID,
		AuthorID:    author.ID,
		Title:       "F01 leak check thread",
		Slug:        "f01-leak-check-thread",
		Content:     "Public thread content for the leak check.",
		LastReplyBy: &author.ID,
	}
	if err := db.DB.Create(&thread).Error; err != nil {
		t.Fatalf("create thread: %v", err)
	}
	post := models.ForumPost{ThreadID: thread.ID, AuthorID: author.ID, Content: "Public reply content."}
	if err := db.DB.Create(&post).Error; err != nil {
		t.Fatalf("create post: %v", err)
	}

	r := setupTestRouter()
	RegisterForumPublicRoutes(r.Group(""))

	paths := []string{
		"/forum/recent",
		"/forum/popular",
		"/forum/categories/f01-general/threads",
		"/forum/threads/" + thread.ID.String(),
		"/forum/threads/slug/f01-leak-check-thread",
		"/forum/threads/" + thread.ID.String() + "/posts",
		"/forum/search?q=leak",
	}
	for _, path := range paths {
		req := httptest.NewRequest("GET", path, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("GET %s: expected 200, got %d. Body: %s", path, w.Code, w.Body.String())
		}
		f01AssertNoPrivateLeak(t, "GET "+path, w.Body.String())
	}
}

func TestF01InboxResponsesDoNotLeakPrivateUserFields(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "conversations", "messages")

	viewer := testutil.CreateTestUser(t, testutil.UniqueEmail("f01viewer"), "buyer")
	other := f01SeedPrivateUser(t)

	conversation := models.Conversation{Participant1: viewer.ID, Participant2: other.ID}
	if err := db.DB.Create(&conversation).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	msg := models.Message{ConversationID: conversation.ID, SenderID: other.ID, Content: "Hello there"}
	if err := db.DB.Create(&msg).Error; err != nil {
		t.Fatalf("create message: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", viewer.ID)
		c.Next()
	})
	r.GET("/conversations", getConversations)
	r.GET("/conversations/:id/messages", getMessages)
	r.GET("/conversations/:id/search", searchMessages)

	paths := []string{
		"/conversations",
		"/conversations/" + conversation.ID.String() + "/messages",
		"/conversations/" + conversation.ID.String() + "/search?q=Hello",
	}
	for _, path := range paths {
		req := httptest.NewRequest("GET", path, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("GET %s: expected 200, got %d. Body: %s", path, w.Code, w.Body.String())
		}
		f01AssertNoPrivateLeak(t, "GET "+path, w.Body.String())
	}
}

func TestF01FeedActorDoesNotLeakPrivateUserFields(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "follows", "feed_events")

	viewer := testutil.CreateTestUser(t, testutil.UniqueEmail("f01feedviewer"), "buyer")
	other := f01SeedPrivateUser(t)

	if err := db.DB.Create(&models.Follow{FollowerID: viewer.ID, FollowingID: other.ID}).Error; err != nil {
		t.Fatalf("create follow: %v", err)
	}
	event := models.FeedEvent{
		ActorID:   &other.ID,
		EventType: models.FeedEventNewThread,
		Content:   "posted a thread",
	}
	if err := db.DB.Create(&event).Error; err != nil {
		t.Fatalf("create feed event: %v", err)
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("userID", viewer.ID.String())
		c.Next()
	})
	r.GET("/feed", getFeed)

	req := httptest.NewRequest("GET", "/feed", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET /feed: expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	f01AssertNoPrivateLeak(t, "GET /feed", w.Body.String())
}

func TestF01MutualFriendsDoNotLeakPrivateUserFields(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "friendships")

	viewer := testutil.CreateTestUser(t, testutil.UniqueEmail("f01mfviewer"), "buyer")
	target := testutil.CreateTestUser(t, testutil.UniqueEmail("f01mftarget"), "buyer")
	mutual := f01SeedPrivateUser(t)

	for _, pair := range [][2]*models.User{{viewer, mutual}, {target, mutual}} {
		row := models.Friendship{UserID: pair[0].ID, FriendID: pair[1].ID}
		if err := db.DB.Create(&row).Error; err != nil {
			t.Fatalf("create friendship: %v", err)
		}
	}

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", viewer.ID)
		c.Next()
	})
	r.GET("/users/:id/mutual-friends", getMutualFriends)
	r.GET("/friends", listFriends)

	for _, path := range []string{"/users/" + target.ID.String() + "/mutual-friends", "/friends"} {
		req := httptest.NewRequest("GET", path, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("GET %s: expected 200, got %d. Body: %s", path, w.Code, w.Body.String())
		}
		f01AssertNoPrivateLeak(t, "GET "+path, w.Body.String())
	}
}
