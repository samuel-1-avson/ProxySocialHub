package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// Discussions work like a timeline: text is the only required part of a post.

func quickPostRouter(userID uuid.UUID, role string) *gin.Engine {
	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		if userID != uuid.Nil {
			c.Set("user_id", userID)
		}
		if role != "" {
			c.Set("userRole", role)
		}
		c.Next()
	})
	RegisterForumPublicRoutes(r.Group(""))
	RegisterForumProtectedRoutes(r.Group(""))
	return r
}

func quickPostJSON(t *testing.T, r *gin.Engine, method, path string, body interface{}) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func generalCategory(t *testing.T) models.ForumCategory {
	t.Helper()
	var cat models.ForumCategory
	if err := db.DB.Where(models.ForumCategory{Slug: "general"}).
		FirstOrCreate(&cat, models.ForumCategory{Name: "General Discussion", Slug: "general", SortOrder: 1}).Error; err != nil {
		t.Fatalf("general category: %v", err)
	}
	return cat
}

func TestCreateThread_QuickPostNeedsOnlyText(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "forum_threads")
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("quick_poster"), "buyer")
	general := generalCategory(t)
	r := quickPostRouter(user.ID, "")

	w := quickPostJSON(t, r, "POST", "/forum/threads", map[string]string{"content": "  gm everyone 👋  "})
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 for a text-only post, got %d: %s", w.Code, w.Body.String())
	}
	var got forumThreadDTO
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Title != "" {
		t.Errorf("a post without a title must keep an empty title, got %q", got.Title)
	}
	if got.Content != "gm everyone 👋" {
		t.Errorf("content should be trimmed, got %q", got.Content)
	}
	if got.CategoryID != general.ID {
		t.Errorf("a post without a topic goes to General (%s), got %s", general.ID, got.CategoryID)
	}
	if !strings.HasPrefix(got.Slug, "gm-everyone-") {
		t.Errorf("slug should come from the text, got %q", got.Slug)
	}

	// The same text a second later must not reuse the slug.
	w2 := quickPostJSON(t, r, "POST", "/forum/threads", map[string]string{"content": "gm everyone 👋"})
	var second forumThreadDTO
	_ = json.Unmarshal(w2.Body.Bytes(), &second)
	if w2.Code != http.StatusCreated || second.Slug == got.Slug {
		t.Errorf("repeated text should still get its own slug: %d %q vs %q", w2.Code, second.Slug, got.Slug)
	}
}

func TestCreateThread_LengthRules(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "forum_threads")
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("length_rules"), "buyer")
	generalCategory(t)
	member := quickPostRouter(user.ID, "")
	moderator := quickPostRouter(user.ID, "moderator")

	cases := []struct {
		name   string
		router *gin.Engine
		body   map[string]string
		want   int
	}{
		{"empty text", member, map[string]string{"content": "   "}, http.StatusBadRequest},
		{"500 emoji count as 500 characters", member, map[string]string{"content": strings.Repeat("🔥", forumPostMaxRunes)}, http.StatusCreated},
		{"501 characters", member, map[string]string{"content": strings.Repeat("a", forumPostMaxRunes+1)}, http.StatusBadRequest},
		{"one-character post", member, map[string]string{"content": "k"}, http.StatusCreated},
		{"optional title over 200", member, map[string]string{"content": "hi", "title": strings.Repeat("t", forumTitleMaxRunes+1)}, http.StatusBadRequest},
		{"optional title kept", member, map[string]string{"content": "hi", "title": "Short title"}, http.StatusCreated},
		{"unknown topic", member, map[string]string{"content": "hi", "category_slug": "no-such-topic"}, http.StatusNotFound},
		{"moderator long announcement", moderator, map[string]string{"content": strings.Repeat("a", 5000)}, http.StatusCreated},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := quickPostJSON(t, tc.router, "POST", "/forum/threads", tc.body)
			if w.Code != tc.want {
				t.Fatalf("expected %d, got %d: %s", tc.want, w.Code, w.Body.String())
			}
		})
	}
}

