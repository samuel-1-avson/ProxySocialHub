package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/audit"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/middleware"
	"github.com/proxyhubb/control-api/internal/models"
	"gorm.io/gorm"
)

// RegisterAdminForumModerationRoutes registers forum report + content actions for admin JWT sessions.
func RegisterAdminForumModerationRoutes(rg *gin.RouterGroup) {
	forum := rg.Group("/forum")
	registerForumModerationHandlers(forum)
}

// RegisterPlatformForumModerationRoutes registers forum moderation for dashboard moderators.
func RegisterPlatformForumModerationRoutes(rg *gin.RouterGroup) {
	mod := rg.Group("/moderation")
	mod.Use(middleware.RequirePlatformModerator())
	forum := mod.Group("/forum")
	registerForumModerationHandlers(forum)
}

func registerForumModerationHandlers(forum *gin.RouterGroup) {
	forum.GET("/reports", getForumReportsForModeration)
	forum.PATCH("/reports/:id", patchForumReportStatus)

	forum.PATCH("/threads/:id", patchForumThreadModeration)
	forum.DELETE("/threads/:id", deleteForumThreadModeration)
	forum.PATCH("/posts/:id", patchForumPostModeration)
	forum.DELETE("/posts/:id", deleteForumPostModeration)
}

type forumReportView struct {
	models.ForumReport
	ReporterName string `json:"reporter_name,omitempty"`
	ThreadTitle  string `json:"thread_title,omitempty"`
	PostPreview  string `json:"post_preview,omitempty"`
}

type forumReportsResponse struct {
	Reports []forumReportView `json:"reports"`
	Total   int64             `json:"total"`
	Page    int               `json:"page"`
	Limit   int               `json:"limit"`
}

func getForumReportsForModeration(c *gin.Context) {
	status := strings.TrimSpace(c.DefaultQuery("status", "pending"))
	if status == "" {
		status = "pending"
	}
	if status != "pending" && status != "resolved" && status != "dismissed" && status != "all" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid status filter"})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	q := db.Social().Model(&models.ForumReport{})
	if status != "all" {
		q = q.Where("status = ?", status)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count forum reports"})
		return
	}

	var reports []models.ForumReport
	if err := q.Order("created_at DESC").Offset(offset).Limit(limit).Find(&reports).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load forum reports"})
		return
	}

	views := make([]forumReportView, 0, len(reports))
	for _, r := range reports {
		v := forumReportView{ForumReport: r}
		var reporter models.User
		if err := db.DB.Select("id", "username", "display_name").First(&reporter, "id = ?", r.ReporterID).Error; err == nil {
			if reporter.DisplayName != nil && *reporter.DisplayName != "" {
				v.ReporterName = *reporter.DisplayName
			} else if reporter.Username != nil {
				v.ReporterName = *reporter.Username
			}
		}
		if r.ThreadID != nil {
			var thread models.ForumThread
			if err := db.Social().Select("title").First(&thread, "id = ?", *r.ThreadID).Error; err == nil {
				v.ThreadTitle = thread.Title
			}
		}
		if r.PostID != nil {
			var post models.ForumPost
			if err := db.Social().Select("content").First(&post, "id = ?", *r.PostID).Error; err == nil {
				v.PostPreview = truncateRunes(post.Content, 160)
			}
		}
		views = append(views, v)
	}

	c.JSON(http.StatusOK, forumReportsResponse{
		Reports: views,
		Total:   total,
		Page:    page,
		Limit:   limit,
	})
}

type patchForumReportRequest struct {
	Status string `json:"status" binding:"required"`
	// Action applies enforcement when resolving: none|hide|lock|hide_and_lock|delete
	Action string `json:"action"`
}

