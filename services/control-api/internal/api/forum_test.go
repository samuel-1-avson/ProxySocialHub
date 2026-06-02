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

func TestGetCategories(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "forum_categories", "forum_threads")

	// Create test categories
	cat1 := models.ForumCategory{
		Name:      "General",
		Slug:      "general",
		SortOrder: 1,
	}
	cat2 := models.ForumCategory{
		Name:      "Support",
		Slug:      "support",
		SortOrder: 2,
	}
	db.DB.Create(&cat1)
	db.DB.Create(&cat2)

	r := setupTestRouter()
	r.GET("/forum/categories", getCategories)

	req := httptest.NewRequest("GET", "/forum/categories", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	cats := response["categories"].([]interface{})
	if len(cats) != 2 {
		t.Errorf("Expected 2 categories, got %d", len(cats))
	}
}

func TestCreateThread_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "forum_categories", "forum_threads")

	email := testutil.UniqueEmail("thread_author")
	user := testutil.CreateTestUser(t, email, "buyer")

	cat := models.ForumCategory{
		Name: "General Discussion",
		Slug: "general-discussion",
	}
	db.DB.Create(&cat)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID)
		c.Next()
	})
	r.POST("/forum/threads", createThread)

	body := CreateThreadRequest{
		CategorySlug: "general-discussion",
		Title:        "Hello World",
		Content:      "This is my first thread",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/forum/threads", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusCreated, w.Code, w.Body.String())
	}

	var thread models.ForumThread
	json.Unmarshal(w.Body.Bytes(), &thread)

	if thread.Title != "Hello World" {
		t.Errorf("Expected title 'Hello World', got '%s'", thread.Title)
	}
	if thread.AuthorID != user.ID {
		t.Errorf("Expected author ID %s, got %s", user.ID, thread.AuthorID)
	}
}

func TestCreatePost_Success(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "forum_categories", "forum_threads", "forum_posts")

	email := testutil.UniqueEmail("post_author")
	user := testutil.CreateTestUser(t, email, "buyer")

	cat := models.ForumCategory{Name: "General", Slug: "general"}
	db.DB.Create(&cat)

	thread := models.ForumThread{
		CategoryID: cat.ID,
		AuthorID:   user.ID,
		Title:      "Test Thread",
		Slug:       "test-thread",
		Content:    "Content",
	}
	db.DB.Create(&thread)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID)
		c.Next()
	})
	r.POST("/forum/threads/:id/posts", createPost)

	body := CreatePostRequest{
		Content: "This is a reply",
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/forum/threads/"+thread.ID.String()+"/posts", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("Expected status %d, got %d. Body: %s", http.StatusCreated, w.Code, w.Body.String())
	}

	// Verify thread stats updated
	var updatedThread models.ForumThread
	db.DB.First(&updatedThread, "id = ?", thread.ID)
	if updatedThread.RepliesCount != 1 {
		t.Errorf("Expected replies count 1, got %d", updatedThread.RepliesCount)
	}
}

func TestVotePost_Upvote(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "forum_categories", "forum_threads", "forum_posts", "forum_votes")

	email := testutil.UniqueEmail("voter")
	user := testutil.CreateTestUser(t, email, "buyer")

	cat := models.ForumCategory{Name: "General", Slug: "general"}
	db.DB.Create(&cat)

	thread := models.ForumThread{
		CategoryID: cat.ID,
		AuthorID:   user.ID,
		Title:      "Test Thread",
		Slug:       "test-thread",
		Content:    "Content",
	}
	db.DB.Create(&thread)

	post := models.ForumPost{
		ThreadID: thread.ID,
		AuthorID: user.ID,
		Content:  "Post content",
	}
	db.DB.Create(&post)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID)
		c.Next()
	})
	r.POST("/forum/posts/:id/vote", votePost)

	body := VoteRequest{
		VoteType: 1,
	}
	jsonBody, _ := json.Marshal(body)

	req := httptest.NewRequest("POST", "/forum/posts/"+post.ID.String()+"/vote", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	// Verify vote count
	var updatedPost models.ForumPost
	db.DB.First(&updatedPost, "id = ?", post.ID)
	if updatedPost.Upvotes != 1 {
		t.Errorf("Expected upvotes 1, got %d", updatedPost.Upvotes)
	}
}

func TestGetThread(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "forum_categories", "forum_threads", "forum_posts")

	email := testutil.UniqueEmail("thread_viewer")
	user := testutil.CreateTestUser(t, email, "buyer")

	cat := models.ForumCategory{Name: "General", Slug: "general"}
	db.DB.Create(&cat)

	thread := models.ForumThread{
		CategoryID: cat.ID,
		AuthorID:   user.ID,
		Title:      "Test Thread",
		Slug:       "test-thread",
		Content:    "Content",
	}
	db.DB.Create(&thread)

	r := setupTestRouter()
	r.GET("/forum/threads/:id", getThread)

	req := httptest.NewRequest("GET", "/forum/threads/"+thread.ID.String(), nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status %d, got %d", http.StatusOK, w.Code)
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	respThread := response["thread"].(map[string]interface{})
	if respThread["id"] != thread.ID.String() {
		t.Errorf("Expected thread ID %s, got %s", thread.ID, respThread["id"])
	}

	// Verify view count increment
	var updatedThread models.ForumThread
	db.DB.First(&updatedThread, "id = ?", thread.ID)
	if updatedThread.ViewsCount != 1 {
		t.Errorf("Expected views count 1, got %d", updatedThread.ViewsCount)
	}
}

