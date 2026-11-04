package api

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"github.com/proxyhubb/control-api/internal/ratelimiter"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// RegisterForumPublicRoutes registers read-only community forum routes.
func RegisterForumPublicRoutes(rg *gin.RouterGroup) {
	rg.GET("/forum/categories", getCategories)
	rg.GET("/forum/categories/:slug", getCategory)
	rg.GET("/forum/categories/:slug/threads", getCategoryThreads)
	rg.GET("/forum/threads/slug/:slug", getThreadBySlug)
	rg.GET("/forum/threads/:id", getThread)
	rg.GET("/forum/threads/:id/posts", getThreadPosts)
	rg.GET("/forum/search", searchForum)
	rg.GET("/forum/recent", getRecentThreads)
	rg.GET("/forum/popular", getPopularThreads)
	rg.GET("/forum/unanswered", getUnansweredThreads)
}

// RegisterForumProtectedRoutes registers forum routes that require a user session.
func RegisterForumProtectedRoutes(rg *gin.RouterGroup) {
	rg.POST("/forum/threads", forumWriteLimiter("thread", forumThreadsPerMinute), createThread)
	rg.POST("/forum/threads/:id/posts", forumWriteLimiter("reply", forumRepliesPerMinute), createPost)
	rg.PATCH("/forum/posts/:id", updatePost)
	rg.DELETE("/forum/posts/:id", deletePost)
	rg.POST("/forum/posts/:id/vote", forumWriteLimiter("post_vote", forumVotesPerMinute), votePost)
	rg.POST("/forum/threads/:id/vote", forumWriteLimiter("thread_vote", forumVotesPerMinute), voteThread)
	rg.POST("/forum/threads/:id/report", RateLimitWithConfig(10, time.Minute), reportThread)
	rg.POST("/forum/posts/:id/report", RateLimitWithConfig(10, time.Minute), reportPost)
	rg.POST("/forum/posts/:id/solution", markPostSolution)
	rg.GET("/forum/my-posts", getMyPosts)
	rg.GET("/forum/my-threads", getMyThreads)
	rg.GET("/forum/following", getFollowingThreads)
}

// Discussions work like a timeline: a post is short text with an optional
// title and an optional topic. Moderators keep the long limits so
// announcements and guides still fit.
const (
	forumPostMaxRunes            = 500
	forumTitleMaxRunes           = 200
	forumModeratorThreadMaxRunes = 20000
	forumModeratorReplyMaxRunes  = 10000
	forumDefaultCategorySlug     = "general"
	forumLabelMaxRunes           = 80

	forumThreadsPerMinute = 10
	forumRepliesPerMinute = 30
	forumVotesPerMinute   = 120
)

// forumWriteLimiter is a per-minute limit private to one forum write route.
//
// RateLimitWithConfig keys only by caller and reads c.Get("userID"), which the
// session middleware may not set, so every forum write used to share one
// budget, possibly per shared edge address. Liking a few posts could then
// block the next post. This limiter keys each route by the signed-in user
// (GetUserID), like pairingLimiter in provider_pairing.go.
func forumWriteLimiter(route string, perMinute int) gin.HandlerFunc {
	return ratelimiter.AdvancedRateLimit(ratelimiter.AdvancedRateLimitConfig{
		Algorithm: ratelimiter.SlidingWindow,
		Limit:     perMinute,
		Window:    time.Minute,
		KeyFunc:   forumWriteLimiterKey(route),
	})
}

func forumWriteLimiterKey(route string) func(c *gin.Context) string {
	return func(c *gin.Context) string {
		if uid, ok := GetUserID(c); ok {
			return "forum_write:" + route + ":user:" + uid.String()
		}
		return "forum_write:" + route + ":ip:" + c.ClientIP()
	}
}

// RegisterForumRoutes registers all community forum routes on the given group.
// Prefer RegisterForumPublicRoutes and RegisterForumProtectedRoutes in app setup
// so read and write auth policies stay explicit.
func RegisterForumRoutes(rg *gin.RouterGroup) {
	RegisterForumPublicRoutes(rg)
	RegisterForumProtectedRoutes(rg)
}

