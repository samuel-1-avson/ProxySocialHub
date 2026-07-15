package api

import (
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
)

// RegisterAdminForumModerationRoutes registers forum report queue handlers for admin JWT sessions.
func RegisterAdminForumModerationRoutes(rg *gin.RouterGroup) {
	forum := rg.Group("/forum")
	{
		forum.GET("/reports", getForumReportsForModeration)
		forum.PATCH("/reports/:id", patchForumReportStatus)
	}
}

// RegisterPlatformForumModerationRoutes registers forum moderation for dashboard moderators.
func RegisterPlatformForumModerationRoutes(rg *gin.RouterGroup) {
	mod := rg.Group("/moderation")
	mod.Use(middleware.RequirePlatformModerator())
	{
		mod.GET("/forum/reports", getForumReportsForModeration)
		mod.PATCH("/forum/reports/:id", patchForumReportStatus)
	}
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

	var report models.ForumReport
	if err := db.Social().First(&report, "id = ?", reportID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Report not found"})
		return
	}

	if err := db.Social().Model(&report).Updates(map[string]interface{}{
		"status":     next,
		"updated_at": time.Now().UTC(),
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update report"})
		return
	}

	audit.Log(c, models.AuditAdminAction, "forum_report", reportID.String(),
		"Forum report marked "+next, map[string]interface{}{
			"report_id": reportID.String(),
			"reason":    report.Reason,
			"status":    next,
		})

	c.JSON(http.StatusOK, gin.H{
		"message": "Report updated",
		"report":  report,
		"status":  next,
	})
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