func TestCreatePost_ReplyLengthRules(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "forum_threads", "forum_posts")
	user := testutil.CreateTestUser(t, testutil.UniqueEmail("reply_rules"), "buyer")
	cat := generalCategory(t)
	thread := models.ForumThread{CategoryID: cat.ID, AuthorID: user.ID, Title: "", Slug: "reply-rules", Content: "question?"}
	if err := db.DB.Create(&thread).Error; err != nil {
		t.Fatalf("create thread: %v", err)
	}
	r := quickPostRouter(user.ID, "")
	path := "/forum/threads/" + thread.ID.String() + "/posts"

	if w := quickPostJSON(t, r, "POST", path, map[string]string{"content": strings.Repeat("b", forumPostMaxRunes+1)}); w.Code != http.StatusBadRequest {
		t.Fatalf("a 501-character reply should be refused, got %d", w.Code)
	}
	w := quickPostJSON(t, r, "POST", path, map[string]string{"content": strings.Repeat("b", forumPostMaxRunes)})
	if w.Code != http.StatusCreated {
		t.Fatalf("a 500-character reply should post, got %d: %s", w.Code, w.Body.String())
	}
	var reply forumPostDTO
	_ = json.Unmarshal(w.Body.Bytes(), &reply)
	if w := quickPostJSON(t, r, "PATCH", "/forum/posts/"+reply.ID.String(), map[string]string{"content": strings.Repeat("c", forumPostMaxRunes+1)}); w.Code != http.StatusBadRequest {
		t.Fatalf("editing a reply past the limit should be refused, got %d", w.Code)
	}
}

func TestForumLists_CarryViewerLikeAndSolvedState(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "forum_threads", "forum_posts", "forum_votes")
	author := testutil.CreateTestUser(t, testutil.UniqueEmail("liked_author"), "buyer")
	viewer := testutil.CreateTestUser(t, testutil.UniqueEmail("liker"), "buyer")
	cat := generalCategory(t)
	thread := models.ForumThread{CategoryID: cat.ID, AuthorID: author.ID, Slug: "liked-post", Content: "how do I pair?"}
	if err := db.DB.Create(&thread).Error; err != nil {
		t.Fatalf("create thread: %v", err)
	}
	answer := models.ForumPost{ThreadID: thread.ID, AuthorID: viewer.ID, Content: "open the app", IsSolution: true}
	if err := db.DB.Create(&answer).Error; err != nil {
		t.Fatalf("create answer: %v", err)
	}

	asViewer := quickPostRouter(viewer.ID, "")
	like := func() map[string]interface{} {
		w := quickPostJSON(t, asViewer, "POST", "/forum/threads/"+thread.ID.String()+"/vote", map[string]int{"vote_type": 1})
		if w.Code != http.StatusOK {
			t.Fatalf("like: %d %s", w.Code, w.Body.String())
		}
		var out map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return out
	}
	if got := like(); got["viewer_vote"] != float64(1) || got["upvotes"] != float64(1) {
		t.Fatalf("first like should report viewer_vote 1 and 1 like, got %v", got)
	}

	findThread := func(r *gin.Engine) map[string]interface{} {
		w := quickPostJSON(t, r, "GET", "/forum/recent", nil)
		var out struct {
			Threads []map[string]interface{} `json:"threads"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		for _, th := range out.Threads {
			if th["id"] == thread.ID.String() {
				return th
			}
		}
		t.Fatalf("thread missing from /forum/recent: %s", w.Body.String())
		return nil
	}
	if th := findThread(asViewer); th["viewer_vote"] != float64(1) || th["has_solution"] != true {
		t.Errorf("viewer should see their like and the solved mark, got viewer_vote=%v has_solution=%v", th["viewer_vote"], th["has_solution"])
	}
	if th := findThread(quickPostRouter(uuid.Nil, "")); th["viewer_vote"] != nil {
		t.Errorf("an anonymous viewer must not see a like state, got %v", th["viewer_vote"])
	}
	if got := like(); got["viewer_vote"] != float64(0) || got["upvotes"] != float64(0) {
		t.Fatalf("liking again should unlike, got %v", got)
	}

	// Reply likes come back on the conversation view.
	w := quickPostJSON(t, asViewer, "POST", "/forum/posts/"+answer.ID.String()+"/vote", map[string]int{"vote_type": 1})
	if w.Code != http.StatusOK {
		t.Fatalf("like reply: %d %s", w.Code, w.Body.String())
	}
	w = quickPostJSON(t, asViewer, "GET", "/forum/threads/"+thread.ID.String(), nil)
	var detail struct {
		Thread map[string]interface{}   `json:"thread"`
		Posts  []map[string]interface{} `json:"posts"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &detail)
	if len(detail.Posts) != 1 || detail.Posts[0]["viewer_vote"] != float64(1) {
		t.Errorf("reply should carry the viewer's like, got %v", detail.Posts)
	}
	if detail.Thread["has_solution"] != true {
		t.Errorf("thread detail should say it is solved, got %v", detail.Thread["has_solution"])
	}
}