// getCategories returns all forum categories
func getCategories(c *gin.Context) {
	var categories []models.ForumCategory
	db.Social().Order("sort_order ASC").Find(&categories)

	// Auto-seed default categories if none exist
	if len(categories) == 0 {
		defaultCategories := []models.ForumCategory{
			{Name: "General Discussion", Slug: "general", Description: "General topics and discussions about proxy services", SortOrder: 1},
			{Name: "Technical Support", Slug: "support", Description: "Get help with technical issues and troubleshooting", SortOrder: 2},
			{Name: "Feature Requests", Slug: "features", Description: "Suggest new features and improvements", SortOrder: 3},
			{Name: "Provider Showcase", Slug: "showcase", Description: "Share your proxy setups and configurations", SortOrder: 4},
			{Name: "Buying & Selling", Slug: "marketplace", Description: "Discuss proxy purchases, deals, and recommendations", SortOrder: 5},
			{Name: "Announcements", Slug: "announcements", Description: "Official announcements and updates from the team", SortOrder: 6},
		}

		for i := range defaultCategories {
			db.Social().Create(&defaultCategories[i])
		}

		categories = defaultCategories
	}

	// Count threads per category
	type CategoryWithCount struct {
		models.ForumCategory
		ThreadCount int `json:"thread_count"`
	}

	result := make([]CategoryWithCount, len(categories))
	for i, cat := range categories {
		var count int64
		db.Social().Model(&models.ForumThread{}).Where("category_id = ? AND is_hidden = ?", cat.ID, false).Count(&count)
		result[i] = CategoryWithCount{
			ForumCategory: cat,
			ThreadCount:   int(count),
		}
	}

	c.JSON(http.StatusOK, gin.H{"categories": result})
}

// getCategory returns a single category by slug
func getCategory(c *gin.Context) {
	slug := c.Param("slug")

	var category models.ForumCategory
	if err := db.Social().Where("slug = ?", slug).First(&category).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Category not found"})
		return
	}

	// Count threads in category
	var threadCount int64
	db.Social().Model(&models.ForumThread{}).Where("category_id = ? AND is_hidden = ?", category.ID, false).Count(&threadCount)

	c.JSON(http.StatusOK, gin.H{
		"category":     category,
		"thread_count": threadCount,
	})
}

// getCategoryThreads returns threads in a category
func getCategoryThreads(c *gin.Context) {
	slug := c.Param("slug")

	var category models.ForumCategory
	if err := db.Social().Where("slug = ?", slug).First(&category).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Category not found"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)

	countQ := db.Social().Model(&models.ForumThread{}).Where("category_id = ?", category.ID)
	listQ := db.Social().Preload("Author").Preload("LastReplier").
		Where("category_id = ?", category.ID)
	if !isPlatformModerator(c) {
		countQ = countQ.Where("is_hidden = ?", false)
		listQ = listQ.Where("is_hidden = ?", false)
	}

	var total int64
	if err := countQ.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch threads"})
		return
	}

	var threads []models.ForumThread
	if err := listQ.Order("is_pinned DESC, last_reply_at DESC NULLS LAST, created_at DESC, id DESC").
		Offset((page - 1) * limit).Limit(limit).
		Find(&threads).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch threads"})
		return
	}
	if threads == nil {
		threads = []models.ForumThread{}
	}

	c.JSON(http.StatusOK, gin.H{
		"category": category,
		"threads":  decoratedForumThreads(c, threads),
		"total":    total,
		"page":     page,
		"limit":    limit,
		"has_more": int64(page*limit) < total,
	})
}

// getThread returns a single thread with posts
func getThread(c *gin.Context) {
	threadID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid thread ID"})
		return
	}

	var thread models.ForumThread
	if err := db.Social().Preload("Author").Preload("Category").First(&thread, "id = ?", threadID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Thread not found"})
		return
	}

	renderThreadWithPosts(c, thread, true)
}

