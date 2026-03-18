package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RegisterNotificationRoutes registers notification routes
func RegisterNotificationRoutes(rg *gin.RouterGroup) {
	// Notifications
	rg.GET("/notifications", getNotifications)
	rg.GET("/notifications/unread-count", getUnreadCount)
	rg.POST("/notifications/:id/read", markNotificationRead)
	rg.POST("/notifications/read-all", markAllNotificationsRead)
	rg.DELETE("/notifications/:id", deleteNotification)
	
	// Preferences
	rg.GET("/notification-preferences", getNotificationPreferences)
	rg.PUT("/notification-preferences", updateNotificationPreferences)
}

func getNotifications(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	
	var query struct {
		Page   int  `form:"page,default=1"`
		Limit  int  `form:"limit,default=20"`
		Unread bool `form:"unread"`
	}
	c.ShouldBindQuery(&query)
	
	dbQuery := db.Social().Where("user_id = ?", userID).Order("created_at DESC")
	
	if query.Unread {
		dbQuery = dbQuery.Where("is_read = ?", false)
	}
	
	var notifications []models.Notification
	var total int64
	
	dbQuery.Model(&models.Notification{}).Count(&total)
	dbQuery.Offset((query.Page - 1) * query.Limit).Limit(query.Limit).Preload("Actor").Find(&notifications)
	
	c.JSON(http.StatusOK, gin.H{
		"notifications": notifications,
		"total":         total,
		"page":          query.Page,
		"limit":         query.Limit,
	})
}

func getUnreadCount(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	
	var count int64
	db.Social().Model(&models.Notification{}).Where("user_id = ? AND is_read = ?", userID, false).Count(&count)
	
	c.JSON(http.StatusOK, gin.H{"count": count})
}

func markNotificationRead(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	
	notificationID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid notification ID"})
		return
	}
	
	result := db.Social().Model(&models.Notification{}).
		Where("id = ? AND user_id = ?", notificationID, userID).
		Update("is_read", true)
	
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{"message": "marked as read"})
}

func markAllNotificationsRead(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	
	result := db.Social().Model(&models.Notification{}).
		Where("user_id = ? AND is_read = ?", userID, false).
		Update("is_read", true)
	
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{"message": "all notifications marked as read"})
}

func deleteNotification(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	
	notificationID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid notification ID"})
		return
	}
	
	result := db.Social().Where("id = ? AND user_id = ?", notificationID, userID).Delete(&models.Notification{})
	
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{"message": "notification deleted"})
}

// parseNotifUserID safely extracts and parses the userID from context,
// handling both uuid.UUID and string types set by different middleware paths.
func parseNotifUserID(c *gin.Context) (uuid.UUID, bool) {
	raw, exists := c.Get("userID")
	if !exists {
		return uuid.Nil, false
	}
	switch v := raw.(type) {
	case uuid.UUID:
		return v, true
	case string:
		parsed, err := uuid.Parse(v)
		if err != nil {
			return uuid.Nil, false
		}
		return parsed, true
	}
	return uuid.Nil, false
}

func getNotificationPreferences(c *gin.Context) {
	uid, ok := parseNotifUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var prefs models.NotificationPreference
	if err := db.Social().First(&prefs, "user_id = ?", uid).Error; err != nil {
		// Return defaults if not found
		prefs = models.NotificationPreference{
			UserID:               uid,
			SocialInApp:          true,
			SocialEmail:          true,
			SocialPush:           false,
			BusinessInApp:        true,
			BusinessEmail:        true,
			BusinessPush:         true,
			CommunityInApp:       true,
			CommunityEmail:       true,
			CommunityPush:        false,
			SystemInApp:          true,
			SystemEmail:          true,
			SystemPush:           true,
			EmailDigestFrequency: "immediate",
			DigestDay:            "monday",
			DigestHour:           9,
		}
	}

	c.JSON(http.StatusOK, prefs)
}

func updateNotificationPreferences(c *gin.Context) {
	uid, ok := parseNotifUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req models.NotificationPreference
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	req.UserID = uid

	if err := db.Social().Save(&req).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, req)
}
