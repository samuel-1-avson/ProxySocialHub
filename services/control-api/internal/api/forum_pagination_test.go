package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/testutil"
)

// F07/F11: forum continuation (category + collection pagination), an
// accepted answer reachable beyond the first reply page, and an atomic
// at-most-one-solution invariant.

func f07SeedCategoryWithThreads(t *testing.T, author *models.User, slug string, n int) models.ForumCategory {
	t.Helper()
	cat := models.ForumCategory{Name: "Paged " + slug, Slug: slug}
	if err := db.DB.Create(&cat).Error; err != nil {
		t.Fatalf("create category: %v", err)
	}
	for i := 0; i < n; i++ {
		thread := models.ForumThread{
			CategoryID: cat.ID,
			AuthorID:   author.ID,
			Title:      fmt.Sprintf("Paged thread %02d", i),
			Slug:       fmt.Sprintf("%s-thread-%02d", slug, i),
			Content:    "Paged thread content",
		}
		if err := db.DB.Create(&thread).Error; err != nil {
			t.Fatalf("create thread %d: %v", i, err)
		}
	}
	return cat
}

type f07ThreadPage struct {
	Threads []models.ForumThread `json:"threads"`
	Total   int64                `json:"total"`
	HasMore bool                 `json:"has_more"`
}

func f07GetThreads(t *testing.T, r *gin.Engine, path string) f07ThreadPage {
	t.Helper()
	req := httptest.NewRequest("GET", path, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET %s: expected 200, got %d. Body: %s", path, w.Code, w.Body.String())
	}
	var page f07ThreadPage
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
	return page
}

func TestF07CategoryThreadsPaginate(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "forum_categories", "forum_threads", "forum_posts")

	author := testutil.CreateTestUser(t, testutil.UniqueEmail("f07author"), "buyer")
	f07SeedCategoryWithThreads(t, author, "f07-paged", 25)

	r := setupTestRouter()
	RegisterForumPublicRoutes(r.Group(""))

	first := f07GetThreads(t, r, "/forum/categories/f07-paged/threads?page=1&limit=20")
	if len(first.Threads) != 20 || first.Total != 25 || !first.HasMore {
		t.Fatalf("page 1: expected 20/25 has_more=true, got %d/%d has_more=%v", len(first.Threads), first.Total, first.HasMore)
	}
	second := f07GetThreads(t, r, "/forum/categories/f07-paged/threads?page=2&limit=20")
	if len(second.Threads) != 5 || second.HasMore {
		t.Fatalf("page 2: expected 5 has_more=false, got %d has_more=%v", len(second.Threads), second.HasMore)
	}
	seen := map[uuid.UUID]bool{}
	for _, th := range append(first.Threads, second.Threads...) {
		if seen[th.ID] {
			t.Fatalf("duplicate thread across pages: %s", th.ID)
		}
		seen[th.ID] = true
	}
	if len(seen) != 25 {
		t.Fatalf("expected 25 unique threads, got %d", len(seen))
	}
}

func TestF07RecentThreadsPaginate(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "forum_categories", "forum_threads", "forum_posts")

	author := testutil.CreateTestUser(t, testutil.UniqueEmail("f07recent"), "buyer")
	f07SeedCategoryWithThreads(t, author, "f07-recent", 25)

	r := setupTestRouter()
	RegisterForumPublicRoutes(r.Group(""))

	first := f07GetThreads(t, r, "/forum/recent?page=1&limit=20")
	second := f07GetThreads(t, r, "/forum/recent?page=2&limit=20")
	if len(first.Threads) != 20 || len(second.Threads) != 5 {
		t.Fatalf("expected 20+5 recent threads, got %d+%d", len(first.Threads), len(second.Threads))
	}
	if !first.HasMore || second.HasMore {
		t.Fatalf("expected has_more true then false, got %v/%v", first.HasMore, second.HasMore)
	}
}