// getThreadBySlug returns a single thread with posts by slug.
func getThreadBySlug(c *gin.Context) {
	slug := c.Param("slug")
	if slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid thread slug"})
		return
	}

	var thread models.ForumThread
	if err := db.Social().Preload("Author").Preload("Category").First(&thread, "slug = ?", slug).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Thread not found"})
		return
	}

	renderThreadWithPosts(c, thread, true)
}

// getThreadPosts returns posts for a thread without the thread envelope.
func getThreadPosts(c *gin.Context) {
	threadID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid thread ID"})
		return
	}

	var count int64
	if err := db.Social().Model(&models.ForumThread{}).Where("id = ?", threadID).Count(&count).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch thread"})
		return
	}
	if count == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Thread not found"})
		return
	}

	posts, totalPosts, page, limit, err := loadThreadPosts(c, threadID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch posts"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"posts": decoratedForumPosts(c, posts),
		"total": totalPosts,
		"page":  page,
		"limit": limit,
	})
}

func renderThreadWithPosts(c *gin.Context, thread models.ForumThread, incrementViews bool) {
	if thread.IsHidden && !isPlatformModerator(c) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Thread not found"})
		return
	}

	if incrementViews {
		db.Social().Model(&models.ForumThread{}).
			Where("id = ?", thread.ID).
			UpdateColumn("views_count", gorm.Expr("views_count + ?", 1))
		thread.ViewsCount++
	}

	posts, totalPosts, page, limit, err := loadThreadPosts(c, thread.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch posts"})
		return
	}

	// The accepted answer must be reachable even when it sits beyond the
	// loaded reply page (F07); clients pin it until its page arrives.
	var solutionPost *models.ForumPost
	solutionQ := db.Social().Preload("Author").
		Where("thread_id = ? AND is_solution = true", thread.ID)
	if !isPlatformModerator(c) {
		solutionQ = solutionQ.Where("is_hidden = ?", false)
	}
	var foundSolution models.ForumPost
	if err := solutionQ.First(&foundSolution).Error; err == nil {
		solutionPost = &foundSolution
	}

	var solutionDTO *forumPostDTO
	if solutionPost != nil {
		dto := decoratedForumPosts(c, []models.ForumPost{*solutionPost})[0]
		solutionDTO = &dto
	}

	c.JSON(http.StatusOK, gin.H{
		"thread":        decoratedForumThreads(c, []models.ForumThread{thread})[0],
		"posts":         decoratedForumPosts(c, posts),
		"total_posts":   totalPosts,
		"page":          page,
		"limit":         limit,
		"solution_post": solutionDTO,
	})
}

func loadThreadPosts(c *gin.Context, threadID uuid.UUID) ([]models.ForumPost, int64, int, int, error) {
	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	q := db.Social().Model(&models.ForumPost{}).Where("thread_id = ?", threadID)
	if !isPlatformModerator(c) {
		q = q.Where("is_hidden = ?", false)
	}

	var totalPosts int64
	if err := q.Count(&totalPosts).Error; err != nil {
		return nil, 0, 0, 0, err
	}

	listQ := db.Social().Preload("Author").Where("thread_id = ?", threadID)
	if !isPlatformModerator(c) {
		listQ = listQ.Where("is_hidden = ?", false)
	}
	var posts []models.ForumPost
	if err := listQ.Order("created_at ASC, id ASC").Offset(offset).Limit(limit).Find(&posts).Error; err != nil {
		return nil, 0, 0, 0, err
	}

	return posts, totalPosts, page, limit, nil
}

// CreateThreadRequest is a new post. Only the text is required: a post without
// a title shows its text alone, and a post without a topic goes to General.
type CreateThreadRequest struct {
	CategorySlug string `json:"category_slug"`
	Title        string `json:"title"`
	Content      string `json:"content"`
}