func TestRegisterForumRoutes(t *testing.T) {
	r := setupTestRouter()
	RegisterForumRoutes(r.Group(""))
}

func TestGetThreadBySlug(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "forum_categories", "forum_threads", "forum_posts")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("thread_slug_viewer"), "buyer")

	cat := models.ForumCategory{Name: "General", Slug: "general"}
	db.DB.Create(&cat)

	thread := models.ForumThread{
		CategoryID: cat.ID,
		AuthorID:   user.ID,
		Title:      "Slug Thread",
		Slug:       "slug-thread",
		Content:    "Content",
	}
	db.DB.Create(&thread)

	post := models.ForumPost{
		ThreadID: thread.ID,
		AuthorID: user.ID,
		Content:  "Reply",
	}
	db.DB.Create(&post)

	r := setupTestRouter()
	r.GET("/forum/threads/slug/:slug", getThreadBySlug)

	req := httptest.NewRequest("GET", "/forum/threads/slug/slug-thread", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	respThread := response["thread"].(map[string]interface{})
	if respThread["id"] != thread.ID.String() {
		t.Errorf("Expected thread ID %s, got %s", thread.ID, respThread["id"])
	}

	posts := response["posts"].([]interface{})
	if len(posts) != 1 {
		t.Errorf("Expected 1 post, got %d", len(posts))
	}
}

func TestGetThreadPosts(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "forum_categories", "forum_threads", "forum_posts")

	user := testutil.CreateTestUser(t, testutil.UniqueEmail("thread_posts_viewer"), "buyer")

	cat := models.ForumCategory{Name: "General", Slug: "general"}
	db.DB.Create(&cat)

	thread := models.ForumThread{
		CategoryID: cat.ID,
		AuthorID:   user.ID,
		Title:      "Thread With Posts",
		Slug:       "thread-with-posts",
		Content:    "Content",
	}
	db.DB.Create(&thread)

	db.DB.Create(&models.ForumPost{ThreadID: thread.ID, AuthorID: user.ID, Content: "Reply 1"})
	db.DB.Create(&models.ForumPost{ThreadID: thread.ID, AuthorID: user.ID, Content: "Reply 2"})

	r := setupTestRouter()
	r.GET("/forum/threads/:id/posts", getThreadPosts)

	req := httptest.NewRequest("GET", "/forum/threads/"+thread.ID.String()+"/posts", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	posts := response["posts"].([]interface{})
	if len(posts) != 2 {
		t.Errorf("Expected 2 posts, got %d", len(posts))
	}
	if int(response["total"].(float64)) != 2 {
		t.Errorf("Expected total 2, got %v", response["total"])
	}
}

func TestUpdatePost_OnlyAuthorCanEdit(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "forum_categories", "forum_threads", "forum_posts")

	author := testutil.CreateTestUser(t, testutil.UniqueEmail("post_author"), "buyer")
	other := testutil.CreateTestUser(t, testutil.UniqueEmail("post_intruder"), "buyer")

	cat := models.ForumCategory{Name: "General", Slug: "general"}
	db.DB.Create(&cat)

	thread := models.ForumThread{
		CategoryID: cat.ID,
		AuthorID:   author.ID,
		Title:      "Editable Thread",
		Slug:       "editable-thread",
		Content:    "Content",
	}
	db.DB.Create(&thread)

	post := models.ForumPost{
		ThreadID: thread.ID,
		AuthorID: author.ID,
		Content:  "Original",
	}
	db.DB.Create(&post)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", other.ID)
		c.Next()
	})
	r.PATCH("/forum/posts/:id", updatePost)

	jsonBody, _ := json.Marshal(UpdatePostRequest{Content: "Changed"})
	req := httptest.NewRequest("PATCH", "/forum/posts/"+post.ID.String(), bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusForbidden, w.Code, w.Body.String())
	}
}

func TestDeletePost_DeletesOwnPost(t *testing.T) {
	testutil.SetupTestDB(t)
	testutil.CleanupTestData(t, "users", "forum_categories", "forum_threads", "forum_posts", "forum_votes")

	author := testutil.CreateTestUser(t, testutil.UniqueEmail("post_delete_author"), "buyer")

	cat := models.ForumCategory{Name: "General", Slug: "general"}
	db.DB.Create(&cat)

	thread := models.ForumThread{
		CategoryID:   cat.ID,
		AuthorID:     author.ID,
		Title:        "Delete Thread",
		Slug:         "delete-thread",
		Content:      "Content",
		RepliesCount: 1,
	}
	db.DB.Create(&thread)

	post := models.ForumPost{
		ThreadID: thread.ID,
		AuthorID: author.ID,
		Content:  "Delete me",
	}
	db.DB.Create(&post)

	r := setupTestRouter()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", author.ID)
		c.Next()
	})
	r.DELETE("/forum/posts/:id", deletePost)

	req := httptest.NewRequest("DELETE", "/forum/posts/"+post.ID.String(), nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status %d, got %d. Body: %s", http.StatusOK, w.Code, w.Body.String())
	}

	var count int64
	db.DB.Model(&models.ForumPost{}).Where("id = ?", post.ID).Count(&count)
	if count != 0 {
		t.Errorf("Expected deleted post, got count %d", count)
	}

	var updatedThread models.ForumThread
	db.DB.First(&updatedThread, "id = ?", thread.ID)
	if updatedThread.RepliesCount != 0 {
		t.Errorf("Expected replies count 0, got %d", updatedThread.RepliesCount)
	}
}
