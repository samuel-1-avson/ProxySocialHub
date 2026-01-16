package api

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// LogAudit creates an audit log entry using the existing AuditLog model
func LogAudit(c *gin.Context, action models.AuditAction, entityType models.AuditEntityType, entityID string, details models.AuditDetails) {
	userIDValue, exists := c.Get("user_id")
	var actorID *uuid.UUID
	var actorEmail string
	if exists {
		id := userIDValue.(uuid.UUID)
		actorID = &id
	}

	// Get user email if possible
	if actorID != nil {
		var user models.User
		if db.DB.Select("email").First(&user, "id = ?", actorID).Error == nil {
			actorEmail = user.Email
		}
	}

	log := models.NewAuditLog(actorID, actorEmail, action, entityType, entityID, details).
		WithIPAddress(c.ClientIP()).
		WithUserAgent(c.Request.UserAgent())

	db.DB.Create(log)
}

// LogAuditSimple is a simple version for logging without context
func LogAuditSimple(userID uuid.UUID, action models.AuditAction, entityType models.AuditEntityType, entityID string, details models.AuditDetails) {
	log := models.NewAuditLog(&userID, "", action, entityType, entityID, details)
	db.DB.Create(log)
}