// resolvePostCategory finds the topic a new post goes to. An empty slug means
// General; if General is missing, the first open topic is used instead.
func resolvePostCategory(slug string) (models.ForumCategory, bool) {
	var category models.ForumCategory
	slug = strings.TrimSpace(slug)
	if slug != "" {
		err := db.Social().Where("slug = ?", slug).First(&category).Error
		return category, err == nil
	}
	if err := db.Social().Where("slug = ?", forumDefaultCategorySlug).First(&category).Error; err == nil {
		return category, true
	}
	err := db.Social().Where("is_locked = ?", false).
		Order("sort_order ASC, created_at ASC").First(&category).Error
	return category, err == nil
}

// forumThreadLabel is the short name of a post for notifications, the feed and
// links: its title, or else the start of its first line.
func forumThreadLabel(title, content string) string {
	if title = strings.TrimSpace(title); title != "" {
		return title
	}
	line := strings.TrimSpace(content)
	if i := strings.IndexAny(line, "\r\n"); i >= 0 {
		line = strings.TrimSpace(line[:i])
	}
	return truncateRunes(line, forumLabelMaxRunes)
}

// createThread publishes a new post.
func createThread(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req CreateThreadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	title := strings.TrimSpace(req.Title)
	content := strings.TrimSpace(req.Content)
	maxContent := forumPostMaxRunes
	if isPlatformModerator(c) {
		maxContent = forumModeratorThreadMaxRunes
	}
	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Write something before you post"})
		return
	}
	if n := len([]rune(content)); n > maxContent {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Posts can be at most %d characters (this one has %d)", maxContent, n)})
		return
	}
	if len([]rune(title)) > forumTitleMaxRunes {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Titles can be at most %d characters", forumTitleMaxRunes)})
		return
	}

	category, found := resolvePostCategory(req.CategorySlug)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Category not found"})
		return
	}

	if category.IsLocked && !isPlatformModerator(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Category is locked"})
		return
	}

	thread := models.ForumThread{
		CategoryID: category.ID,
		AuthorID:   userID,
		Title:      title,
		Slug:       slugify(forumThreadLabel(title, content)),
		Content:    content,
	}

	if err := db.Social().Create(&thread).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create thread"})
		return
	}

	db.Social().Preload("Author").Preload("Category").First(&thread, "id = ?", thread.ID)

	// Publish to Feed
	go func() {
		feedEvent := models.CreateFeedEvent(
			&userID,
			models.FeedEventNewThread,
			"thread",
			&thread.ID,
			"posted in "+category.Name+": "+forumThreadLabel(thread.Title, thread.Content),
			map[string]interface{}{
				"thread_id": thread.ID,
				"slug":      thread.Slug,
				"category":  category.Name,
			},
		)
		db.Social().Create(feedEvent) // Persistent
		PublishFeedEvent(*feedEvent)  // Real-time + Cache
	}()

	c.JSON(http.StatusCreated, forumThreadDTOFrom(thread))
}

// forumReplyContentError checks a reply's text against the same short-post
// limit as new posts (moderators keep the long limit). It returns "" when the
// text is fine.
func forumReplyContentError(c *gin.Context, content string) string {
	maxContent := forumPostMaxRunes
	if isPlatformModerator(c) {
		maxContent = forumModeratorReplyMaxRunes
	}
	if content == "" {
		return "Write something before you reply"
	}
	if n := len([]rune(content)); n > maxContent {
		return fmt.Sprintf("Replies can be at most %d characters (this one has %d)", maxContent, n)
	}
	return ""
}

type CreatePostRequest struct {
	Content  string     `json:"content" binding:"required"`
	ParentID *uuid.UUID `json:"parent_id"`
}

