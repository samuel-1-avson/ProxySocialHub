package api

import (
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// RecordAuditLog creates a new audit log entry
func RecordAuditLog(c *gin.Context, eventType models.AuditEventType, severity models.AuditSeverity, actorID *uuid.UUID, targetType, targetID, description string, success bool) {
	metadata := fmt.Sprintf(`{"ip": "%s", "ua": "%s"}`, c.ClientIP(), c.Request.UserAgent())

	log := models.AuditLog{
		EventType:   eventType,
		Severity:    severity,
		ActorID:     actorID,
		ActorType:   "user",
		TargetType:  targetType,
		TargetID:    targetID,
		IPAddress:   c.ClientIP(),
		UserAgent:   c.Request.UserAgent(),
		Description: description,
		Metadata:    metadata,
		Success:     success,
		CreatedAt:   time.Now(),
	}

	db.DB.Create(&log)
}

// GetUserID safely extracts the user UUID from the context.
// It checks both "user_id" (UUID) and "userID" (string) keys.
func GetUserID(c *gin.Context) (uuid.UUID, bool) {
	// Try UUID first
	if val, exists := c.Get("user_id"); exists {
		if uid, ok := val.(uuid.UUID); ok {
			return uid, true
		}
	}

	// Try string fallback
	if val, exists := c.Get("userID"); exists {
		if s, ok := val.(string); ok {
			if uid, err := uuid.Parse(s); err == nil {
				return uid, true
			}
		}
	}

	return uuid.Nil, false
}