func TestFollowingThreads_ShowsOnlyFollowedAuthors(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.SetupTestRedis(t)
	testutil.CleanupTestData(t, "users", "forum_threads", "follows")
	me := testutil.CreateTestUser(t, testutil.UniqueEmail("follower"), "buyer")
	friend := testutil.CreateTestUser(t, testutil.UniqueEmail("followed"), "provider")
	stranger := testutil.CreateTestUser(t, testutil.UniqueEmail("stranger"), "buyer")
	cat := generalCategory(t)
	if err := db.DB.Create(&models.Follow{FollowerID: me.ID, FollowingID: friend.ID}).Error; err != nil {
		t.Fatalf("follow: %v", err)
	}
	for _, p := range []models.ForumThread{
		{CategoryID: cat.ID, AuthorID: friend.ID, Slug: "friend-post", Content: "from a friend"},
		{CategoryID: cat.ID, AuthorID: stranger.ID, Slug: "stranger-post", Content: "from a stranger"},
		{CategoryID: cat.ID, AuthorID: friend.ID, Slug: "friend-hidden", Content: "hidden", IsHidden: true},
	} {
		p := p
		if err := db.DB.Create(&p).Error; err != nil {
			t.Fatalf("create thread: %v", err)
		}
	}

	w := quickPostJSON(t, quickPostRouter(me.ID, ""), "GET", "/forum/following", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("following feed: %d %s", w.Code, w.Body.String())
	}
	var out struct {
		Threads []forumThreadDTO `json:"threads"`
		Total   int              `json:"total"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out.Total != 1 || len(out.Threads) != 1 || out.Threads[0].Content != "from a friend" {
		t.Fatalf("expected only the followed author's visible post, got total=%d %+v", out.Total, out.Threads)
	}

	anon := setupTestRouter()
	anon.GET("/forum/following", getFollowingThreads)
	if w := quickPostJSON(t, anon, "GET", "/forum/following", nil); w.Code != http.StatusUnauthorized {
		t.Errorf("the following feed needs a session, got %d", w.Code)
	}
}

// The tests below need no database.

func TestForumThreadLabel(t *testing.T) {
	cases := map[string]struct{ title, content, want string }{
		"title wins":             {"Pairing tips", "body", "Pairing tips"},
		"first line of the text": {"", "  gm\nsecond line", "gm"},
		"windows line ending":    {"", "first\r\nsecond", "first"},
		"long line is cut":       {"", strings.Repeat("é", 100), strings.Repeat("é", forumLabelMaxRunes) + "…"},
	}
	for name, tc := range cases {
		if got := forumThreadLabel(tc.title, tc.content); got != tc.want {
			t.Errorf("%s: got %q, want %q", name, got, tc.want)
		}
	}
}

func TestSlugifyNeverEmptyOrLeadingDash(t *testing.T) {
	for _, in := range []string{"🔥🔥", "", "---"} {
		got := slugify(in)
		if !strings.HasPrefix(got, "post-") {
			t.Errorf("slugify(%q) = %q, want a post- prefix", in, got)
		}
	}
	if a, b := slugify("gm"), slugify("gm"); a == b {
		t.Errorf("two slugs for the same text in the same second must differ: %q", a)
	}
}

func TestTruncateKeepsWholeCharacters(t *testing.T) {
	got := truncate(strings.Repeat("👋", 10), 5)
	if got != "👋👋..." {
		t.Errorf("got %q", got)
	}
	if got := truncate("short", 160); got != "short" {
		t.Errorf("short text must stay, got %q", got)
	}
	if got := truncate("abcdef", 2); got != "ab" {
		t.Errorf("tiny limits must not panic, got %q", got)
	}
}

func TestForumWriteLimiterKeysAreRouteScopedAndPerUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	userA, userB := uuid.New(), uuid.New()
	keyFor := func(route string, uid uuid.UUID) string {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/forum/threads", nil)
		if uid != uuid.Nil {
			c.Set("user_id", uid)
		}
		return forumWriteLimiterKey(route)(c)
	}
	if keyFor("thread", userA) == keyFor("thread_vote", userA) {
		t.Error("liking must not share the posting budget")
	}
	if keyFor("thread", userA) == keyFor("thread", userB) {
		t.Error("two users must not share one budget")
	}
	if !strings.Contains(keyFor("reply", userA), userA.String()) {
		t.Error("signed-in writes are keyed by user id, not by address")
	}
}