// createPost creates a reply in a thread
func createPost(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	threadID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid thread ID"})
		return
	}

	var thread models.ForumThread
	if err := db.Social().First(&thread, "id = ?", threadID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Thread not found"})
		return
	}

	if thread.IsLocked {
		c.JSON(http.StatusForbidden, gin.H{"error": "Thread is locked"})
		return
	}

	var req CreatePostRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	content := strings.TrimSpace(req.Content)
	if msg := forumReplyContentError(c, content); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	post := models.ForumPost{
		ThreadID: threadID,
		AuthorID: userID,
		Content:  content,
		ParentID: req.ParentID,
	}

	tx := db.Social().Begin()
	if err := tx.Create(&post).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create post"})
		return
	}

	// Update thread
	now := time.Now()
	if err := tx.Model(&thread).Updates(map[string]interface{}{
		"replies_count": gorm.Expr("replies_count + ?", 1),
		"last_reply_at": now,
		"last_reply_by": userID,
	}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update thread"})
		return
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create post"})
		return
	}

	db.Social().Preload("Author").First(&post, "id = ?", post.ID)

	if thread.AuthorID != userID {
		dispatchUserNotification(c.Request.Context(), userNotification{
			UserID:     thread.AuthorID,
			Type:       models.NotificationReply,
			Title:      "New forum reply",
			Body:       truncate(content, 160),
			ActionURL:  "/community/forum/thread/" + threadID.String(),
			ActionType: "open_thread",
			ActorID:    &userID,
			TargetType: "forum_post",
			TargetID:   &post.ID,
			Dedupe:     true,
		})
	}

	c.JSON(http.StatusCreated, forumPostDTOFrom(post))
}

type UpdatePostRequest struct {
	Content string `json:"content" binding:"required"`
}

// updatePost edits a post owned by the current user.
func updatePost(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	postID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid post ID"})
		return
	}

	var req UpdatePostRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	content := strings.TrimSpace(req.Content)
	if msg := forumReplyContentError(c, content); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	var post models.ForumPost
	if err := db.Social().First(&post, "id = ?", postID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
		return
	}
	if post.AuthorID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Can only edit your own posts"})
		return
	}

	var thread models.ForumThread
	if err := db.Social().First(&thread, "id = ?", post.ThreadID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Thread not found"})
		return
	}
	if thread.IsLocked {
		c.JSON(http.StatusForbidden, gin.H{"error": "Thread is locked"})
		return
	}

	if err := db.Social().Model(&post).Update("content", content).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update post"})
		return
	}

	db.Social().Preload("Author").First(&post, "id = ?", post.ID)
	c.JSON(http.StatusOK, forumPostDTOFrom(post))
}

// deletePost deletes a post owned by the current user.
func deletePost(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	postID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid post ID"})
		return
	}

	var post models.ForumPost
	if err := db.Social().First(&post, "id = ?", postID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
		return
	}
	if post.AuthorID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Can only delete your own posts"})
		return
	}

	var thread models.ForumThread
	if err := db.Social().First(&thread, "id = ?", post.ThreadID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Thread not found"})
		return
	}
	if thread.IsLocked {
		c.JSON(http.StatusForbidden, gin.H{"error": "Thread is locked"})
		return
	}

	err = db.Social().Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("post_id = ?", postID).Delete(&models.ForumVote{}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&post).Error; err != nil {
			return err
		}
		return tx.Model(&models.ForumThread{}).
			Where("id = ?", post.ThreadID).
			UpdateColumn("replies_count", gorm.Expr("GREATEST(replies_count - 1, 0)")).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete post"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Post deleted"})
}

// setPostSolution flips a post's solution flag atomically (F11): the thread
// row is locked so concurrent markers serialize, any previous solution is
// cleared in the same transaction, and every write is checked — a failure
// can never clear the old solution and then report success. The partial
// unique index from migration 000177 backstops the invariant in the schema.
func setPostSolution(post models.ForumPost, isSolution bool) error {
	return db.Social().Transaction(func(tx *gorm.DB) error {
		return applySolutionInTx(tx, post, isSolution)
	})
}

