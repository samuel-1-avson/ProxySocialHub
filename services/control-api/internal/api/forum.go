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
)

// RegisterForumRoutes registers community forum routes
func RegisterForumRoutes(rg *gin.RouterGroup) {
	rg.GET("/forum/categories", getCategories)
	rg.GET("/forum/categories/:slug", getCategoryThreads)
	rg.GET("/forum/threads/:id", getThread)
	rg.POST("/forum/threads", createThread)
	rg.POST("/forum/threads/:id/posts", createPost)
	rg.POST("/forum/posts/:id/vote", votePost)
	rg.GET("/forum/recent", getRecentThreads)
}

// getCategories returns all forum categories
func getCategories(c *gin.Context) {
	var categories []models.ForumCategory
	db.DB.Order("sort_order ASC").Find(&categories)

	// Count threads per category
	type CategoryWithCount struct {
		models.ForumCategory
		ThreadCount int `json:"thread_count"`
	}

	result := make([]CategoryWithCount, len(categories))
	for i, cat := range categories {
		var count int64
		db.DB.Model(&models.ForumThread{}).Where("category_id = ?", cat.ID).Count(&count)
		result[i] = CategoryWithCount{
			ForumCategory: cat,
			ThreadCount:   int(count),
		}
	}

	c.JSON(http.StatusOK, gin.H{"categories": result})
}

// getCategoryThreads returns threads in a category
func getCategoryThreads(c *gin.Context) {
	slug := c.Param("slug")

	var category models.ForumCategory
	if err := db.DB.Where("slug = ?", slug).First(&category).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Category not found"})
		return
	}

	var threads []models.ForumThread
	db.DB.Preload("Author").Preload("LastReplier").
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
	if err := db.DB.Preload("Author").Preload("Category").First(&thread, "id = ?", threadID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Thread not found"})
		return
	}

	// Increment view count
	db.DB.Model(&thread).Update("views_count", thread.ViewsCount+1)

	// Get posts
	var posts []models.ForumPost
	db.DB.Preload("Author").Where("thread_id = ?", threadID).Order("created_at ASC").Find(&posts)

	c.JSON(http.StatusOK, gin.H{
		"thread": thread,
		"posts":  posts,
	})
}

type CreateThreadRequest struct {
	CategorySlug string `json:"category_slug" binding:"required"`
	Title        string `json:"title" binding:"required"`
	Content      string `json:"content" binding:"required"`
}

// createThread creates a new forum thread
func createThread(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	var req CreateThreadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var category models.ForumCategory
	if err := db.DB.Where("slug = ?", req.CategorySlug).First(&category).Error; err != nil {
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

	if err := db.DB.Create(&thread).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create thread"})
		return
	}

	db.DB.Preload("Author").Preload("Category").First(&thread, "id = ?", thread.ID)

	c.JSON(http.StatusCreated, thread)
}

type CreatePostRequest struct {
	Content  string     `json:"content" binding:"required"`
	ParentID *uuid.UUID `json:"parent_id"`
}

// createPost creates a reply in a thread
func createPost(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

	threadID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid thread ID"})
		return
	}

	var thread models.ForumThread
	if err := db.DB.First(&thread, "id = ?", threadID).Error; err != nil {
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

	tx := db.DB.Begin()
	tx.Create(&post)

	// Update thread
	now := time.Now()
	tx.Model(&thread).Updates(map[string]interface{}{
		"replies_count": thread.RepliesCount + 1,
		"last_reply_at": now,
		"last_reply_by": userID,
	})

	tx.Commit()

	db.DB.Preload("Author").First(&post, "id = ?", post.ID)

	c.JSON(http.StatusCreated, post)
}

type VoteRequest struct {
	VoteType int `json:"vote_type" binding:"required"` // 1 or -1
}

// votePost upvotes or downvotes a post
func votePost(c *gin.Context) {
	currentUserID, _ := c.Get("user_id")
	userID := currentUserID.(uuid.UUID)

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
	if err := db.DB.First(&post, "id = ?", postID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
		return
	}

	// Check existing vote
	var existingVote models.ForumVote
	hasVote := db.DB.Where("user_id = ? AND post_id = ?", userID, postID).First(&existingVote).Error == nil

	tx := db.DB.Begin()

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
			PostID:   postID,
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

	db.DB.First(&post, "id = ?", postID)
	c.JSON(http.StatusOK, gin.H{"upvotes": post.Upvotes, "downvotes": post.Downvotes})
}

// getRecentThreads returns recent forum activity
func getRecentThreads(c *gin.Context) {
	var threads []models.ForumThread
	db.DB.Preload("Author").Preload("Category").
		Order("created_at DESC").
		Limit(10).
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