func patchForumReportStatus(c *gin.Context) {
	reportID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid report ID"})
		return
	}

	var req patchForumReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	next := strings.ToLower(strings.TrimSpace(req.Status))
	if next != "resolved" && next != "dismissed" && next != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status must be pending, resolved, or dismissed"})
		return
	}

	action := strings.ToLower(strings.TrimSpace(req.Action))
	if action == "" {
		action = "none"
	}
	switch action {
	case "none", "hide", "lock", "hide_and_lock", "delete":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "action must be none, hide, lock, hide_and_lock, or delete"})
		return
	}
	if next != "resolved" && action != "none" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "enforcement actions require status=resolved"})
		return
	}

	var report models.ForumReport
	if err := db.Social().First(&report, "id = ?", reportID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Report not found"})
		return
	}

	applied := ""
	if next == "resolved" && action != "none" {
		var applyErr error
		applied, applyErr = applyForumReportAction(report, action)
		if applyErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": applyErr.Error()})
			return
		}
	}

	if err := db.Social().Model(&report).Updates(map[string]interface{}{
		"status":     next,
		"updated_at": time.Now().UTC(),
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update report"})
		return
	}
	report.Status = next

	audit.Log(c, models.AuditAdminAction, "forum_report", reportID.String(),
		"Forum report marked "+next, map[string]interface{}{
			"report_id": reportID.String(),
			"reason":    report.Reason,
			"status":    next,
			"action":    action,
			"applied":   applied,
		})

	c.JSON(http.StatusOK, gin.H{
		"message": "Report updated",
		"report":  report,
		"status":  next,
		"action":  action,
		"applied": applied,
	})
}

func applyForumReportAction(report models.ForumReport, action string) (string, error) {
	now := time.Now().UTC()

	if report.PostID != nil {
		var post models.ForumPost
		if err := db.Social().First(&post, "id = ?", *report.PostID).Error; err != nil {
			return "", err
		}
		switch action {
		case "hide", "hide_and_lock":
			if err := db.Social().Model(&post).Updates(map[string]interface{}{
				"is_hidden":  true,
				"updated_at": now,
			}).Error; err != nil {
				return "", err
			}
			if action == "hide_and_lock" {
				if err := db.Social().Model(&models.ForumThread{}).Where("id = ?", post.ThreadID).Updates(map[string]interface{}{
					"is_locked":  true,
					"updated_at": now,
				}).Error; err != nil {
					return "", err
				}
				return "post_hidden_thread_locked", nil
			}
			return "post_hidden", nil
		case "lock":
			if err := db.Social().Model(&models.ForumThread{}).Where("id = ?", post.ThreadID).Updates(map[string]interface{}{
				"is_locked":  true,
				"updated_at": now,
			}).Error; err != nil {
				return "", err
			}
			return "thread_locked", nil
		case "delete":
			if err := db.Social().Delete(&post).Error; err != nil {
				return "", err
			}
			_ = db.Social().Exec(
				`UPDATE forum_threads SET replies_count = GREATEST(replies_count - 1, 0), updated_at = NOW() WHERE id = ?`,
				post.ThreadID,
			).Error
			return "post_deleted", nil
		}
	}

	if report.ThreadID != nil {
		var thread models.ForumThread
		if err := db.Social().First(&thread, "id = ?", *report.ThreadID).Error; err != nil {
			return "", err
		}
		switch action {
		case "hide", "hide_and_lock":
			updates := map[string]interface{}{
				"is_hidden":  true,
				"updated_at": now,
			}
			if action == "hide_and_lock" {
				updates["is_locked"] = true
			}
			if err := db.Social().Model(&thread).Updates(updates).Error; err != nil {
				return "", err
			}
			if action == "hide_and_lock" {
				return "thread_hidden_and_locked", nil
			}
			return "thread_hidden", nil
		case "lock":
			if err := db.Social().Model(&thread).Updates(map[string]interface{}{
				"is_locked":  true,
				"updated_at": now,
			}).Error; err != nil {
				return "", err
			}
			return "thread_locked", nil
		case "delete":
			if err := db.Social().Where("thread_id = ?", thread.ID).Delete(&models.ForumPost{}).Error; err != nil {
				return "", err
			}
			if err := db.Social().Delete(&thread).Error; err != nil {
				return "", err
			}
			return "thread_deleted", nil
		}
	}

	return "", fmt.Errorf("report has no thread or post target")
}

type patchForumThreadModerationRequest struct {
	IsPinned *bool `json:"is_pinned"`
	IsLocked *bool `json:"is_locked"`
	IsHidden *bool `json:"is_hidden"`
}