func applySolutionInTx(tx *gorm.DB, post models.ForumPost, isSolution bool) error {
	var thread models.ForumThread
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&thread, "id = ?", post.ThreadID).Error; err != nil {
		return err
	}
	if isSolution {
		if err := tx.Model(&models.ForumPost{}).
			Where("thread_id = ? AND is_solution = true AND id <> ?", post.ThreadID, post.ID).
			Update("is_solution", false).Error; err != nil {
			return err
		}
	}
	return tx.Model(&models.ForumPost{}).Where("id = ?", post.ID).Updates(map[string]interface{}{
		"is_solution": isSolution,
		"updated_at":  time.Now().UTC(),
	}).Error
}

type markSolutionRequest struct {
	IsSolution bool `json:"is_solution"`
}

// markPostSolution lets the thread author (or moderator) mark a reply as the solution.
func markPostSolution(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	postID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid post ID"})
		return
	}
	var req markSolutionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var post models.ForumPost
	if err := db.Social().First(&post, "id = ?", postID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
		return
	}
	var thread models.ForumThread
	if err := db.Social().First(&thread, "id = ?", post.ThreadID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Thread not found"})
		return
	}
	if thread.AuthorID != userID && !isPlatformModerator(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the thread author or a moderator can mark a solution"})
		return
	}

	if err := setPostSolution(post, req.IsSolution); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update solution"})
		return
	}
	db.Social().Preload("Author").First(&post, "id = ?", postID)
	c.JSON(http.StatusOK, forumPostDTOFrom(post))
}

type VoteRequest struct {
	VoteType int `json:"vote_type" binding:"required"` // 1 or -1
}

// votePost upvotes or downvotes a post
func votePost(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	postID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid post ID"})
		return
	}

	var req VoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.VoteType != 1 && req.VoteType != -1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Vote must be 1 or -1"})
		return
	}

	var post models.ForumPost
	if err := db.Social().First(&post, "id = ?", postID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
		return
	}

	// Check existing vote
	var existingVote models.ForumVote
	hasVote := db.Social().Where("user_id = ? AND post_id = ?", userID, postID).First(&existingVote).Error == nil

	tx := db.Social().Begin()

	if hasVote {
		if existingVote.VoteType == req.VoteType {
			// Remove vote
			tx.Delete(&existingVote)
			if req.VoteType == 1 {
				tx.Model(&post).Update("upvotes", post.Upvotes-1)
			} else {
				tx.Model(&post).Update("downvotes", post.Downvotes-1)
			}
		} else {
			// Change vote
			tx.Model(&existingVote).Update("vote_type", req.VoteType)
			if req.VoteType == 1 {
				tx.Model(&post).Updates(map[string]interface{}{
					"upvotes":   post.Upvotes + 1,
					"downvotes": post.Downvotes - 1,
				})
			} else {
				tx.Model(&post).Updates(map[string]interface{}{
					"upvotes":   post.Upvotes - 1,
					"downvotes": post.Downvotes + 1,
				})
			}
		}
	} else {
		// New vote
		vote := models.ForumVote{
			UserID:   userID,
			PostID:   &postID,
			VoteType: req.VoteType,
		}
		tx.Create(&vote)
		if req.VoteType == 1 {
			tx.Model(&post).Update("upvotes", post.Upvotes+1)
		} else {
			tx.Model(&post).Update("downvotes", post.Downvotes+1)
		}
	}

	tx.Commit()

	db.Social().First(&post, "id = ?", postID)
	c.JSON(http.StatusOK, gin.H{
		"upvotes":     post.Upvotes,
		"downvotes":   post.Downvotes,
		"viewer_vote": forumViewerVote("post_id", userID, postID),
	})
}

