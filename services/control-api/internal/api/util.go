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
// Auth middleware has historically used both "user_id" and "userID", and
// callers/tests may store either uuid.UUID or string values under either key.
func GetUserID(c *gin.Context) (uuid.UUID, bool) {
	for _, key := range []string{"user_id", "userID"} {
		if val, exists := c.Get(key); exists {
			switch v := val.(type) {
			case uuid.UUID:
				if v != uuid.Nil {
					return v, true
				}
			case string:
				if uid, err := uuid.Parse(v); err == nil && uid != uuid.Nil {
					return uid, true
				}
			}
		}
	}

	return uuid.Nil, false
}