func patchForumThreadModeration(c *gin.Context) {
	threadID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid thread ID"})
		return
	}
	var req patchForumThreadModerationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.IsPinned == nil && req.IsLocked == nil && req.IsHidden == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provide is_pinned, is_locked, and/or is_hidden"})
		return
	}

	var thread models.ForumThread
	if err := db.Social().First(&thread, "id = ?", threadID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Thread not found"})
		return
	}

	updates := map[string]interface{}{"updated_at": time.Now().UTC()}
	if req.IsPinned != nil {
		updates["is_pinned"] = *req.IsPinned
	}
	if req.IsLocked != nil {
		updates["is_locked"] = *req.IsLocked
	}
	if req.IsHidden != nil {
		updates["is_hidden"] = *req.IsHidden
	}
	if err := db.Social().Model(&thread).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update thread"})
		return
	}
	db.Social().Preload("Author").Preload("Category").First(&thread, "id = ?", threadID)

	audit.Log(c, models.AuditAdminAction, "forum_thread", threadID.String(),
		"Forum thread moderation update", updates)

	c.JSON(http.StatusOK, forumThreadDTOFrom(thread))
}

func deleteForumThreadModeration(c *gin.Context) {
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
	if err := db.Social().Where("thread_id = ?", threadID).Delete(&models.ForumPost{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete posts"})
		return
	}
	if err := db.Social().Delete(&thread).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete thread"})
		return
	}
	audit.Log(c, models.AuditAdminAction, "forum_thread", threadID.String(),
		"Forum thread deleted by moderator", nil)
	c.JSON(http.StatusOK, gin.H{"message": "Thread deleted", "id": threadID})
}

type patchForumPostModerationRequest struct {
	IsHidden   *bool `json:"is_hidden"`
	IsSolution *bool `json:"is_solution"`
}

func patchForumPostModeration(c *gin.Context) {
	postID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid post ID"})
		return
	}
	var req patchForumPostModerationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.IsHidden == nil && req.IsSolution == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provide is_hidden and/or is_solution"})
		return
	}

	var post models.ForumPost
	if err := db.Social().First(&post, "id = ?", postID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
		return
	}

	updates := map[string]interface{}{"updated_at": time.Now().UTC()}
	if req.IsHidden != nil {
		updates["is_hidden"] = *req.IsHidden
	}
	if req.IsSolution != nil {
		updates["is_solution"] = *req.IsSolution
	}
	// Solution changes go through the same atomic helper as the public
	// endpoint, in the same transaction as any visibility change (F11).
	if err := db.Social().Transaction(func(tx *gorm.DB) error {
		if req.IsSolution != nil {
			if err := applySolutionInTx(tx, post, *req.IsSolution); err != nil {
				return err
			}
		}
		if req.IsHidden != nil {
			return tx.Model(&models.ForumPost{}).Where("id = ?", post.ID).Updates(map[string]interface{}{
				"is_hidden":  *req.IsHidden,
				"updated_at": time.Now().UTC(),
			}).Error
		}
		return nil
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update post"})
		return
	}
	db.Social().Preload("Author").First(&post, "id = ?", postID)

	audit.Log(c, models.AuditAdminAction, "forum_post", postID.String(),
		"Forum post moderation update", updates)

	c.JSON(http.StatusOK, forumPostDTOFrom(post))
}

func deleteForumPostModeration(c *gin.Context) {
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
	threadID := post.ThreadID
	if err := db.Social().Delete(&post).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete post"})
		return
	}
	_ = db.Social().Exec(
		`UPDATE forum_threads SET replies_count = GREATEST(replies_count - 1, 0), updated_at = NOW() WHERE id = ?`,
		threadID,
	).Error

	audit.Log(c, models.AuditAdminAction, "forum_post", postID.String(),
		"Forum post deleted by moderator", nil)
	c.JSON(http.StatusOK, gin.H{"message": "Post deleted", "id": postID})
}

func truncateRunes(s string, max int) string {
	if max <= 0 {
		return ""
	}
	runes := []rune(strings.TrimSpace(s))
	if len(runes) <= max {
		return string(runes)
	}
	return string(runes[:max]) + "…"
}