// voteThread handles upvoting/downvoting a thread
func voteThread(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	threadID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid thread ID"})
		return
	}

	var req VoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.VoteType != 1 && req.VoteType != -1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Vote must be 1 or -1"})
		return
	}

	var thread models.ForumThread
	if err := db.Social().First(&thread, "id = ?", threadID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Thread not found"})
		return
	}

	// Check existing vote
	var existingVote models.ForumVote
	hasVote := db.Social().Where("user_id = ? AND thread_id = ?", userID, threadID).First(&existingVote).Error == nil

	tx := db.Social().Begin()

	if hasVote {
		if existingVote.VoteType == req.VoteType {
			// Remove vote
			tx.Delete(&existingVote)
			if req.VoteType == 1 {
				tx.Model(&thread).Update("upvotes", thread.Upvotes-1)
			} else {
				tx.Model(&thread).Update("downvotes", thread.Downvotes-1)
			}
		} else {
			// Change vote
			tx.Model(&existingVote).Update("vote_type", req.VoteType)
			if req.VoteType == 1 {
				tx.Model(&thread).Updates(map[string]interface{}{
					"upvotes":   thread.Upvotes + 1,
					"downvotes": thread.Downvotes - 1,
				})
			} else {
				tx.Model(&thread).Updates(map[string]interface{}{
					"upvotes":   thread.Upvotes - 1,
					"downvotes": thread.Downvotes + 1,
				})
			}
		}
	} else {
		// New vote
		vote := models.ForumVote{
			UserID:   userID,
			ThreadID: &threadID,
			VoteType: req.VoteType,
		}
		tx.Create(&vote)
		if req.VoteType == 1 {
			tx.Model(&thread).Update("upvotes", thread.Upvotes+1)
		} else {
			tx.Model(&thread).Update("downvotes", thread.Downvotes+1)
		}
	}

	tx.Commit()

	db.Social().First(&thread, "id = ?", threadID)
	c.JSON(http.StatusOK, gin.H{
		"upvotes":     thread.Upvotes,
		"downvotes":   thread.Downvotes,
		"viewer_vote": forumViewerVote("thread_id", userID, threadID),
	})
}

// listForumThreads serves one paginated, stably ordered thread collection.
func listForumThreads(c *gin.Context, order string, applyFilter func(*gorm.DB) *gorm.DB) {
	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)

	countQ := db.Social().Model(&models.ForumThread{})
	listQ := db.Social().Preload("Author").Preload("Category")
	if applyFilter != nil {
		countQ = applyFilter(countQ)
		listQ = applyFilter(listQ)
	}
	if !isPlatformModerator(c) {
		countQ = countQ.Where("is_hidden = ?", false)
		listQ = listQ.Where("is_hidden = ?", false)
	}

	var total int64
	if err := countQ.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch threads"})
		return
	}

	var threads []models.ForumThread
	if err := listQ.Order(order).Offset((page - 1) * limit).Limit(limit).Find(&threads).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch threads"})
		return
	}
	if threads == nil {
		threads = []models.ForumThread{}
	}

	c.JSON(http.StatusOK, gin.H{
		"threads":  decoratedForumThreads(c, threads),
		"total":    total,
		"page":     page,
		"limit":    limit,
		"has_more": int64(page*limit) < total,
	})
}

// getRecentThreads returns recent forum activity
func getRecentThreads(c *gin.Context) {
	listForumThreads(c, "created_at DESC, id DESC", nil)
}

// getPopularThreads returns most voted threads
func getPopularThreads(c *gin.Context) {
	listForumThreads(c, "(upvotes - downvotes) DESC, created_at DESC, id DESC", nil)
}

// getUnansweredThreads returns threads with no replies
func getUnansweredThreads(c *gin.Context) {
	listForumThreads(c, "created_at DESC, id DESC", func(q *gorm.DB) *gorm.DB {
		return q.Where("replies_count = ?", 0)
	})
}

var slugUnsafe = regexp.MustCompile("[^a-z0-9]+")

// slugify turns a title into a URL slug. Short posts such as "gm" or an emoji
// can repeat, so the slug ends with the time and a short random part.
func slugify(s string) string {
	s = slugUnsafe.ReplaceAllString(strings.ToLower(s), "-")
	s = strings.Trim(s, "-")
	if len(s) > 50 {
		s = strings.TrimRight(s[:50], "-")
	}
	if s == "" {
		s = "post"
	}
	return s + "-" + time.Now().Format("20060102150405") + "-" + uuid.NewString()[:6]
}

