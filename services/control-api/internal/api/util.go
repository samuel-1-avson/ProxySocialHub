package api

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

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