func TestF07SolutionReachableBeyondFirstReplyPage(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "forum_categories", "forum_threads", "forum_posts")

	author := testutil.CreateTestUser(t, testutil.UniqueEmail("f07solver"), "buyer")
	cat := models.ForumCategory{Name: "Solved", Slug: "f07-solved"}
	if err := db.DB.Create(&cat).Error; err != nil {
		t.Fatalf("create category: %v", err)
	}
	thread := models.ForumThread{
		CategoryID: cat.ID, AuthorID: author.ID,
		Title: "Long solved thread", Slug: "f07-long-solved", Content: "Question body",
	}
	if err := db.DB.Create(&thread).Error; err != nil {
		t.Fatalf("create thread: %v", err)
	}
	var solution models.ForumPost
	for i := 0; i < 25; i++ {
		post := models.ForumPost{
			ThreadID: thread.ID, AuthorID: author.ID,
			Content:    fmt.Sprintf("reply %02d", i),
			IsSolution: i == 24,
		}
		if err := db.DB.Create(&post).Error; err != nil {
			t.Fatalf("create post %d: %v", i, err)
		}
		if i == 24 {
			solution = post
		}
	}

	r := setupTestRouter()
	RegisterForumPublicRoutes(r.Group(""))

	req := httptest.NewRequest("GET", "/forum/threads/"+thread.ID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Posts        []models.ForumPost `json:"posts"`
		TotalPosts   int64              `json:"total_posts"`
		SolutionPost *models.ForumPost  `json:"solution_post"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.TotalPosts != 25 || len(resp.Posts) != 20 {
		t.Fatalf("expected first page 20 of 25, got %d of %d", len(resp.Posts), resp.TotalPosts)
	}
	for _, p := range resp.Posts {
		if p.ID == solution.ID {
			t.Fatalf("test setup wrong: solution should be beyond page 1")
		}
	}
	if resp.SolutionPost == nil || resp.SolutionPost.ID != solution.ID {
		t.Fatalf("expected solution_post %s in response, got %+v", solution.ID, resp.SolutionPost)
	}
}

func f11MarkSolution(t *testing.T, as uuid.UUID, postID uuid.UUID, value bool) *httptest.ResponseRecorder {
	t.Helper()
	r := setupTestRouter()
	r.Use(func(c *gin.Context) { c.Set("user_id", as); c.Next() })
	r.POST("/forum/posts/:id/solution", markPostSolution)
	body, _ := json.Marshal(map[string]bool{"is_solution": value})
	req := httptest.NewRequest("POST", "/forum/posts/"+postID.String()+"/solution", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func f11SolutionCount(t *testing.T, threadID uuid.UUID) int64 {
	t.Helper()
	var n int64
	db.DB.Model(&models.ForumPost{}).Where("thread_id = ? AND is_solution = true", threadID).Count(&n)
	return n
}

func TestF11MarkingSecondSolutionLeavesExactlyOne(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "forum_categories", "forum_threads", "forum_posts")

	author := testutil.CreateTestUser(t, testutil.UniqueEmail("f11author"), "buyer")
	cat := models.ForumCategory{Name: "Atomic", Slug: "f11-atomic"}
	if err := db.DB.Create(&cat).Error; err != nil {
		t.Fatalf("create category: %v", err)
	}
	thread := models.ForumThread{CategoryID: cat.ID, AuthorID: author.ID, Title: "Atomic thread", Slug: "f11-thread", Content: "Q"}
	if err := db.DB.Create(&thread).Error; err != nil {
		t.Fatalf("create thread: %v", err)
	}
	var posts []models.ForumPost
	for i := 0; i < 2; i++ {
		p := models.ForumPost{ThreadID: thread.ID, AuthorID: author.ID, Content: fmt.Sprintf("answer %d", i)}
		if err := db.DB.Create(&p).Error; err != nil {
			t.Fatalf("create post: %v", err)
		}
		posts = append(posts, p)
	}

	if w := f11MarkSolution(t, author.ID, posts[0].ID, true); w.Code != http.StatusOK {
		t.Fatalf("mark first: expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	if w := f11MarkSolution(t, author.ID, posts[1].ID, true); w.Code != http.StatusOK {
		t.Fatalf("mark second: expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	if n := f11SolutionCount(t, thread.ID); n != 1 {
		t.Fatalf("expected exactly 1 solution, got %d", n)
	}
	var winner models.ForumPost
	db.DB.First(&winner, "thread_id = ? AND is_solution = true", thread.ID)
	if winner.ID != posts[1].ID {
		t.Fatalf("expected second post to be the solution, got %s", winner.ID)
	}
}

func TestF11FailedSolutionUpdateLeavesPreviousSolutionIntact(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "forum_categories", "forum_threads", "forum_posts")

	author := testutil.CreateTestUser(t, testutil.UniqueEmail("f11fail"), "buyer")
	cat := models.ForumCategory{Name: "Atomic fail", Slug: "f11-atomic-fail"}
	if err := db.DB.Create(&cat).Error; err != nil {
		t.Fatalf("create category: %v", err)
	}
	thread := models.ForumThread{CategoryID: cat.ID, AuthorID: author.ID, Title: "Atomic fail thread", Slug: "f11-fail-thread", Content: "Q"}
	if err := db.DB.Create(&thread).Error; err != nil {
		t.Fatalf("create thread: %v", err)
	}
	first := models.ForumPost{ThreadID: thread.ID, AuthorID: author.ID, Content: "good answer", IsSolution: true}
	second := models.ForumPost{ThreadID: thread.ID, AuthorID: author.ID, Content: "F11-FAIL-MARKER answer"}
	if err := db.DB.Create(&first).Error; err != nil {
		t.Fatalf("create first: %v", err)
	}
	if err := db.DB.Create(&second).Error; err != nil {
		t.Fatalf("create second: %v", err)
	}

	if err := db.DB.Exec(`
		CREATE OR REPLACE FUNCTION f11_fail_solution() RETURNS trigger AS $fn$
		BEGIN
			IF NEW.is_solution = true AND NEW.content LIKE '%F11-FAIL-MARKER%' THEN
				RAISE EXCEPTION 'injected solution failure';
			END IF;
			RETURN NEW;
		END;
		$fn$ LANGUAGE plpgsql;
	`).Error; err != nil {
		t.Fatalf("create failure function: %v", err)
	}
	if err := db.DB.Exec(`
		CREATE TRIGGER f11_fail_solution_trg BEFORE UPDATE ON forum_posts
		FOR EACH ROW EXECUTE FUNCTION f11_fail_solution();
	`).Error; err != nil {
		t.Fatalf("create failure trigger: %v", err)
	}
	t.Cleanup(func() {
		db.DB.Exec(`DROP TRIGGER IF EXISTS f11_fail_solution_trg ON forum_posts`)
		db.DB.Exec(`DROP FUNCTION IF EXISTS f11_fail_solution()`)
	})

	w := f11MarkSolution(t, author.ID, second.ID, true)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 on injected failure, got %d. Body: %s", w.Code, w.Body.String())
	}
	if n := f11SolutionCount(t, thread.ID); n != 1 {
		t.Fatalf("expected previous solution intact (1), got %d", n)
	}
	var stored models.ForumPost
	db.DB.First(&stored, "id = ?", first.ID)
	if !stored.IsSolution {
		t.Fatalf("failed update must not clear the previous solution")
	}
}
