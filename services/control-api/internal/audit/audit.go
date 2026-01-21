package audit

import (
	"encoding/json"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// Log records an audit entry using the new AuditLog model
func Log(c *gin.Context, eventType models.AuditEventType, targetType, targetID string, description string, metadata map[string]interface{}) {
	var actorID *uuid.UUID
	var actorEmail string

	// Get actor info from context
	if userIDRaw, exists := c.Get("user_id"); exists {
		if userID, ok := userIDRaw.(uuid.UUID); ok {
			actorID = &userID
		}
	}

	// Try to get email from database
	if actorID != nil && db.DB != nil {
		var user models.User
		if db.DB.Select("email").First(&user, "id = ?", actorID).Error == nil {
			actorEmail = user.Email
		}
	}

	// Serialize metadata
	metadataJSON := ""
	if metadata != nil {
		data, _ := json.Marshal(metadata)
		metadataJSON = string(data)
	}

	// Create audit log entry
	entry := models.AuditLog{
		EventType:   eventType,
		Severity:    models.AuditSeverityInfo,
		ActorID:     actorID,
		ActorType:   "user",
		ActorEmail:  actorEmail,
		TargetType:  targetType,
		TargetID:    targetID,
		Description: description,
		Metadata:    metadataJSON,
		Success:     true,
	}

	// Add request metadata
	if c != nil {
		entry.IPAddress = c.ClientIP()
		entry.UserAgent = c.GetHeader("User-Agent")
	}

	// Save to database (async to not slow down requests)
	go func() {
		if db.DB != nil {
			db.DB.Create(&entry)
		}
	}()
}

// LogDirect records an audit entry without gin context (for background jobs)
func LogDirect(actorID *uuid.UUID, actorEmail string, eventType models.AuditEventType, targetType, targetID string, description string, metadata map[string]interface{}) {
	metadataJSON := ""
	if metadata != nil {
		data, _ := json.Marshal(metadata)
		metadataJSON = string(data)
	}

	entry := models.AuditLog{
		EventType:   eventType,
		Severity:    models.AuditSeverityInfo,
		ActorID:     actorID,
		ActorType:   "user",
		ActorEmail:  actorEmail,
		TargetType:  targetType,
		TargetID:    targetID,
		Description: description,
		Metadata:    metadataJSON,
		Success:     true,
	}

	go func() {
		if db.DB != nil {
			db.DB.Create(&entry)
		}
	}()
}

// LogUserAction is a convenience function for user-related actions
func LogUserAction(c *gin.Context, eventType models.AuditEventType, targetUserID string, description string) {
	Log(c, eventType, "user", targetUserID, description, nil)
}

// LogKYCAction is a convenience function for KYC-related actions
func LogKYCAction(c *gin.Context, eventType models.AuditEventType, kycID string, description string) {
	Log(c, eventType, "kyc", kycID, description, nil)
}

// LogWalletAction is a convenience function for wallet-related actions
func LogWalletAction(c *gin.Context, eventType models.AuditEventType, walletID string, description string) {
	Log(c, eventType, "wallet", walletID, description, nil)
}

// LogNodeAction is a convenience function for node-related actions
func LogNodeAction(c *gin.Context, eventType models.AuditEventType, nodeID string, description string) {
	Log(c, eventType, "node", nodeID, description, nil)
}
