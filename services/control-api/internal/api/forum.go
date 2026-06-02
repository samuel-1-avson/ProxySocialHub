package api

import (
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// RegisterForumRoutes registers community forum routes
func RegisterForumRoutes(rg *gin.RouterGroup) {
	rg.GET("/forum/categories", getCategories)
	rg.GET("/forum/categories/:slug", getCategory)
	rg.GET("/forum/categories/:slug/threads", getCategoryThreads)
	rg.GET("/forum/threads/slug/:slug", getThreadBySlug)
	rg.GET("/forum/threads/:id", getThread)
	rg.GET("/forum/threads/:id/posts", getThreadPosts)
	rg.POST("/forum/threads", createThread)
	rg.POST("/forum/threads/:id/posts", createPost)
	rg.PATCH("/forum/posts/:id", updatePost)
	rg.DELETE("/forum/posts/:id", deletePost)
	rg.POST("/forum/posts/:id/vote", votePost)
	rg.POST("/forum/threads/:id/vote", voteThread)
	rg.POST("/forum/threads/:id/report", reportThread)
	rg.POST("/forum/posts/:id/report", reportPost)
	rg.GET("/forum/search", searchForum)
	rg.GET("/forum/recent", getRecentThreads)
	rg.GET("/forum/popular", getPopularThreads)
	rg.GET("/forum/unanswered", getUnansweredThreads)
	rg.GET("/forum/my-posts", getMyPosts)
	rg.GET("/forum/my-threads", getMyThreads)
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
		db.Social().Model(&models.ForumThread{}).Where("category_id = ?", cat.ID).Count(&count)
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
	db.Social().Model(&models.ForumThread{}).Where("category_id = ?", category.ID).Count(&threadCount)

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

	var threads []models.ForumThread
	db.Social().Preload("Author").Preload("LastReplier").
		Where("category_id = ?", category.ID).
		Order("is_pinned DESC, last_reply_at DESC NULLS LAST, created_at DESC").
		Limit(50).
		Find(&threads)

	c.JSON(http.StatusOK, gin.H{
		"category": category,
		"threads":  threads,
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
		"posts": posts,
		"total": totalPosts,
		"page":  page,
		"limit": limit,
	})
}

func renderThreadWithPosts(c *gin.Context, thread models.ForumThread, incrementViews bool) {
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

	c.JSON(http.StatusOK, gin.H{
		"thread":      thread,
		"posts":       posts,
		"total_posts": totalPosts,
		"page":        page,
		"limit":       limit,
	})
}

func loadThreadPosts(c *gin.Context, threadID uuid.UUID) ([]models.ForumPost, int64, int, int, error) {
	page := getPageParam(c, 1)
	limit := getLimitParam(c, 20)
	offset := (page - 1) * limit

	var totalPosts int64
	if err := db.Social().Model(&models.ForumPost{}).Where("thread_id = ?", threadID).Count(&totalPosts).Error; err != nil {
		return nil, 0, 0, 0, err
	}

	var posts []models.ForumPost
	if err := db.Social().Preload("Author").
		Where("thread_id = ?", threadID).
		Order("created_at ASC").
		Offset(offset).Limit(limit).
		Find(&posts).Error; err != nil {
		return nil, 0, 0, 0, err
	}

	return posts, totalPosts, page, limit, nil
}

type CreateThreadRequest struct {
	CategorySlug string `json:"category_slug" binding:"required"`
	Title        string `json:"title" binding:"required"`
	Content      string `json:"content" binding:"required"`
}

// createThread creates a new forum thread
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

	var category models.ForumCategory
	if err := db.Social().Where("slug = ?", req.CategorySlug).First(&category).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Category not found"})
		return
	}

	if category.IsLocked {
		c.JSON(http.StatusForbidden, gin.H{"error": "Category is locked"})
		return
	}

	thread := models.ForumThread{
		CategoryID: category.ID,
		AuthorID:   userID,
		Title:      req.Title,
		Slug:       slugify(req.Title),
		Content:    req.Content,
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
			"posted in "+category.Name+": "+thread.Title,
			map[string]interface{}{
				"thread_id": thread.ID,
				"slug":      thread.Slug,
				"category":  category.Name,
			},
		)
		db.Social().Create(feedEvent) // Persistent
		PublishFeedEvent(*feedEvent)  // Real-time + Cache
	}()

	c.JSON(http.StatusCreated, thread)
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

	post := models.ForumPost{
		ThreadID: threadID,
		AuthorID: userID,
		Content:  req.Content,
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
			Body:       truncate(req.Content, 160),
			ActionURL:  "/community/forum/thread/" + threadID.String(),
			ActionType: "open_thread",
			ActorID:    &userID,
			TargetType: "forum_post",
			TargetID:   &post.ID,
			Dedupe:     true,
		})
	}

	c.JSON(http.StatusCreated, post)
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

	if err := db.Social().Model(&post).Update("content", req.Content).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update post"})
		return
	}

	db.Social().Preload("Author").First(&post, "id = ?", post.ID)
	c.JSON(http.StatusOK, post)
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
	c.JSON(http.StatusOK, gin.H{"upvotes": post.Upvotes, "downvotes": post.Downvotes})
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
	c.JSON(http.StatusOK, gin.H{"upvotes": thread.Upvotes, "downvotes": thread.Downvotes})
}

// getRecentThreads returns recent forum activity
func getRecentThreads(c *gin.Context) {
	limit := getLimitParam(c, 20)
	var threads []models.ForumThread
	db.Social().Preload("Author").Preload("Category").
		Order("created_at DESC").
		Limit(limit).
		Find(&threads)

	c.JSON(http.StatusOK, gin.H{"threads": threads})
}

// getPopularThreads returns most voted threads
func getPopularThreads(c *gin.Context) {
	limit := getLimitParam(c, 20)
	var threads []models.ForumThread
	db.Social().Preload("Author").Preload("Category").
		Order("(upvotes - downvotes) DESC, created_at DESC").
		Limit(limit).
		Find(&threads)

	c.JSON(http.StatusOK, gin.H{"threads": threads})
}

// getUnansweredThreads returns threads with no replies
func getUnansweredThreads(c *gin.Context) {
	limit := getLimitParam(c, 20)
	var threads []models.ForumThread
	db.Social().Preload("Author").Preload("Category").
		Where("replies_count = ?", 0).
		Order("created_at DESC").
		Limit(limit).
		Find(&threads)

	c.JSON(http.StatusOK, gin.H{"threads": threads})
}

func slugify(s string) string {
	s = strings.ToLower(s)
	reg := regexp.MustCompile("[^a-z0-9]+")
	s = reg.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 50 {
		s = s[:50]
	}
	return s + "-" + time.Now().Format("20060102150405")
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
	db.Social().Model(&models.ForumThread{}).
		Where("title ILIKE ? OR content ILIKE ?", "%"+queryStr+"%", "%"+queryStr+"%").
		Count(&total)

	if err := db.Social().Preload("Author").Preload("Category").
		Where("title ILIKE ? OR content ILIKE ?", "%"+queryStr+"%", "%"+queryStr+"%").
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&threads).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Search failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"threads": threads,
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
		"posts": posts,
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
		"threads": threads,
		"total":   total,
		"page":    page,
		"limit":   limit,
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
	validReasons := map[string]bool{"spam": true, "harassment": true, "inappropriate": true, "other": true}
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
	validReasons := map[string]bool{"spam": true, "harassment": true, "inappropriate": true, "other": true}
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