// searchForum searches threads by title or content
func searchForum(c *gin.Context) {
	queryStr := c.Query("q")
	if len(queryStr) < 3 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Search term must be at least 3 characters"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	var threads []models.ForumThread
	var total int64

	// ILIKE search (Case-insensitive)
	countQ := db.Social().Model(&models.ForumThread{}).
		Where("title ILIKE ? OR content ILIKE ?", "%"+queryStr+"%", "%"+queryStr+"%")
	listQ := db.Social().Preload("Author").Preload("Category").
		Where("title ILIKE ? OR content ILIKE ?", "%"+queryStr+"%", "%"+queryStr+"%")
	if !isPlatformModerator(c) {
		countQ = countQ.Where("is_hidden = ?", false)
		listQ = listQ.Where("is_hidden = ?", false)
	}
	countQ.Count(&total)

	if err := listQ.Order("created_at DESC").Offset(offset).Limit(limit).Find(&threads).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Search failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"threads": decoratedForumThreads(c, threads),
		"total":   total,
		"page":    page,
		"limit":   limit,
		"query":   queryStr,
	})
}

// getMyPosts returns the current user's forum posts
func getMyPosts(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	var posts []models.ForumPost
	var total int64

	db.Social().Model(&models.ForumPost{}).Where("author_id = ?", userID).Count(&total)

	if err := db.Social().Preload("Author").
		Where("author_id = ?", userID).
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&posts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch posts"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"posts": decoratedForumPosts(c, posts),
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

// getMyThreads returns the current user's forum threads
func getMyThreads(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	var threads []models.ForumThread
	var total int64

	db.Social().Model(&models.ForumThread{}).Where("author_id = ?", userID).Count(&total)

	if err := db.Social().Preload("Author").Preload("Category").
		Where("author_id = ?", userID).
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&threads).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch threads"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"threads":  decoratedForumThreads(c, threads),
		"total":    total,
		"page":     page,
		"limit":    limit,
		"has_more": int64(page*limit) < total,
	})
}

// getFollowingThreads is the Following tab: posts from people the signed-in
// user follows, newest first.
func getFollowingThreads(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	listForumThreads(c, "created_at DESC, id DESC", func(q *gorm.DB) *gorm.DB {
		return q.Where("author_id IN (SELECT following_id FROM follows WHERE follower_id = ?)", userID)
	})
}

// ReportRequest represents a report submission
type ReportRequest struct {
	Reason  string `json:"reason" binding:"required"`
	Details string `json:"details"`
}

// reportThread handles reporting a thread
func reportThread(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	threadID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid thread ID"})
		return
	}

	var req ReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Validate reason
	validReasons := map[string]bool{"spam": true, "harassment": true, "inappropriate": true, "offtopic": true, "other": true}
	if !validReasons[req.Reason] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid reason"})
		return
	}

	// Check if thread exists
	var thread models.ForumThread
	if err := db.Social().First(&thread, "id = ?", threadID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Thread not found"})
		return
	}

	// Create report
	report := models.ForumReport{
		ReporterID: userID,
		ThreadID:   &threadID,
		Reason:     req.Reason,
		Details:    req.Details,
		Status:     "pending",
	}

	if err := db.Social().Create(&report).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit report"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Report submitted successfully"})
}

// reportPost handles reporting a post
func reportPost(c *gin.Context) {
	userID, ok := GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	postID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid post ID"})
		return
	}

	var req ReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Validate reason
	validReasons := map[string]bool{"spam": true, "harassment": true, "inappropriate": true, "offtopic": true, "other": true}
	if !validReasons[req.Reason] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid reason"})
		return
	}

	// Check if post exists
	var post models.ForumPost
	if err := db.Social().First(&post, "id = ?", postID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
		return
	}

	// Create report
	report := models.ForumReport{
		ReporterID: userID,
		PostID:     &postID,
		Reason:     req.Reason,
		Details:    req.Details,
		Status:     "pending",
	}

	if err := db.Social().Create(&report).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit report"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Report submitted successfully"})
}
