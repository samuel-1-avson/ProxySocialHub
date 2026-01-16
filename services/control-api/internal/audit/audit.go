package audit

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/proxyhubb/control-api/internal/db"
	"github.com/proxyhubb/control-api/internal/models"
)

// Log records an audit entry
func Log(c *gin.Context, action models.AuditAction, entityType models.AuditEntityType, entityID string, details models.AuditDetails) {
	var actorID *uuid.UUID
	var actorEmail string

	// Get actor info from context
	if userIDStr := c.GetString("user_id"); userIDStr != "" {
		if id, err := uuid.Parse(userIDStr); err == nil {
			actorID = &id
		}
	}

	// Try to get email from context or database
	if actorID != nil && db.DB != nil {
		var user models.User
		if db.DB.Select("email").First(&user, "id = ?", actorID).Error == nil {
			actorEmail = user.Email
		}
	}

	// Create audit log entry
	entry := models.NewAuditLog(actorID, actorEmail, action, entityType, entityID, details)

	// Add request metadata
	if c != nil {
		entry.WithIPAddress(c.ClientIP())
		entry.WithUserAgent(c.GetHeader("User-Agent"))
	}

	// Save to database (async to not slow down requests)
	go func() {
		if db.DB != nil {
			db.DB.Create(entry)
		}
	}()
}

// LogDirect records an audit entry without gin context (for background jobs)
func LogDirect(actorID *uuid.UUID, actorEmail string, action models.AuditAction, entityType models.AuditEntityType, entityID string, details models.AuditDetails) {
	entry := models.NewAuditLog(actorID, actorEmail, action, entityType, entityID, details)

	go func() {
		if db.DB != nil {
			db.DB.Create(entry)
		}
	}()
}

// LogUserAction is a convenience function for user-related actions
func LogUserAction(c *gin.Context, action models.AuditAction, targetUserID string, details models.AuditDetails) {
	Log(c, action, models.EntityUser, targetUserID, details)
}

// LogKYCAction is a convenience function for KYC-related actions
func LogKYCAction(c *gin.Context, action models.AuditAction, kycID string, details models.AuditDetails) {
	Log(c, action, models.EntityKYC, kycID, details)
}

// LogWalletAction is a convenience function for wallet-related actions
func LogWalletAction(c *gin.Context, action models.AuditAction, walletID string, details models.AuditDetails) {
	Log(c, action, models.EntityWallet, walletID, details)
}

// LogNodeAction is a convenience function for node-related actions
func LogNodeAction(c *gin.Context, action models.AuditAction, nodeID string, details models.AuditDetails) {
	Log(c, action, models.EntityNode, nodeID, details)
}
